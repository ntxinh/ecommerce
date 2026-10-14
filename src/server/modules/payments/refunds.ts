import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import type { DB } from "@/server/db/client";
import {
  orderItems,
  orders,
  payments,
  refunds,
  returnItems,
  returnRequests,
  sellerOrders,
} from "@/server/db/schema";
import { postRefundCompletion, postRefundInitiation } from "@/server/modules/finance/ledger";
import { adjustStockTx } from "@/server/modules/inventory/service";
import {
  canTransitionOrder,
  type Tx,
  transitionOrder,
  transitionSellerOrder,
} from "@/server/modules/orders/transitions";

/**
 * Inside the APPROVED-decision tx: books a PENDING refunds row per return item
 * of `returnRequestId` and posts its initiation entries. The UNIQUE index on
 * `refunds.return_item_id` is the dup-refund guard — a conflicting insert is
 * skipped and earns no postings. `restock` items go back on_hand immediately
 * with a `return_restock` movement. Money only moves when the order's payment
 * is PAID; COD/unpaid returns restock only. Returns the issued refunds so the
 * caller can dispatch provider refunds + completeRefund post-commit.
 */
export function issueReturnRefunds(
  tx: Tx,
  returnRequestId: string,
): { refundId: string; paymentId: string; amountVnd: number }[] {
  const request = tx
    .select()
    .from(returnRequests)
    .where(eq(returnRequests.id, returnRequestId))
    .get();
  if (!request) throw new AuthError("NOT_FOUND", 404, "return request not found");
  const payment = tx.select().from(payments).where(eq(payments.orderId, request.orderId)).get();

  const pending: { refundId: string; paymentId: string; amountVnd: number }[] = [];
  for (const item of tx
    .select()
    .from(returnItems)
    .where(eq(returnItems.returnRequestId, returnRequestId))
    .all()) {
    if (item.restock) {
      const line = tx
        .select({ variantId: orderItems.variantId })
        .from(orderItems)
        .where(eq(orderItems.id, item.orderItemId))
        .get()!;
      adjustStockTx(tx, line.variantId, item.qty, "return_restock");
    }
    if (!payment || payment.status !== "PAID" || item.refundVnd <= 0) continue;
    const refundId = `rfd_${ulid()}`;
    const res = tx
      .insert(refunds)
      .values({
        id: refundId,
        paymentId: payment.id,
        returnItemId: item.id,
        amountVnd: item.refundVnd,
        status: "PENDING",
        reason: "return_approved",
        createdAt: Date.now(),
      })
      .onConflictDoNothing({ target: refunds.returnItemId })
      .run();
    if (res.changes === 0) continue; // already refunded for this line — no double postings
    postRefundInitiation(tx, {
      refundId,
      sellerOrderId: request.sellerOrderId,
      amountVnd: item.refundVnd,
    });
    pending.push({ refundId, paymentId: payment.id, amountVnd: item.refundVnd });
  }
  return pending;
}

/**
 * Books a PENDING cancellation refund (`returnItemId` null — the UNIQUE index
 * allows any number of NULLs) plus per-leg initiation postings. Shared by the
 * customer order-cancel and seller leg-cancel paths; `shares` must sum to
 * `amountVnd` so the REFUNDS_PAYABLE earmark matches the money sent to the
 * provider post-commit.
 */
export function insertCancellationRefund(
  tx: Tx,
  e: {
    paymentId: string;
    amountVnd: number;
    /** Per-leg splits for SELLER_PAYABLE/PLATFORM_REVENUE attribution. */
    shares: { sellerOrderId: string; amountVnd: number }[];
    reason: string;
  },
): string {
  const refundId = `rfd_${ulid()}`;
  tx.insert(refunds)
    .values({
      id: refundId,
      paymentId: e.paymentId,
      returnItemId: null,
      amountVnd: e.amountVnd,
      status: "PENDING",
      reason: e.reason,
      createdAt: Date.now(),
    })
    .run();
  for (const share of e.shares) {
    postRefundInitiation(tx, {
      refundId,
      sellerOrderId: share.sellerOrderId,
      amountVnd: share.amountVnd,
    });
  }
  return refundId;
}

/** Marks the payment REFUNDED once completed refunds cover the captured amount. */
export function markPaymentRefundedIfComplete(tx: Tx, paymentId: string): void {
  const rows = tx.select().from(refunds).where(eq(refunds.paymentId, paymentId)).all();
  const payment = tx.select().from(payments).where(eq(payments.id, paymentId)).get();
  if (!payment || payment.status !== "PAID") return;
  const covered = rows.reduce((s, r) => s + (r.status === "COMPLETED" ? r.amountVnd : 0), 0);
  if (covered >= payment.amountVnd) {
    tx.update(payments)
      .set({ status: "REFUNDED", updatedAt: Date.now() })
      .where(eq(payments.id, paymentId))
      .run();
  }
}

/**
 * After the provider confirms the money returned: PENDING → COMPLETED, closing
 * postings (REFUNDS_PAYABLE −x, CUSTOMER_PAYABLE −x), payment → REFUNDED when
 * its completed refunds cover the captured amount, return request → REFUNDED
 * once all its items' refunds completed (leg → RETURNED), and the parent order
 * → PARTIALLY_REFUNDED or REFUNDED when every order line is covered by
 * completed refunds — only when the transition table allows it. Cancellation
 * refunds (returnItemId null) skip the request/leg/order updates — the cancel
 * path already landed that order's terminal state.
 */
export function completeRefund(db: DB, refundId: string): void {
  db.transaction((tx) => {
    const refund = tx.select().from(refunds).where(eq(refunds.id, refundId)).get();
    if (!refund) throw new AuthError("NOT_FOUND", 404, "refund not found");
    if (refund.status === "COMPLETED") return;
    if (refund.status !== "PENDING") {
      throw new AuthError("INVALID_STATE", 409, `refund is ${refund.status}`);
    }
    tx.update(refunds).set({ status: "COMPLETED" }).where(eq(refunds.id, refundId)).run();
    postRefundCompletion(tx, refundId, refund.amountVnd);
    markPaymentRefundedIfComplete(tx, refund.paymentId);

    if (refund.returnItemId === null) return;
    const item = tx
      .select()
      .from(returnItems)
      .where(eq(returnItems.id, refund.returnItemId))
      .get()!;
    const request = tx
      .select()
      .from(returnRequests)
      .where(eq(returnRequests.id, item.returnRequestId))
      .get()!;
    const siblings = tx
      .select({ returnItemId: returnItems.id })
      .from(returnItems)
      .where(eq(returnItems.returnRequestId, request.id))
      .all();
    const requestDone = siblings.every(
      (ri) =>
        tx
          .select({ status: refunds.status })
          .from(refunds)
          .where(eq(refunds.returnItemId, ri.returnItemId))
          .get()?.status === "COMPLETED",
    );
    if (requestDone) {
      tx.update(returnRequests)
        .set({ status: "REFUNDED" })
        .where(eq(returnRequests.id, request.id))
        .run();
      const so = tx
        .select({ status: sellerOrders.status })
        .from(sellerOrders)
        .where(eq(sellerOrders.id, request.sellerOrderId))
        .get();
      if (so?.status === "RETURN_REQUESTED") {
        transitionSellerOrder(tx, request.sellerOrderId, "RETURNED", null);
      }
    }

    // Parent order: REFUNDED when completed refunds cover every order line's
    // purchased qty, else PARTIALLY_REFUNDED — only when a legal edge exists
    // (already-terminal or still-unpaid orders are left alone).
    const order = tx.select().from(orders).where(eq(orders.id, request.orderId)).get()!;
    const covered = new Map(
      tx
        .select({
          orderItemId: returnItems.orderItemId,
          qty: sql<number>`coalesce(sum(${returnItems.qty}), 0)`,
        })
        .from(refunds)
        .innerJoin(returnItems, eq(refunds.returnItemId, returnItems.id))
        .innerJoin(returnRequests, eq(returnItems.returnRequestId, returnRequests.id))
        .where(and(eq(returnRequests.orderId, order.id), eq(refunds.status, "COMPLETED")))
        .groupBy(returnItems.orderItemId)
        .all()
        .map((r) => [r.orderItemId, r.qty]),
    );
    const lines = tx
      .select({ id: orderItems.id, qty: orderItems.qty })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))
      .all();
    const target = lines.every((l) => (covered.get(l.id) ?? 0) >= l.qty)
      ? "REFUNDED"
      : "PARTIALLY_REFUNDED";
    if (canTransitionOrder(order.status, target)) {
      transitionOrder(tx, order.id, target, null);
    }
  });
}
