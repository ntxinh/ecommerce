import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import type { DB } from "@/server/db/client";
import {
  financialLedgerEntries,
  orderPricingBreakdowns,
  orders,
  sellerOrders,
} from "@/server/db/schema";
import type { Tx } from "@/server/modules/orders/transitions";

export type LedgerAccount =
  | "CUSTOMER_PAYABLE"
  | "PLATFORM_REVENUE"
  | "SELLER_PAYABLE"
  | "REFUNDS_PAYABLE";

/**
 * Appends one signed ledger entry. Accounts are balance views over the signed
 * sum of amount_vnd; SELLER_PAYABLE rows carry shopId, everything else is
 * platform-wide (shopId null). refId keys the entry to the order / refunds row
 * / settlement that moved the money.
 */
export function post(
  tx: Tx,
  e: {
    account: LedgerAccount;
    shopId?: string;
    amountVnd: number;
    refType: "ORDER" | "REFUND" | "SETTLEMENT";
    refId: string;
    meta?: object;
  },
): void {
  tx.insert(financialLedgerEntries)
    .values({
      id: `led_${ulid()}`,
      account: e.account,
      shopId: e.shopId ?? null,
      amountVnd: e.amountVnd,
      refType: e.refType,
      refId: e.refId,
      metaJson: JSON.stringify(e.meta ?? {}),
      createdAt: Date.now(),
    })
    .run();
}

const commission = (amountVnd: number, rateBps: number) =>
  Math.floor((amountVnd * rateBps) / 10_000);

/**
 * Books a freshly-paid order: CUSTOMER_PAYABLE +total (money captured from the
 * buyer), then per seller order the seller's earned share (subtotal minus
 * commission), the platform's commission, and the shipping charge as pure
 * platform revenue. Invariant after posting:
 *   ΣCUSTOMER_PAYABLE = ΣSELLER_PAYABLE + ΣPLATFORM_REVENUE + ΣREFUNDS_PAYABLE.
 * Idempotent: existing ORDER rows for the order mean it was already recognized
 * (webhook redelivery, retry-after-rollback), so it is a no-op.
 */
export function postOrderRecognition(tx: Tx, orderId: string): void {
  const already = tx
    .select({ id: financialLedgerEntries.id })
    .from(financialLedgerEntries)
    .where(
      and(eq(financialLedgerEntries.refType, "ORDER"), eq(financialLedgerEntries.refId, orderId)),
    )
    .get();
  if (already) return;

  const order = tx.select().from(orders).where(eq(orders.id, orderId)).get()!;
  post(tx, {
    account: "CUSTOMER_PAYABLE",
    amountVnd: order.totalVnd,
    refType: "ORDER",
    refId: orderId,
  });
  for (const so of tx.select().from(sellerOrders).where(eq(sellerOrders.orderId, orderId)).all()) {
    const c = commission(so.subtotalVnd, so.commissionRateBps);
    post(tx, {
      account: "SELLER_PAYABLE",
      shopId: so.shopId,
      amountVnd: so.subtotalVnd - c,
      refType: "ORDER",
      refId: orderId,
      meta: { sellerOrderId: so.id },
    });
    post(tx, {
      account: "PLATFORM_REVENUE",
      amountVnd: c,
      refType: "ORDER",
      refId: orderId,
      meta: { sellerOrderId: so.id, kind: "commission" },
    });
    post(tx, {
      account: "PLATFORM_REVENUE",
      amountVnd: so.shippingVnd,
      refType: "ORDER",
      refId: orderId,
      meta: { sellerOrderId: so.id, kind: "shipping" },
    });
  }
  // Platform-funded discounts (PLATFORM_VOUCHER breakdown rows are stored
  // negative): the platform absorbs them, so they come out of PLATFORM_REVENUE.
  // Without this, so.subtotal_vnd (pre-platform-voucher) over-books SP+PR past
  // CUSTOMER_PAYABLE and breaks the ledger invariant on voucher orders.
  const platformDiscount = tx
    .select({ s: sql<number>`coalesce(sum(${orderPricingBreakdowns.amountVnd}), 0)` })
    .from(orderPricingBreakdowns)
    .where(
      and(
        eq(orderPricingBreakdowns.orderId, orderId),
        eq(orderPricingBreakdowns.lineType, "PLATFORM_VOUCHER"),
      ),
    )
    .get()!.s;
  if (platformDiscount !== 0) {
    post(tx, {
      account: "PLATFORM_REVENUE",
      amountVnd: platformDiscount,
      refType: "ORDER",
      refId: orderId,
      meta: { kind: "platform_voucher" },
    });
  }
}

/**
 * Initiation postings for refund amount `x` charged to seller order `so`:
 * the platform earmarks REFUNDS_PAYABLE +x (owed to the buyer), clawing the
 * seller's earned share back by x − c′ and its commission by
 * c′ = floor(x·bps/10000). Net invariant effect is zero until completion.
 */
export function postRefundInitiation(
  tx: Tx,
  e: { refundId: string; sellerOrderId: string; amountVnd: number },
): void {
  const so = tx.select().from(sellerOrders).where(eq(sellerOrders.id, e.sellerOrderId)).get()!;
  const c = commission(e.amountVnd, so.commissionRateBps);
  post(tx, {
    account: "REFUNDS_PAYABLE",
    amountVnd: e.amountVnd,
    refType: "REFUND",
    refId: e.refundId,
    meta: { sellerOrderId: e.sellerOrderId },
  });
  post(tx, {
    account: "SELLER_PAYABLE",
    shopId: so.shopId,
    amountVnd: -(e.amountVnd - c),
    refType: "REFUND",
    refId: e.refundId,
    meta: { sellerOrderId: e.sellerOrderId },
  });
  post(tx, {
    account: "PLATFORM_REVENUE",
    amountVnd: -c,
    refType: "REFUND",
    refId: e.refundId,
    meta: { sellerOrderId: e.sellerOrderId },
  });
}

/**
 * Closing postings when the provider actually returns the money:
 * REFUNDS_PAYABLE −x clears the earmark, CUSTOMER_PAYABLE −x settles the
 * platform's obligation to the buyer.
 */
export function postRefundCompletion(tx: Tx, refundId: string, amountVnd: number): void {
  post(tx, {
    account: "REFUNDS_PAYABLE",
    amountVnd: -amountVnd,
    refType: "REFUND",
    refId: refundId,
  });
  post(tx, {
    account: "CUSTOMER_PAYABLE",
    amountVnd: -amountVnd,
    refType: "REFUND",
    refId: refundId,
  });
}

/** Signed balance of one account, optionally scoped to a shop. */
export function balance(db: Pick<DB, "select">, account: LedgerAccount, shopId?: string): number {
  const conds = [eq(financialLedgerEntries.account, account)];
  if (shopId) conds.push(eq(financialLedgerEntries.shopId, shopId));
  const row = db
    .select({ s: sql<number>`coalesce(sum(${financialLedgerEntries.amountVnd}), 0)` })
    .from(financialLedgerEntries)
    .where(and(...conds))
    .get();
  return row?.s ?? 0;
}
