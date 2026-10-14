import "server-only";

import { eq } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import { type Actor, requirePermission } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import { auditLogs, orders, sellerOrders } from "@/server/db/schema";

type Order = typeof orders.$inferSelect;
type SellerOrder = typeof sellerOrders.$inferSelect;

export type OrderStatus = Order["status"];
export type SellerOrderStatus = SellerOrder["status"];

/** Query surface shared by the DB handle and a drizzle tx. */
export type Tx = Pick<DB, "select" | "insert" | "update">;

/** Legal parent-order transitions (spec §5 / order-lifecycle.md). */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: ["PAID", "PAYMENT_FAILED", "CANCELLED"],
  PAID: ["PROCESSING", "CANCELLED", "PARTIALLY_REFUNDED", "REFUNDED"],
  PAYMENT_FAILED: ["PENDING_PAYMENT", "PAID", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"],
  COMPLETED: [],
  CANCELLED: [],
  PARTIALLY_REFUNDED: ["REFUNDED"],
  REFUNDED: [],
};

/** Legal seller-order fulfillment transitions. */
export const SELLER_ORDER_TRANSITIONS: Readonly<
  Record<SellerOrderStatus, readonly SellerOrderStatus[]>
> = {
  NEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PACKING", "CANCELLED"],
  PACKING: ["READY_TO_SHIP"],
  READY_TO_SHIP: ["SHIPPED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["COMPLETED", "RETURN_REQUESTED"],
  RETURN_REQUESTED: ["RETURNED", "COMPLETED"],
  COMPLETED: ["RETURNED"],
  CANCELLED: [],
  RETURNED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function canTransitionSellerOrder(from: SellerOrderStatus, to: SellerOrderStatus): boolean {
  return SELLER_ORDER_TRANSITIONS[from].includes(to);
}

/** Parent statuses that allow seller-fulfillment progress — anything where the
 *  order has been paid or shipped (partners can't move an unpaid order). */
export const PAID_PARENT: Readonly<Partial<Record<OrderStatus, true>>> = {
  PAID: true,
  PROCESSING: true,
  SHIPPED: true,
  DELIVERED: true,
  COMPLETED: true,
  PARTIALLY_REFUNDED: true,
  REFUNDED: true,
};

/** Seller-order targets that move fulfillment forward; CANCELLED/RETURN_* are
 *  excluded so owner-cancel and returns still work regardless of parent. */
const FORWARD_SELLER: Readonly<Partial<Record<SellerOrderStatus, true>>> = {
  CONFIRMED: true,
  PACKING: true,
  READY_TO_SHIP: true,
  SHIPPED: true,
  DELIVERED: true,
  COMPLETED: true,
};
/**
 * Applies a parent-order transition inside the caller's store/tx: legality
 * check → status update → `audit_logs` row. `actor: null` marks system-initiated
 * transitions (payment confirm/fail, sweeps); non-null actors must be ADMIN or
 * the order owner.
 */
export function transitionOrder(tx: Tx, orderId: string, to: OrderStatus, actor: Actor | null) {
  const order = tx.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) throw new AuthError("NOT_FOUND", 404, "order not found");
  if (actor && !actor.roles.includes("ADMIN") && order.userId !== actor.userId) {
    throw new AuthError("FORBIDDEN", 403);
  }
  if (order.status === to) return order; // already there — idempotent
  if (!canTransitionOrder(order.status, to)) {
    throw new AuthError(
      "INVALID_INPUT",
      422,
      `order ${orderId} cannot transition ${order.status} → ${to}`,
    );
  }
  const now = Date.now();
  tx.update(orders).set({ status: to, updatedAt: now }).where(eq(orders.id, orderId)).run();
  tx.insert(auditLogs)
    .values({
      id: `aud_${ulid()}`,
      actorId: actor?.userId ?? null,
      action: "order.transition",
      targetType: "order",
      targetId: orderId,
      metaJson: JSON.stringify({ from: order.status, to }),
      createdAt: now,
    })
    .run();
  return { ...order, status: to, updatedAt: now };
}

/**
 * Applies a seller-order transition inside the caller's store/tx. Non-null
 * actors must be ADMIN, hold `order:write`-equivalent membership
 * (OWNER role) of the seller order's shop, or be the parent order's
 * owner requesting CANCELLED.
 */
export function transitionSellerOrder(
  tx: Tx,
  sellerOrderId: string,
  to: SellerOrderStatus,
  actor: Actor | null,
) {
  const so = tx.select().from(sellerOrders).where(eq(sellerOrders.id, sellerOrderId)).get();
  if (!so) throw new AuthError("NOT_FOUND", 404, "seller order not found");
  const parent = tx.select().from(orders).where(eq(orders.id, so.orderId)).get();
  if (actor && !actor.roles.includes("ADMIN")) {
    try {
      requirePermission(actor, "order:write", { shopId: so.shopId });
    } catch (e) {
      // Non-seller paths the parent owner may drive: cancelling their own leg
      // and filing a return on a delivered one.
      const ownerOnly = to === "CANCELLED" || to === "RETURN_REQUESTED";
      if (!(ownerOnly && parent?.userId === actor.userId)) throw e;
    }
  }
  if (so.status === to) return so; // idempotent
  if (!canTransitionSellerOrder(so.status, to)) {
    throw new AuthError(
      "INVALID_INPUT",
      422,
      `seller order ${sellerOrderId} cannot transition ${so.status} → ${to}`,
    );
  }
  // Seller fulfillment can't advance while the parent order is unpaid or
  // dead — keeps unpaid orders cancellable and prevents orphan progress.
  if (FORWARD_SELLER[to] && !(parent && PAID_PARENT[parent.status])) {
    throw new AuthError(
      "INVALID_INPUT",
      422,
      `cannot progress seller order ${sellerOrderId}: parent is ${parent?.status ?? "missing"}`,
    );
  }
  const now = Date.now();
  tx.update(sellerOrders)
    .set({ status: to, updatedAt: now })
    .where(eq(sellerOrders.id, sellerOrderId))
    .run();
  tx.insert(auditLogs)
    .values({
      id: `aud_${ulid()}`,
      actorId: actor?.userId ?? null,
      action: "seller_order.transition",
      targetType: "seller_order",
      targetId: sellerOrderId,
      metaJson: JSON.stringify({ from: so.status, to }),
      createdAt: now,
    })
    .run();
  return { ...so, status: to, updatedAt: now };
}
