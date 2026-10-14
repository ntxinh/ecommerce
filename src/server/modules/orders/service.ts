import "server-only";

import { and, desc, eq, lt, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import {
  inventory,
  inventoryMovements,
  orderItems,
  orderPricingBreakdowns,
  orders,
  paymentAttempts,
  payments,
  sellerOrders,
  stockReservations,
} from "@/server/db/schema";
import { releaseReservation } from "@/server/modules/inventory/service";
import { paymentProviderFor } from "@/server/modules/payments/providers";
import { dispatchWalletPayment, type PlaceOrderResult } from "./checkout";
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
 * seller order is still NEW/CONFIRMED. Frees stock: ACTIVE reservations are
 * released, COD-consumed ones restore on_hand and flip RELEASED. PAID payments
 * are refunded via the adapter post-commit.
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
  if (
    (order.status === "PAID" || order.status === "PROCESSING") &&
    detail.sellerOrders.some((so) => so.status !== "NEW" && so.status !== "CONFIRMED")
  ) {
    throw new AuthError(
      "INVALID_INPUT",
      422,
      "a seller order has already progressed past packing gate",
    );
  }

  const payment = detail.payment;
  db.transaction((tx) => {
    const now = Date.now();
    const orderKey = order.idempotencyKey;
    for (const line of tx
      .select({ variantId: orderItems.variantId, qty: orderItems.qty })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .all()) {
      const res = tx
        .select()
        .from(stockReservations)
        .where(eq(stockReservations.idempotencyKey, `${orderKey}:${line.variantId}`))
        .get();
      if (!res) continue;
      if (res.status === "ACTIVE") {
        releaseReservation(tx, res.id, "order_cancelled");
      } else if (res.status === "CONSUMED") {
        // COD reservations were consumed at creation — restore on_hand.
        tx.update(stockReservations)
          .set({ status: "RELEASED" })
          .where(eq(stockReservations.id, res.id))
          .run();
        tx.update(inventory)
          .set({ onHand: sql`${inventory.onHand} + ${res.qty}`, updatedAt: now })
          .where(eq(inventory.variantId, res.variantId))
          .run();
        tx.insert(inventoryMovements)
          .values({
            id: `mov_${ulid()}`,
            variantId: res.variantId,
            delta: res.qty,
            reason: "order_cancelled",
            actorId: actor.userId,
            createdAt: now,
          })
          .run();
      }
      // RELEASED/EXPIRED: nothing to free.
    }
    for (const so of tx
      .select({ id: sellerOrders.id })
      .from(sellerOrders)
      .where(eq(sellerOrders.orderId, orderId))
      .all()) {
      transitionSellerOrder(tx, so.id, "CANCELLED", actor);
    }
    transitionOrder(tx, orderId, "CANCELLED", actor);
    if (payment?.status === "PAID") {
      tx.update(payments)
        .set({ status: "REFUNDED", updatedAt: now })
        .where(eq(payments.id, payment.id))
        .run();
    }
  });

  if (payment?.status === "PAID") {
    await paymentProviderFor(payment.method).refund({
      ref: payment.id,
      amountVnd: payment.amountVnd,
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
  const outcome = await dispatchWalletPayment(db, orderId, payment.id, attemptId, simulate);
  return {
    orderId,
    sellerOrderIds: detail.sellerOrders.map((s) => s.id),
    status: outcome.orderStatus,
  };
}
