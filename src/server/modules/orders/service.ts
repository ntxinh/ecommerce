import "server-only";

import { and, desc, eq, lt } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import {
  auditLogs,
  orderItems,
  orderPricingBreakdowns,
  orders,
  paymentAttempts,
  payments,
  sellerOrders,
} from "@/server/db/schema";
import { releaseOrderReservations } from "@/server/modules/inventory/service";
import { paymentProviderFor } from "@/server/modules/payments/providers";
import { dispatchMockPayment, type PlaceOrderResult } from "./checkout";
import { legShareVnd } from "./fulfillment";
import { transitionOrder, transitionSellerOrder } from "./transitions";

type Order = typeof orders.$inferSelect;
type OrderStatus = Order["status"];

export type OrderDetail = {
  order: Order;
  sellerOrders: (typeof sellerOrders.$inferSelect)[];
  items: (typeof orderItems.$inferSelect)[];
  breakdowns: (typeof orderPricingBreakdowns.$inferSelect)[];
  payment: typeof payments.$inferSelect | undefined;
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
  return {
    order,
    sellerOrders: db.select().from(sellerOrders).where(eq(sellerOrders.orderId, orderId)).all(),
    items: db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all(),
    breakdowns: db
      .select()
      .from(orderPricingBreakdowns)
      .where(eq(orderPricingBreakdowns.orderId, orderId))
      .all(),
    payment: db.select().from(payments).where(eq(payments.orderId, orderId)).get(),
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
 * Retries a PAYMENT_FAILED order: new payment attempt + wallet dispatch.
 * Reservations stay ACTIVE from the original checkout (TTL may have consumed
 * them — dispatch then rolls back and the order returns to PAYMENT_FAILED).
 */
export async function retryPayment(
  db: DB,
  actor: Actor,
  orderId: string,
  simulate?: "success" | "failure",
): Promise<PlaceOrderResult> {
  const detail = getOrder(db, actor, orderId);
  const payment = detail.payment;
  if (!payment) throw new AuthError("NOT_FOUND", 404, "payment not found");
  if (payment.method !== "MOCK_WALLET") {
    throw new AuthError("INVALID_INPUT", 422, "only wallet payments can be retried");
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
  const outcome = await dispatchMockPayment(
    db,
    "MOCK_WALLET",
    orderId,
    payment.id,
    attemptId,
    simulate,
  );
  return {
    orderId,
    sellerOrderIds: detail.sellerOrders.map((s) => s.id),
    status: outcome.orderStatus,
  };
}
