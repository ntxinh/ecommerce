import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import { type Actor, requirePermission } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import {
  applicationSettings,
  auditLogs,
  orderItems,
  orders,
  payments,
  sellerOrders,
  shipments,
  trackingEvents,
} from "@/server/db/schema";
import { releaseOrderReservations } from "@/server/modules/inventory/service";
import { paymentProviderFor } from "@/server/modules/payments/providers";
import { settledPaymentRef } from "./outcome";
import { PAID_PARENT, type Tx, transitionSellerOrder } from "./transitions";

type SellerOrder = typeof sellerOrders.$inferSelect;

/** Loads the seller order + parent order, enforcing `order:write` on the shop. */
function leg(tx: Tx, actor: Actor, sellerOrderId: string) {
  const so = tx.select().from(sellerOrders).where(eq(sellerOrders.id, sellerOrderId)).get();
  if (!so) throw new AuthError("NOT_FOUND", 404, "seller order not found");
  requirePermission(actor, "order:write", { shopId: so.shopId });
  const order = tx.select().from(orders).where(eq(orders.id, so.orderId)).get();
  if (!order) throw new AuthError("NOT_FOUND", 404, "order not found");
  return { so, order };
}

/** NEW → CONFIRMED (parent-paid gate lives in transitionSellerOrder). */
export function confirmSellerOrder(db: DB, actor: Actor, sellerOrderId: string): SellerOrder {
  return db.transaction((tx) => {
    leg(tx, actor, sellerOrderId);
    return transitionSellerOrder(tx, sellerOrderId, "CONFIRMED", actor);
  });
}

/** CONFIRMED → PACKING. */
export function packSellerOrder(db: DB, actor: Actor, sellerOrderId: string): SellerOrder {
  return db.transaction((tx) => {
    leg(tx, actor, sellerOrderId);
    return transitionSellerOrder(tx, sellerOrderId, "PACKING", actor);
  });
}

/**
 * PACKING|READY_TO_SHIP → SHIPPED: creates the shipment row (one per seller
 * order — the unique index doubles as the idempotency guard) and the first
 * tracking event. PACKING legs step through READY_TO_SHIP so every recorded
 * hop stays legal.
 */
export function shipSellerOrder(
  db: DB,
  actor: Actor,
  sellerOrderId: string,
  input: { carrier: string; trackingNumber: string },
): SellerOrder {
  if (!input.carrier || !input.trackingNumber) {
    throw new AuthError("INVALID_INPUT", 400, "carrier and tracking number required");
  }
  return db.transaction((tx) => {
    const { so } = leg(tx, actor, sellerOrderId);
    if (so.status === "PACKING") transitionSellerOrder(tx, sellerOrderId, "READY_TO_SHIP", actor);
    const next = transitionSellerOrder(tx, sellerOrderId, "SHIPPED", actor);
    if (!tx.select().from(shipments).where(eq(shipments.sellerOrderId, sellerOrderId)).get()) {
      // shipments.trackingNumber is globally unique — pre-check so a recycled
      // number surfaces as INVALID_INPUT instead of a raw constraint 500.
      if (
        tx
          .select({ id: shipments.id })
          .from(shipments)
          .where(eq(shipments.trackingNumber, input.trackingNumber))
          .get()
      ) {
        throw new AuthError("INVALID_INPUT", 422, "tracking number already in use");
      }
      const now = Date.now();
      const shipmentId = `shp_${ulid()}`;
      tx.insert(shipments)
        .values({
          id: shipmentId,
          sellerOrderId,
          provider: input.carrier,
          status: "IN_TRANSIT",
          trackingNumber: input.trackingNumber,
          createdAt: now,
        })
        .run();
      tx.insert(trackingEvents)
        .values({
          id: `tev_${ulid()}`,
          shipmentId,
          status: "SHIPPED",
          detail: `Handed to ${input.carrier} (${input.trackingNumber})`,
          createdAt: now,
        })
        .run();
      tx.update(sellerOrders)
        .set({ trackingNumber: input.trackingNumber, updatedAt: now })
        .where(eq(sellerOrders.id, sellerOrderId))
        .run();
      tx.insert(auditLogs)
        .values({
          id: `aud_${ulid()}`,
          actorId: actor.userId,
          action: "shipment.created",
          targetType: "seller_order",
          targetId: sellerOrderId,
          metaJson: JSON.stringify({
            shipmentId,
            carrier: input.carrier,
            trackingNumber: input.trackingNumber,
          }),
          createdAt: now,
        })
        .run();
    }
    return next;
  });
}

/** SHIPPED → DELIVERED; marks the shipment + logs the DELIVERED event once. */
export function deliverSellerOrder(db: DB, actor: Actor, sellerOrderId: string): SellerOrder {
  return db.transaction((tx) => {
    leg(tx, actor, sellerOrderId);
    const next = transitionSellerOrder(tx, sellerOrderId, "DELIVERED", actor);
    const shipment = tx
      .select()
      .from(shipments)
      .where(eq(shipments.sellerOrderId, sellerOrderId))
      .get();
    if (shipment && shipment.status !== "DELIVERED") {
      const now = Date.now();
      tx.update(shipments).set({ status: "DELIVERED" }).where(eq(shipments.id, shipment.id)).run();
      tx.insert(trackingEvents)
        .values({
          id: `tev_${ulid()}`,
          shipmentId: shipment.id,
          status: "DELIVERED",
          createdAt: now,
        })
        .run();
    }
    return next;
  });
}

/** DELIVERED → COMPLETED (RETURN_REQUESTED → COMPLETED allowed by the table). */
export function completeSellerOrder(db: DB, actor: Actor, sellerOrderId: string): SellerOrder {
  return db.transaction((tx) => {
    leg(tx, actor, sellerOrderId);
    return transitionSellerOrder(tx, sellerOrderId, "COMPLETED", actor);
  });
}
/**
 * Delivery timestamp of a seller order: the newest `DELIVERED` tracking event
 * on its shipment, or null when it has never been delivered.
 */
export function deliveredAt(tx: Pick<DB, "select">, sellerOrderId: string): number | null {
  const row = tx
    .select({ createdAt: trackingEvents.createdAt })
    .from(trackingEvents)
    .innerJoin(shipments, eq(trackingEvents.shipmentId, shipments.id))
    .where(and(eq(shipments.sellerOrderId, sellerOrderId), eq(trackingEvents.status, "DELIVERED")))
    .orderBy(desc(trackingEvents.createdAt))
    .limit(1)
    .get();
  return row?.createdAt ?? null;
}

/**
 * Cron sweep: DELIVERED legs whose deliveredAt is older than
 * `application_settings.auto_complete_days` (JSON number, fallback 3) move to
 * COMPLETED with a system (null) actor. Returns the count completed.
 */
export function autoCompleteSellerOrders(db: DB, now = Date.now()): number {
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(applicationSettings)
      .where(eq(applicationSettings.key, "auto_complete_days"))
      .get();
    const parsed = row ? (JSON.parse(row.value) as number) : NaN;
    const days = Number.isFinite(parsed) ? parsed : 3;
    const cutoff = now - days * 86_400_000;

    const delivered = tx
      .select({ id: sellerOrders.id })
      .from(sellerOrders)
      .where(eq(sellerOrders.status, "DELIVERED"))
      .all();
    let completed = 0;
    for (const so of delivered) {
      const at = deliveredAt(tx, so.id);
      if (at !== null && at < cutoff) {
        transitionSellerOrder(tx, so.id, "COMPLETED", null);
        completed += 1;
      }
    }
    return completed;
  });
}

/**
 * A seller order's share of the order total: item line totals (after item
 * promos + allocated vouchers) + its shipping. Shared by leg-cancel and
 * parent-cancel so both refund the same amounts.
 */
export function legShareVnd(tx: Tx, so: SellerOrder): number {
  const items = tx
    .select({ lineTotalVnd: orderItems.lineTotalVnd })
    .from(orderItems)
    .where(eq(orderItems.sellerOrderId, so.id))
    .all();
  return items.reduce((s, l) => s + l.lineTotalVnd, 0) + so.shippingVnd;
}

/**
 * Seller-initiated leg cancel (NEW|CONFIRMED → CANCELLED). Frees the leg's
 * reservation share — online orders release ACTIVE reservations, COD legs
 * restore on_hand — and, when the parent was PAID, refunds the leg's share
 * via the provider post-commit.
 */
export async function cancelSellerOrder(
  db: DB,
  actor: Actor,
  sellerOrderId: string,
): Promise<{ sellerOrderId: string; status: "CANCELLED"; refundedVnd: number }> {
  const refund = db.transaction((tx) => {
    const { so, order } = leg(tx, actor, sellerOrderId);
    const wasCancelled = so.status === "CANCELLED";
    // Idempotent re-call before the paid gate — a dead parent's already-
    // cancelled leg must stay a no-op, not an error.
    if (wasCancelled) {
      transitionSellerOrder(tx, sellerOrderId, "CANCELLED", actor);
      return { refundVnd: 0, payment: undefined };
    }
    // Cancelling a leg of an unpaid parent would let a still-live payment
    // (open Stripe session, pending bank transfer) capture money for a
    // cancelled leg that the refund accounting then under-refunds. The buyer's
    // cancelOrder path releases unpaid legs wholesale — sellers wait for pay
    // or the buyer cancels.
    if (!PAID_PARENT[order.status]) {
      throw new AuthError(
        "INVALID_INPUT",
        422,
        `cannot cancel a leg while order ${order.id} is ${order.status}`,
      );
    }
    const next = transitionSellerOrder(tx, sellerOrderId, "CANCELLED", actor);

    const lines = tx
      .select({ variantId: orderItems.variantId })
      .from(orderItems)
      .where(eq(orderItems.sellerOrderId, sellerOrderId))
      .all();
    releaseOrderReservations(
      tx,
      order.idempotencyKey,
      lines.map((l) => l.variantId),
      actor.userId,
      "seller_order_cancelled",
    );

    // Partial refund: the leg's share of the captured amount. payments.status
    // stays PAID (no PARTIALLY_REFUNDED enum) — the audit row is the ledger.
    const payment = tx.select().from(payments).where(eq(payments.orderId, so.orderId)).get();
    const refundVnd =
      payment?.status === "PAID" ? Math.min(legShareVnd(tx, next), payment.amountVnd) : 0;
    if (refundVnd > 0) {
      tx.insert(auditLogs)
        .values({
          id: `aud_${ulid()}`,
          actorId: actor.userId,
          action: "order.partial_refund",
          targetType: "seller_order",
          targetId: sellerOrderId,
          metaJson: JSON.stringify({ paymentId: payment!.id, refundVnd }),
          createdAt: Date.now(),
        })
        .run();
    }
    return { next, refundVnd, payment };
  });
  if (refund.refundVnd > 0 && refund.payment) {
    await paymentProviderFor(refund.payment.method).refund({
      ref: settledPaymentRef(db, refund.payment.id),
      amountVnd: refund.refundVnd,
    });
  }
  return { sellerOrderId, status: "CANCELLED", refundedVnd: refund.refundVnd };
}
