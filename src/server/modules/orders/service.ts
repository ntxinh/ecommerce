import "server-only";

import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import { type Actor, requirePermission } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import {
  auditLogs,
  orderItems,
  orderPricingBreakdowns,
  orders,
  paymentAttempts,
  payments,
  sellerOrders,
  shipments,
  shops,
  trackingEvents,
} from "@/server/db/schema";
import { releaseOrderReservations } from "@/server/modules/inventory/service";
import { paymentProviderFor } from "@/server/modules/payments/providers";
import { dispatchMockPayment, dispatchStripePayment, type PlaceOrderResult } from "./checkout";
import { legShareVnd } from "./fulfillment";
import { transitionOrder, transitionSellerOrder } from "./transitions";

type Order = typeof orders.$inferSelect;
type OrderStatus = Order["status"];
type SellerOrder = typeof sellerOrders.$inferSelect;
export type SellerOrderStatus = SellerOrder["status"];

export type OrderDetail = {
  order: Order;
  sellerOrders: SellerOrder[];
  items: (typeof orderItems.$inferSelect)[];
  breakdowns: (typeof orderPricingBreakdowns.$inferSelect)[];
  payment: typeof payments.$inferSelect | undefined;
  /** Shipment rows plus their tracking events, for the customer timeline. */
  shipments: (typeof shipments.$inferSelect)[];
  trackingEvents: (typeof trackingEvents.$inferSelect)[];
};

export type SellerOrderDetail = {
  sellerOrder: SellerOrder;
  order: Order;
  shop: typeof shops.$inferSelect | undefined;
  items: (typeof orderItems.$inferSelect)[];
  shipment: typeof shipments.$inferSelect | undefined;
  trackingEvents: (typeof trackingEvents.$inferSelect)[];
};

/** Customer-scoped page: ULID ids sort by creation time, so id desc is a stable
 *  cursor (spec pagination style; max 50 per page). */
export function listOrders(
  db: DB,
  actor: Actor,
  opts: { status?: OrderStatus; cursor?: string; limit?: number } = {},
): { items: Order[]; nextCursor: string | null } {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const conds = [eq(orders.userId, actor.userId)];
  if (opts.status) conds.push(eq(orders.status, opts.status));
  if (opts.cursor) conds.push(lt(orders.id, opts.cursor));
  const rows = db
    .select()
    .from(orders)
    .where(and(...conds))
    .orderBy(desc(orders.id))
    .limit(limit + 1)
    .all();
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
}

/** Owner or ADMIN only — other users get FORBIDDEN, missing gets NOT_FOUND. */
export function getOrder(db: DB, actor: Actor, orderId: string): OrderDetail {
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) throw new AuthError("NOT_FOUND", 404, "order not found");
  if (order.userId !== actor.userId && !actor.roles.includes("ADMIN")) {
    throw new AuthError("FORBIDDEN", 403);
  }
  const legs = db.select().from(sellerOrders).where(eq(sellerOrders.orderId, orderId)).all();
  const legShipments = legs.length
    ? db
        .select()
        .from(shipments)
        .where(
          inArray(
            shipments.sellerOrderId,
            legs.map((l) => l.id),
          ),
        )
        .all()
    : [];
  const events = legShipments.length
    ? db
        .select()
        .from(trackingEvents)
        .where(
          inArray(
            trackingEvents.shipmentId,
            legShipments.map((s) => s.id),
          ),
        )
        .all()
    : [];
  return {
    order,
    sellerOrders: legs,
    items: db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all(),
    breakdowns: db
      .select()
      .from(orderPricingBreakdowns)
      .where(eq(orderPricingBreakdowns.orderId, orderId))
      .all(),
    payment: db.select().from(payments).where(eq(payments.orderId, orderId)).get(),
    shipments: legShipments,
    trackingEvents: events,
  };
}

/** Shop-scoped seller order list (seller center). `order:read` on the shop;
 *  same ULID-desc cursor style as listOrders. */
export function listSellerOrders(
  db: DB,
  actor: Actor,
  opts: { shopId: string; status?: SellerOrderStatus; cursor?: string; limit?: number },
): { items: SellerOrder[]; nextCursor: string | null } {
  requirePermission(actor, "order:read", { shopId: opts.shopId });
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const conds = [eq(sellerOrders.shopId, opts.shopId)];
  if (opts.status) conds.push(eq(sellerOrders.status, opts.status));
  if (opts.cursor) conds.push(lt(sellerOrders.id, opts.cursor));
  const rows = db
    .select()
    .from(sellerOrders)
    .where(and(...conds))
    .orderBy(desc(sellerOrders.id))
    .limit(limit + 1)
    .all();
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
}

/** Seller-order detail for the shop member (order:read) — parent order, line
 *  items, shipment + tracking events for the detail page and action buttons. */
export function getSellerOrder(db: DB, actor: Actor, sellerOrderId: string): SellerOrderDetail {
  const sellerOrder = db
    .select()
    .from(sellerOrders)
    .where(eq(sellerOrders.id, sellerOrderId))
    .get();
  if (!sellerOrder) throw new AuthError("NOT_FOUND", 404, "seller order not found");
  requirePermission(actor, "order:read", { shopId: sellerOrder.shopId });
  const order = db.select().from(orders).where(eq(orders.id, sellerOrder.orderId)).get();
  if (!order) throw new AuthError("NOT_FOUND", 404, "order not found");
  const shipment = db
    .select()
    .from(shipments)
    .where(eq(shipments.sellerOrderId, sellerOrderId))
    .get();
  return {
    sellerOrder,
    order,
    shop: db.select().from(shops).where(eq(shops.id, sellerOrder.shopId)).get(),
    items: db.select().from(orderItems).where(eq(orderItems.sellerOrderId, sellerOrderId)).all(),
    shipment,
    trackingEvents: shipment
      ? db.select().from(trackingEvents).where(eq(trackingEvents.shipmentId, shipment.id)).all()
      : [],
  };
}

/**
 * Customer cancel (owner or ADMIN). Allowed while the order hasn't shipped:
 * PENDING_PAYMENT/PAYMENT_FAILED always; PAID|PROCESSING only when every
 * seller order is still NEW/CONFIRMED or already CANCELLED (a cancelled leg
 * released its stock, so it doesn't gate the rest). Frees stock: ACTIVE
 * reservations are released, COD-consumed ones restore on_hand and flip
 * RELEASED. PAID payments are refunded via the adapter post-commit.
 */
export async function cancelOrder(
  db: DB,
  actor: Actor,
  orderId: string,
): Promise<{ orderId: string; status: OrderStatus }> {
  const detail = getOrder(db, actor, orderId);
  const { order } = detail;

  const cancellable: OrderStatus[] = ["PENDING_PAYMENT", "PAYMENT_FAILED", "PAID", "PROCESSING"];
  if (!cancellable.includes(order.status)) {
    throw new AuthError("INVALID_INPUT", 422, `order ${orderId} is ${order.status}`);
  }
  const progressed = detail.sellerOrders.find(
    (so) => !["NEW", "CONFIRMED", "CANCELLED"].includes(so.status),
  );
  if ((order.status === "PAID" || order.status === "PROCESSING") && progressed) {
    throw new AuthError(
      "INVALID_INPUT",
      422,
      `seller order ${progressed.id} has already progressed (${progressed.status})`,
    );
  }

  const payment = detail.payment;
  const refundVnd = db.transaction((tx) => {
    const now = Date.now();
    releaseOrderReservations(
      tx,
      order.idempotencyKey,
      tx
        .select({ variantId: orderItems.variantId })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId))
        .all()
        .map((l) => l.variantId),
      actor.userId,
      "order_cancelled",
    );
    // Refund only the legs being cancelled now — legs already CANCELLED by the
    // seller were refunded their share by cancelSellerOrder.
    let refundVnd = 0;
    for (const so of tx
      .select()
      .from(sellerOrders)
      .where(eq(sellerOrders.orderId, orderId))
      .all()) {
      const wasCancelled = so.status === "CANCELLED";
      transitionSellerOrder(tx, so.id, "CANCELLED", actor);
      if (!wasCancelled && payment?.status === "PAID") {
        const share = legShareVnd(tx, so);
        refundVnd += share;
        if (share > 0) {
          tx.insert(auditLogs)
            .values({
              id: `aud_${ulid()}`,
              actorId: actor.userId,
              action: "order.partial_refund",
              targetType: "seller_order",
              targetId: so.id,
              metaJson: JSON.stringify({ paymentId: payment.id, refundVnd: share }),
              createdAt: now,
            })
            .run();
        }
      }
    }
    transitionOrder(tx, orderId, "CANCELLED", actor);
    if (payment?.status === "PAID") {
      tx.update(payments)
        .set({ status: "REFUNDED", updatedAt: now })
        .where(eq(payments.id, payment.id))
        .run();
    }
    return refundVnd;
  });

  if (payment?.status === "PAID" && refundVnd > 0) {
    await paymentProviderFor(payment.method).refund({
      ref: payment.id,
      amountVnd: refundVnd,
    });
  }
  return { orderId, status: "CANCELLED" };
}

/**
 * Retries a PAYMENT_FAILED order: new payment attempt + dispatch.
 * MOCK_WALLET confirms synchronously; STRIPE mints a fresh Checkout Session
 * and returns redirectUrl — the browser resumes at Stripe.
 * Reservations stay ACTIVE from the original checkout (TTL may have consumed
 * them — dispatch then rolls back and the order returns to PAYMENT_FAILED).
 */
export async function retryPayment(
  db: DB,
  actor: Actor,
  orderId: string,
  simulate?: "success" | "failure",
  opts: { origin?: string; locale?: string } = {},
): Promise<PlaceOrderResult> {
  const detail = getOrder(db, actor, orderId);
  const payment = detail.payment;
  if (!payment) throw new AuthError("NOT_FOUND", 404, "payment not found");
  if (payment.method !== "MOCK_WALLET" && payment.method !== "STRIPE") {
    throw new AuthError("INVALID_INPUT", 422, `cannot retry ${payment.method} payments`);
  }
  if (payment.method === "STRIPE" && !opts.origin) {
    throw new AuthError("INVALID_INPUT", 400, "request origin required for stripe checkout");
  }
  const attemptId = db.transaction((tx) => {
    transitionOrder(tx, orderId, "PENDING_PAYMENT", actor);
    const id = `att_${ulid()}`;
    tx.insert(paymentAttempts)
      .values({
        id,
        paymentId: payment.id,
        status: "PENDING",
        simulate: simulate ?? null,
        idempotencyKey: `${detail.order.idempotencyKey}:pay:${ulid()}`,
        createdAt: Date.now(),
      })
      .run();
    return id;
  });
  const sellerOrderIds = detail.sellerOrders.map((s) => s.id);
  if (payment.method === "STRIPE") {
    const { redirectUrl, orderStatus } = await dispatchStripePayment(
      db,
      orderId,
      payment.id,
      attemptId,
      payment.amountVnd,
      opts.origin!,
      opts.locale ?? "en",
    );
    return { orderId, sellerOrderIds, status: orderStatus, redirectUrl };
  }
  const outcome = await dispatchMockPayment(
    db,
    "MOCK_WALLET",
    orderId,
    payment.id,
    attemptId,
    simulate,
  );
  return { orderId, sellerOrderIds, status: outcome.orderStatus };
}
