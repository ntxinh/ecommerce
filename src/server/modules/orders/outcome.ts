import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import type { DB } from "@/server/db/client";
import {
  auditLogs,
  orderItems,
  orders,
  paymentAttempts,
  payments,
  stockReservations,
} from "@/server/db/schema";
import { postOrderRecognition } from "@/server/modules/finance/ledger";
import { consumeReservation } from "@/server/modules/inventory/service";
import { type OrderStatus, transitionOrder } from "./transitions";

export type PaymentOutcome = {
  paymentStatus: "PAID" | "FAILED";
  orderStatus: OrderStatus;
};

const lineKey = (orderKey: string, variantId: string) => `${orderKey}:${variantId}`;

/**
 * Persists a settled payment outcome in one transaction: attempt + payment
 * status, order transition, reservation consume on success. Shared by the mock
 * dispatch and the Stripe webhook/return-page paths — the CASE guard makes
 * payment PAID never downgrade, and a stale FAILED on an order that already
 * moved forward (a retry won) never rewinds the order.
 */
export function persistPaymentOutcome(
  db: DB,
  paymentId: string,
  status: "PAID" | "FAILED",
  attemptId?: string,
): PaymentOutcome {
  const orderId = db
    .select({ orderId: payments.orderId })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .get()!.orderId;

  const orderStatus = db.transaction((tx): OrderStatus => {
    const now = Date.now();
    if (attemptId) {
      tx.update(paymentAttempts).set({ status }).where(eq(paymentAttempts.id, attemptId)).run();
    }
    // A failed retry must never downgrade an already-captured payment —
    // money captured once stays PAID until refunded, or cancelOrder misses it.
    tx.update(payments)
      .set({
        status:
          status === "PAID"
            ? "PAID"
            : sql`case when ${payments.status} = 'PAID' then 'PAID' else 'FAILED' end`,
        updatedAt: now,
      })
      .where(eq(payments.id, paymentId))
      .run();
    const order = tx.select().from(orders).where(eq(orders.id, orderId)).get()!;

    if (status !== "PAID") {
      // Only an unpaid-side order can wedge; a late FAILED after the order
      // moved forward (PAID via retry/return) leaves the order alone.
      if (order.status === "PENDING_PAYMENT" || order.status === "PAYMENT_FAILED") {
        transitionOrder(tx, orderId, "PAYMENT_FAILED", null);
        return "PAYMENT_FAILED";
      }
      return order.status;
    }
    if (order.status !== "PENDING_PAYMENT" && order.status !== "PAYMENT_FAILED") {
      // Already PAID (idempotent redelivery) or moved past it — nothing to do.
      return order.status;
    }
    const orderKey = order.idempotencyKey;
    let stockLost: string | null = null;
    for (const line of tx
      .select({ variantId: orderItems.variantId })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .all()) {
      const res = tx
        .select()
        .from(stockReservations)
        .where(eq(stockReservations.idempotencyKey, lineKey(orderKey, line.variantId)))
        .get();
      // CONSUMED is fine (already converted); RELEASED/EXPIRED/missing → stock lost.
      if (!res || res.status === "RELEASED" || res.status === "EXPIRED") {
        stockLost = `${line.variantId} reservation ${res?.id ?? "missing"} (${res?.status ?? "none"})`;
        break;
      }
      if (res.status === "ACTIVE") consumeReservation(tx, res.id);
    }
    if (stockLost) {
      // Payment captured but stock is gone — flag PAYMENT_FAILED so the order
      // is retryable/cancellable instead of wedged (payment stays PAID; cancel
      // refunds it via the adapter).
      transitionOrder(tx, orderId, "PAYMENT_FAILED", null);
      tx.insert(auditLogs)
        .values({
          id: `aud_${ulid()}`,
          actorId: null,
          action: "payment.stock_lost",
          targetType: "order",
          targetId: orderId,
          metaJson: JSON.stringify({ detail: stockLost }),
          createdAt: now,
        })
        .run();
      // The money is real even though the order wedged — book recognition so
      // the ledger reflects the capture and the cancel path's clawbacks close
      // against it instead of over-drawing the accounts.
      postOrderRecognition(tx, orderId);
      return "PAYMENT_FAILED";
    }
    transitionOrder(tx, orderId, "PAID", null);
    // Recognition postings share the tx — a rollback leaves neither the PAID
    // status nor half a ledger behind; the guard inside keeps redelivery safe.
    postOrderRecognition(tx, orderId);
    return "PAID";
  });
  return { paymentStatus: status, orderStatus };
}

/**
 * The provider-side ref refunds must target: the latest PAID attempt's
 * `externalRef` when recorded (Finix transfer id — the reversal endpoint's
 * resource), else `providerRef` (Stripe session id / Finix form id). Falls
 * back to `paymentId` for mock adapters, which never record a providerRef and
 * ignore the ref anyway — and matches the pre-Stripe call shape for legacy
 * PAID rows.
 */
export function settledPaymentRef(db: Pick<DB, "select">, paymentId: string): string {
  const settled = db
    .select({
      status: paymentAttempts.status,
      ref: paymentAttempts.providerRef,
      ext: paymentAttempts.externalRef,
    })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.paymentId, paymentId))
    .orderBy(desc(paymentAttempts.id))
    .all()
    .find((a) => a.status === "PAID" && (a.ext ?? a.ref));
  return settled?.ext ?? settled?.ref ?? paymentId;
}
