import "server-only";

import { eq } from "drizzle-orm";
import { AuthError } from "@/server/api/errors";
import type { DB } from "@/server/db/client";
import { products, productVariants, promotions, vouchers } from "@/server/db/schema";
import {
  type AppliedVoucher,
  type Voucher,
  type VoucherRejection,
  validateVoucher,
} from "./vouchers";

export type OrderLine = {
  variantId: string;
  productId: string;
  shopId: string;
  name: string;
  sku: string;
  attrs: Record<string, unknown>;
  /** Shelf unit price after flash/sale resolution, before any discount. */
  unitPriceVnd: number;
  qty: number;
  /** Non-voucher promotion discount on this line (qty × unit basis). */
  itemDiscountVnd: number;
  /** Shop + platform voucher share allocated to this line. */
  voucherDiscountVnd: number;
  lineTotalVnd: number;
};

export type ShopPricedGroup = {
  shopId: string;
  /** Merchandise subtotal after item promos, before vouchers. */
  subtotalVnd: number;
  shopDiscountVnd: number;
  shippingFeeVnd: number;
  shippingDiscountVnd: number;
  items: OrderLine[];
};

/** Mirrors order_pricing_breakdowns: discounts negative, fees positive. */
export type BreakdownLine = {
  lineType:
    | "ITEM_PROMO"
    | "SHOP_VOUCHER"
    | "PLATFORM_VOUCHER"
    | "SHIPPING_FEE"
    | "SHIPPING_VOUCHER";
  amountVnd: number;
  meta: Record<string, unknown>;
};

export type PricedOrder = {
  lines: OrderLine[];
  perShop: ShopPricedGroup[];
  platformDiscountVnd: number;
  grandTotalVnd: number;
  breakdown: BreakdownLine[];
  rejectedVouchers: VoucherRejection[];
  /** Vouchers actually applied — checkout passes these to consumeRedemptions. */
  appliedVouchers: AppliedVoucher[];
};

export type PriceOrderItem = { variantId: string; qty: number };
export type ShippingByShop = Record<string, { method: string; feeVnd: number }>;

type Store = Pick<DB, "select">;

const pctOf = (amountVnd: number, bps: number) => Math.floor((amountVnd * bps) / 10_000);

function voucherAmount(v: Voucher, baseVnd: number): number {
  let amount = v.kind === "PERCENT" ? pctOf(baseVnd, v.value) : v.value;
  if (v.maxDiscountVnd !== null) amount = Math.min(amount, v.maxDiscountVnd);
  return Math.min(Math.max(0, amount), baseVnd);
}

/**
 * Proportional-floor allocation of `discount` over line indexes' remaining
 * amounts; remainder goes to the last line (spec §4).
 */
function allocateToLines(lines: OrderLine[], idxs: number[], discount: number): number {
  const base = idxs.reduce((s, i) => s + lines[i].lineTotalVnd, 0);
  if (base <= 0 || discount <= 0 || idxs.length === 0) return 0;
  const applied = Math.min(discount, base);
  let given = 0;
  idxs.forEach((i, pos) => {
    const share =
      pos === idxs.length - 1
        ? applied - given
        : Math.floor((applied * lines[i].lineTotalVnd) / base);
    lines[i].voucherDiscountVnd += share;
    lines[i].lineTotalVnd -= share;
    given += share;
  });
  return applied;
}

/**
 * Authoritative server-side pricing (spec §4). Pure reads — no writes.
 * Order: flash/sale/base unit price → best single non-voucher promo per item →
 * ≤1 shop voucher per shop → ≤1 platform voucher → shipping vouchers last.
 */
export function priceOrder(
  db: Store,
  userId: string,
  items: PriceOrderItem[],
  voucherCodes: string[],
  shippingByShop: ShippingByShop = {},
  now = Date.now(),
): PricedOrder {
  if (items.length === 0) throw new AuthError("INVALID_INPUT", 400, "order has no items");
  const merged = new Map<string, number>();
  for (const { variantId, qty } of items) {
    if (!Number.isInteger(qty) || qty < 1) {
      throw new AuthError("INVALID_INPUT", 400, "qty must be a positive integer");
    }
    merged.set(variantId, (merged.get(variantId) ?? 0) + qty);
  }

  const activePromos = db
    .select()
    .from(promotions)
    .all()
    .filter((p) => p.status === "ACTIVE" && p.startsAt <= now && now < p.endsAt);

  const lines: OrderLine[] = [];
  const breakdown: BreakdownLine[] = [];
  for (const [variantId, qty] of merged) {
    const row = db
      .select({ v: productVariants, p: products })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(productVariants.id, variantId))
      .get();
    if (!row || row.p.status !== "ACTIVE") {
      throw new AuthError("NOT_FOUND", 404, `variant ${variantId} not found or not sellable`);
    }
    const { v, p } = row;

    // 1. unit price: flash window beats sale beats base.
    const flashes = activePromos.filter(
      (pr) => pr.scope === "FLASH" && pr.kind === "FLASH_PRICE" && pr.productId === p.id,
    );
    const unitPriceVnd =
      flashes.length > 0
        ? Math.min(...flashes.map((f) => f.value))
        : (v.salePriceVnd ?? v.basePriceVnd);
    const lineBase = unitPriceVnd * qty;

    // 2. best single non-voucher promo on the line total.
    const candidates = activePromos
      .filter(
        (pr) =>
          pr.kind !== "FLASH_PRICE" &&
          ((pr.scope === "PRODUCT" && pr.productId === p.id) ||
            (pr.scope === "SHOP" && pr.shopId === p.shopId)),
      )
      .map((pr) => ({
        pr,
        amount: Math.min(lineBase, pr.kind === "PERCENT" ? pctOf(lineBase, pr.value) : pr.value),
      }));
    const best = candidates.reduce<(typeof candidates)[number] | null>(
      (acc, c) => (acc === null || c.amount > acc.amount ? c : acc),
      null,
    );
    const itemDiscountVnd = best?.amount ?? 0;
    if (best) {
      breakdown.push({
        lineType: "ITEM_PROMO",
        amountVnd: -itemDiscountVnd,
        meta: { variantId, promotionId: best.pr.id },
      });
    }

    let attrs: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(v.attributesJson);
      if (typeof parsed === "object" && parsed !== null) attrs = parsed as Record<string, unknown>;
    } catch {
      attrs = {};
    }
    lines.push({
      variantId,
      productId: p.id,
      shopId: p.shopId,
      name: `${p.nameEn} · ${v.nameEn}`,
      sku: v.sku,
      attrs,
      unitPriceVnd,
      qty,
      itemDiscountVnd,
      voucherDiscountVnd: 0,
      lineTotalVnd: lineBase - itemDiscountVnd,
    });
  }

  // Per-shop grouping, preserving first-seen order.
  const perShop: ShopPricedGroup[] = [];
  for (const line of lines) {
    let g = perShop.find((s) => s.shopId === line.shopId);
    if (!g) {
      const ship = shippingByShop[line.shopId];
      g = {
        shopId: line.shopId,
        subtotalVnd: 0,
        shopDiscountVnd: 0,
        shippingFeeVnd: ship?.feeVnd ?? 0,
        shippingDiscountVnd: 0,
        items: [],
      };
      perShop.push(g);
      if (ship && ship.feeVnd > 0) {
        breakdown.push({
          lineType: "SHIPPING_FEE",
          amountVnd: ship.feeVnd,
          meta: { shopId: line.shopId, method: ship.method },
        });
      }
    }
    g.subtotalVnd += line.lineTotalVnd;
    g.items.push(line);
  }

  const rejectedVouchers: VoucherRejection[] = [];
  const appliedVouchers: AppliedVoucher[] = [];
  const byCode = new Map(
    db
      .select()
      .from(vouchers)
      .all()
      .map((v) => [v.code.toUpperCase(), v] as const),
  );
  const codes = [...new Set(voucherCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const rows = codes.map((code) => ({ code, voucher: byCode.get(code) ?? null }));

  const merchSubtotal = () => perShop.reduce((s, g) => s + g.subtotalVnd - g.shopDiscountVnd, 0);
  const shopOf = (v: Voucher) => perShop.find((g) => g.shopId === v.shopId);
  // 3–4. Non-shipping vouchers: ≤1 shop voucher per shop, ≤1 platform voucher.
  const shopVoucherUsed = new Set<string>();
  let platformVoucherUsed = false;
  let platformDiscountVnd = 0;
  for (const { code, voucher } of rows.filter((r) => r.voucher?.kind !== "SHIPPING")) {
    const reject = (reason: VoucherRejection["reason"]) => rejectedVouchers.push({ code, reason });
    if (!voucher) {
      reject("UNKNOWN");
      continue;
    }
    if (voucher.scope === "SHOP") {
      const group = shopOf(voucher);
      if (!group) {
        reject("WRONG_SHOP");
        continue;
      }
      if (shopVoucherUsed.has(group.shopId)) {
        reject("STACKING");
        continue;
      }
      const r = validateVoucher(db, voucher, {
        userId,
        scopeSubtotalVnd: group.subtotalVnd,
        shopId: group.shopId,
        now,
      });
      if (r) {
        rejectedVouchers.push({ code, reason: r.reason });
        continue;
      }
      const idxs = lines.flatMap((l, i) => (l.shopId === group.shopId ? [i] : []));
      const applied = allocateToLines(lines, idxs, voucherAmount(voucher, group.subtotalVnd));
      group.shopDiscountVnd += applied;
      breakdown.push({
        lineType: "SHOP_VOUCHER",
        amountVnd: -applied,
        meta: { code: voucher.code, voucherId: voucher.id, shopId: group.shopId },
      });
      appliedVouchers.push({ voucherId: voucher.id, code: voucher.code, discountVnd: applied });
      shopVoucherUsed.add(group.shopId);
    } else {
      if (platformVoucherUsed) {
        reject("STACKING");
        continue;
      }
      const base = merchSubtotal();
      const r = validateVoucher(db, voucher, { userId, scopeSubtotalVnd: base, now });
      if (r) {
        rejectedVouchers.push({ code, reason: r.reason });
        continue;
      }
      const applied = allocateToLines(
        lines,
        lines.map((_, i) => i),
        voucherAmount(voucher, base),
      );
      breakdown.push({
        lineType: "PLATFORM_VOUCHER",
        amountVnd: -applied,
        meta: { code: voucher.code, voucherId: voucher.id },
      });
      appliedVouchers.push({ voucherId: voucher.id, code: voucher.code, discountVnd: applied });
      platformDiscountVnd += applied;
      platformVoucherUsed = true;
    }
  }

  // 5. Shipping vouchers last, each capped by the shipping fees still payable.
  for (const { code, voucher } of rows.filter((r) => r.voucher?.kind === "SHIPPING")) {
    if (!voucher) continue; // unreachable — unknown rows never pass the filter
    const base = voucher.scope === "SHOP" ? (shopOf(voucher)?.subtotalVnd ?? 0) : merchSubtotal();
    const r = validateVoucher(db, voucher, {
      userId,
      scopeSubtotalVnd: base,
      shopId: voucher.scope === "SHOP" ? (voucher.shopId ?? undefined) : undefined,
      now,
    });
    if (r) {
      rejectedVouchers.push({ code, reason: r.reason });
      continue;
    }
    const pool = perShop.filter(
      (g) =>
        (voucher.scope !== "SHOP" || g.shopId === voucher.shopId) &&
        g.shippingFeeVnd - g.shippingDiscountVnd > 0,
    );
    if (pool.length === 0) {
      rejectedVouchers.push({
        code,
        reason: voucher.scope === "SHOP" ? "WRONG_SHOP" : "MIN_SPEND",
      });
      continue;
    }
    const remaining = pool.reduce((s, g) => s + g.shippingFeeVnd - g.shippingDiscountVnd, 0);
    const applied = Math.min(voucherAmount(voucher, remaining), remaining);
    let given = 0;
    pool.forEach((g, pos) => {
      const left = g.shippingFeeVnd - g.shippingDiscountVnd;
      const share =
        pos === pool.length - 1 ? applied - given : Math.floor((applied * left) / remaining);
      g.shippingDiscountVnd += share;
      given += share;
      breakdown.push({
        lineType: "SHIPPING_VOUCHER",
        amountVnd: -share,
        meta: { code: voucher.code, voucherId: voucher.id, shopId: g.shopId },
      });
    });
    appliedVouchers.push({ voucherId: voucher.id, code: voucher.code, discountVnd: applied });
  }

  const grandTotalVnd =
    lines.reduce((s, l) => s + l.lineTotalVnd, 0) +
    perShop.reduce((s, g) => s + g.shippingFeeVnd - g.shippingDiscountVnd, 0);

  return {
    lines,
    perShop,
    platformDiscountVnd,
    grandTotalVnd,
    breakdown,
    rejectedVouchers,
    appliedVouchers,
  };
}
