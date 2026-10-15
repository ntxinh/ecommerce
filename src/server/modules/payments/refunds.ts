import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
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
import { trace } from "@/server/observability/trace";

/** Same holding statuses as requestReturn's gate: a live claim still counts
 *  against the leg's returnable qty. */
const QTY_HOLDING = ["PENDING", "APPROVED", "REFUNDED", "DISPUTED"] as const;

/**
 * Inside the APPROVED-decision tx: books a refunds row per return item of
 * `returnRequestId`. Items whose payment never captured (COD/unpaid) or that
 * refund nothing get a zero-amount COMPLETED marker — the UNIQUE index on
 * `refunds.return_item_id` is the dup guard for rows AND restock, so a repeat
 * issue is a pure no-op. `restock` items go back on_hand (movement actor =
 * the deciding user). Money only moves on PAID payments. Returns the PENDING
 * refunds so the caller dispatches provider refunds + completeRefund
 * post-commit; a request whose items all settle without provider money
 * (pure COD/zero) finalizes in-tx via settleReturnRequest.
 */
function issueReturnRefundsImpl(
  tx: Tx,
  returnRequestId: string,
  actorId?: string,
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
    const needsRefund = payment?.status === "PAID" && item.refundVnd > 0;
    let refundId: string | undefined;
    if (payment) {
      refundId = `rfd_${ulid()}`;
      const res = tx
        .insert(refunds)
        .values({
          id: refundId,
          paymentId: payment.id,
          returnItemId: item.id,
          amountVnd: needsRefund ? item.refundVnd : 0,
          // Marker rows settle in place: no money moved, nothing to dispatch.
          status: needsRefund ? "PENDING" : "COMPLETED",
          reason: needsRefund ? "return_approved" : "return_settled_no_payment",
          createdAt: Date.now(),
        })
        .onConflictDoNothing({ target: refunds.returnItemId })
        .run();
      if (res.changes === 0) continue; // already issued — no restock, no postings
    }
    if (item.restock) {
      const line = tx
        .select({ variantId: orderItems.variantId })
        .from(orderItems)
        .where(eq(orderItems.id, item.orderItemId))
        .get()!;
      adjustStockTx(tx, line.variantId, item.qty, "return_restock", actorId);
    }
    if (needsRefund && refundId) {
      postRefundInitiation(tx, {
        refundId,
        sellerOrderId: request.sellerOrderId,
        amountVnd: item.refundVnd,
      });
      pending.push({ refundId, paymentId: payment!.id, amountVnd: item.refundVnd });
    }
  }
  // Nothing pending (pure COD / zero-amount request) → settle immediately.
  if (pending.length === 0) settleReturnRequest(tx, request);
  return pending;
}

export const issueReturnRefunds = trace("returns.issueReturnRefunds", issueReturnRefundsImpl);

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
 * Once every item of an APPROVED request has a COMPLETED refunds row (real or
 * zero-amount marker): request → REFUNDED, and the leg lands RETURNED when
 * its purchased qty is fully claimed by holding requests, else COMPLETED so
 * the remaining qty can still be returned inside the window.
 */
function settleReturnRequest(tx: Tx, request: typeof returnRequests.$inferSelect): void {
  const items = tx
    .select({ id: returnItems.id })
    .from(returnItems)
    .where(eq(returnItems.returnRequestId, request.id))
    .all();
  const done = items.every(
    (ri) =>
      tx
        .select({ status: refunds.status })
        .from(refunds)
        .where(eq(refunds.returnItemId, ri.id))
        .get()?.status === "COMPLETED",
  );
  if (!done) return;
  tx.update(returnRequests)
    .set({ status: "REFUNDED" })
    .where(eq(returnRequests.id, request.id))
    .run();

  const so = tx.select().from(sellerOrders).where(eq(sellerOrders.id, request.sellerOrderId)).get();
  if (!so) return;
  // The leg is done returning only when nothing sellable remains — count qty
  // claimed by all holding requests, not just this one.
  const holdingIds = tx
    .select({ id: returnRequests.id })
    .from(returnRequests)
    .where(
      and(
        eq(returnRequests.sellerOrderId, so.id),
        inArray(returnRequests.status, [...QTY_HOLDING]),
      ),
    )
    .all()
    .map((r) => r.id);
  const claimed: Record<string, number> = {};
  if (holdingIds.length) {
    for (const l of tx
      .select({ orderItemId: returnItems.orderItemId, qty: returnItems.qty })
      .from(returnItems)
      .where(inArray(returnItems.returnRequestId, holdingIds))
      .all()) {
      claimed[l.orderItemId] = (claimed[l.orderItemId] ?? 0) + l.qty;
    }
  }
  const fullyClaimed = tx
    .select({ id: orderItems.id, qty: orderItems.qty })
    .from(orderItems)
    .where(eq(orderItems.sellerOrderId, so.id))
    .all()
    .every((l) => (claimed[l.id] ?? 0) >= l.qty);
  if (so.status === "RETURN_REQUESTED") {
    transitionSellerOrder(tx, so.id, fullyClaimed ? "RETURNED" : "COMPLETED", null);
  } else if (fullyClaimed && so.status === "COMPLETED") {
    transitionSellerOrder(tx, so.id, "RETURNED", null);
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
    settleReturnRequest(tx, request);

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
