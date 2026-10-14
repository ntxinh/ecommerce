import "server-only";

import { eq } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import { type Actor, requirePermission } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import {
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
import { type Tx, transitionSellerOrder } from "./transitions";

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
 * Seller-initiated leg cancel (NEW|CONFIRMED → CANCELLED). Frees the leg's
 * reservation share — online orders release ACTIVE reservations, COD legs
 * restore on_hand — and, when the parent was PAID, refunds the leg's share
 * (items' line totals + its shipping) via the provider post-commit.
 */
export async function cancelSellerOrder(
  db: DB,
  actor: Actor,
  sellerOrderId: string,
): Promise<{ sellerOrderId: string; status: "CANCELLED"; refundedVnd: number }> {
  const refund = db.transaction((tx) => {
    const { so, order } = leg(tx, actor, sellerOrderId);
    const wasCancelled = so.status === "CANCELLED";
    const next = transitionSellerOrder(tx, sellerOrderId, "CANCELLED", actor);
    if (wasCancelled) return { next, refundVnd: 0, payment: undefined };

    const lines = tx
      .select({ variantId: orderItems.variantId, lineTotalVnd: orderItems.lineTotalVnd })
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
      payment?.status === "PAID"
        ? Math.min(
            lines.reduce((s, l) => s + l.lineTotalVnd, 0) + next.shippingVnd,
            payment.amountVnd,
          )
        : 0;
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
      ref: refund.payment.id,
      amountVnd: refund.refundVnd,
    });
  }
  return { sellerOrderId, status: "CANCELLED", refundedVnd: refund.refundVnd };
}
