import "server-only";

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import type { DB } from "@/server/db/client";
import { voucherRedemptions, vouchers } from "@/server/db/schema";
import type { Tx } from "@/server/modules/inventory/service";

export type Voucher = typeof vouchers.$inferSelect;

export type VoucherRejectionReason =
  | "EXPIRED"
  | "NOT_STARTED"
  | "DISABLED"
  | "MIN_SPEND"
  | "USER_LIMIT"
  | "TOTAL_LIMIT"
  | "WRONG_SHOP"
  | "UNKNOWN"
  /** Valid voucher that lost a stacking slot (second shop voucher for one shop,
   *  second platform voucher) — not in the base enum but must never be silent. */
  | "STACKING";

export type VoucherRejection = {
  code: string;
  reason: VoucherRejectionReason;
};

export type VoucherCtx = {
  userId: string;
  /** Merchandise subtotal (post-item-promo) of the scope the voucher targets:
   *  the voucher's shop subtotal for SHOP vouchers, the order subtotal for
   *  PLATFORM vouchers. Compared against minSpendVnd. */
  scopeSubtotalVnd: number;
  /** Present when the voucher has a shop scope — its own shopId. */
  shopId?: string;
  now: number;
};

/**
 * Validates a voucher row against the pricing context. Returns `null` when
 * usable, else a typed rejection — never throws for business-invalid codes.
 * Pass `voucher: null` for a code that isn't in the table (→ UNKNOWN).
 */
export function validateVoucher(
  db: Pick<DB, "select">,
  voucher: Voucher | null,
  ctx: VoucherCtx,
): VoucherRejection | null {
  const code = voucher?.code ?? "?";
  if (!voucher) return { code, reason: "UNKNOWN" };

  if (voucher.status !== "ACTIVE") return { code, reason: "DISABLED" };
  if (ctx.now < voucher.startsAt) return { code, reason: "NOT_STARTED" };
  if (ctx.now >= voucher.endsAt) return { code, reason: "EXPIRED" };
  // Shop vouchers only apply to their own shop's lines; priceOrder routes ctx.
  if (voucher.scope === "SHOP" && voucher.shopId !== ctx.shopId)
    return { code, reason: "WRONG_SHOP" };
  if (ctx.scopeSubtotalVnd < voucher.minSpendVnd) return { code, reason: "MIN_SPEND" };
  if (voucher.totalLimit !== null && voucher.usedCount >= voucher.totalLimit) {
    return { code, reason: "TOTAL_LIMIT" };
  }
  if (voucher.perUserLimit !== null) {
    const used = db
      .select({ n: sql<number>`count(*)` })
      .from(voucherRedemptions)
      .where(
        and(
          eq(voucherRedemptions.voucherId, voucher.id),
          eq(voucherRedemptions.userId, ctx.userId),
        ),
      )
      .get()!.n;
    if (used >= voucher.perUserLimit) return { code, reason: "USER_LIMIT" };
  }
  return null;
}

export type AppliedVoucher = { voucherId: string; code: string; discountVnd: number };

/**
 * Consumes redemptions inside the caller's checkout transaction: a conditional
 * UPDATE guards the total limit, then one voucher_redemptions row per voucher.
 * `orderId` is required — UNIQUE(voucherId, orderId) is the consume-once-per-
 * order guard, and SQLite NULLs are distinct so a null orderId would defeat it.
 * The caller must create the orders row first, then call this inside the same
 * transaction. Throws VOUCHER_INVALID on an exhausted/competing limit →
 * caller rolls back.
 */
export function consumeRedemptions(
  tx: Tx,
  userId: string,
  applied: AppliedVoucher[],
  orderId: string,
): void {
  const now = Date.now();
  for (const { voucherId } of applied) {
    const voucher = tx.select().from(vouchers).where(eq(vouchers.id, voucherId)).get();
    if (!voucher) throw new AuthError("VOUCHER_INVALID", 400, `voucher ${voucherId} not found`);
    if (voucher.perUserLimit !== null) {
      const used = tx
        .select({ n: sql<number>`count(*)` })
        .from(voucherRedemptions)
        .where(
          and(eq(voucherRedemptions.voucherId, voucherId), eq(voucherRedemptions.userId, userId)),
        )
        .get()!.n;
      if (used >= voucher.perUserLimit) {
        throw new AuthError(
          "VOUCHER_INVALID",
          400,
          `voucher ${voucher.code} per-user limit reached`,
        );
      }
    }
    const res = tx
      .update(vouchers)
      .set({ usedCount: sql`${vouchers.usedCount} + 1` })
      .where(
        and(
          eq(vouchers.id, voucherId),
          or(isNull(vouchers.totalLimit), lt(vouchers.usedCount, vouchers.totalLimit)),
        ),
      )
      .run();
    if (res.changes === 0) {
      throw new AuthError("VOUCHER_INVALID", 400, `voucher ${voucher.code} total limit reached`);
    }
    tx.insert(voucherRedemptions)
      .values({ id: `red_${ulid()}`, voucherId, userId, orderId, createdAt: now })
      .run();
  }
}
