import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthError } from "@/server/api/errors";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import {
  products,
  productVariants,
  promotions,
  voucherRedemptions,
  vouchers,
} from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { priceOrder } from "@/server/modules/pricing/price-order";

const PATH = "./tests/.tmp/pricing-test.db";
const USER = "usr_customer";
const NOW = 1_760_000_000_000;
const WIN = { startsAt: NOW - 1000, endsAt: NOW + 86_400_000 };
// shop_1: var_1 (flash 99000, sale 135000, base 150000), var_2 (150000),
//         var_3 (420000), var_4 (sale 299000, base 350000), var_5 (350000)
// shop_2: var_6 (90000), var_7 (120000), var_8 (75000)
// promos: prm_1 SHOP shop_1 PERCENT 500; prm_2 FLASH prod_1 FLASH_PRICE 99000
// vouchers: WELCOME10 platform PERCENT 1000 cap 50000; SHOP2FIX shop_2 FIXED 20000 min 200000

let db: DB;
let seq = 0;

type VoucherFixture = Partial<typeof vouchers.$inferInsert> & { code: string; value: number };

function addVoucher(v: VoucherFixture) {
  seq += 1;
  db.insert(vouchers)
    .values({
      id: `vch_t${seq}`,
      code: v.code,
      scope: v.scope ?? "PLATFORM",
      shopId: v.shopId,
      kind: v.kind ?? "PERCENT",
      value: v.value,
      minSpendVnd: v.minSpendVnd ?? 0,
      maxDiscountVnd: v.maxDiscountVnd,
      startsAt: v.startsAt ?? WIN.startsAt,
      endsAt: v.endsAt ?? WIN.endsAt,
      totalLimit: v.totalLimit,
      perUserLimit: v.perUserLimit,
      usedCount: v.usedCount ?? 0,
      status: v.status ?? "ACTIVE",
    })
    .run();
}

function addPromo(
  p: Pick<typeof promotions.$inferInsert, "scope" | "kind" | "value"> &
    Partial<typeof promotions.$inferInsert>,
) {
  seq += 1;
  db.insert(promotions)
    .values({
      id: `prm_t${seq}`,
      scope: p.scope,
      productId: p.productId,
      shopId: p.shopId,
      kind: p.kind,
      value: p.value,
      startsAt: p.startsAt ?? WIN.startsAt,
      endsAt: p.endsAt ?? WIN.endsAt,
      status: p.status ?? "ACTIVE",
    })
    .run();
}

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as AuthError).code;
  }
  throw new Error("expected AuthError");
}

function price(items: { variantId: string; qty: number }[], codes: string[] = [], shipping = {}) {
  return priceOrder(db, USER, items, codes, shipping, NOW);
}

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
});

beforeEach(() => {
  db.delete(voucherRedemptions).run();
  db.delete(vouchers).run();
  db.delete(promotions).run();
  seedCatalog(db); // onConflictDoNothing → re-seeds only the deleted tables
  db.update(products).set({ status: "ACTIVE" }).run();
  db.update(productVariants)
    .set({ basePriceVnd: 90000 })
    .where(eq(productVariants.id, "var_6"))
    .run();
});

describe("unit price precedence", () => {
  it("uses flash price while the flash window is active", () => {
    const r = price([{ variantId: "var_1", qty: 1 }]);
    expect(r.lines[0].unitPriceVnd).toBe(99000);
  });

  it("uses sale price when it exists and no flash promo applies", () => {
    const r = price([{ variantId: "var_4", qty: 1 }]);
    expect(r.lines[0].unitPriceVnd).toBe(299000);
  });

  it("falls back to base price without a sale price", () => {
    const r = price([{ variantId: "var_3", qty: 1 }]);
    expect(r.lines[0].unitPriceVnd).toBe(420000);
  });

  it("uses base price once the flash window ends", () => {
    db.update(promotions)
      .set({ endsAt: NOW - 1 })
      .where(eq(promotions.id, "prm_2"))
      .run();
    const r = price([{ variantId: "var_1", qty: 1 }]);
    expect(r.lines[0].unitPriceVnd).toBe(135000); // sale
  });

  it("ignores promos outside their status or window", () => {
    db.update(promotions).set({ status: "SCHEDULED" }).where(eq(promotions.id, "prm_1")).run();
    const r = price([{ variantId: "var_3", qty: 1 }]);
    expect(r.lines[0].itemDiscountVnd).toBe(0);
    expect(r.lines[0].lineTotalVnd).toBe(420000);
  });
});

describe("non-voucher promotions", () => {
  it("applies the shop promo on the priced line (5% shop_1)", () => {
    const r = price([{ variantId: "var_3", qty: 1 }]);
    expect(r.lines[0].itemDiscountVnd).toBe(21000);
    expect(r.lines[0].lineTotalVnd).toBe(399000);
  });

  it("stacks shop promo on a flash-priced line", () => {
    const r = price([{ variantId: "var_1", qty: 1 }]);
    // floor(99000 * 500 / 10000) = 4950
    expect(r.lines[0].itemDiscountVnd).toBe(4950);
    expect(r.lines[0].lineTotalVnd).toBe(94050);
  });

  it("floors percent math to whole VND", () => {
    db.update(productVariants)
      .set({ basePriceVnd: 99999 })
      .where(eq(productVariants.id, "var_6"))
      .run();
    addPromo({ scope: "PRODUCT", productId: "prod_4", kind: "PERCENT", value: 1000 });
    const r = price([{ variantId: "var_6", qty: 1 }]);
    // floor(99999 * 0.1) = 9999
    expect(r.lines[0].itemDiscountVnd).toBe(9999);
    expect(r.lines[0].lineTotalVnd).toBe(90000);
  });

  it("clamps a fixed promo to the line total", () => {
    addPromo({ scope: "PRODUCT", productId: "prod_4", kind: "FIXED", value: 500000 });
    const r = price([{ variantId: "var_6", qty: 1 }]);
    expect(r.lines[0].itemDiscountVnd).toBe(90000);
    expect(r.lines[0].lineTotalVnd).toBe(0);
  });

  it("picks the best single promo when product and shop promos compete", () => {
    addPromo({ scope: "PRODUCT", productId: "prod_2", kind: "PERCENT", value: 2000 });
    const r = price([{ variantId: "var_3", qty: 1 }]);
    // product 20% (84000) beats shop 5% (21000)
    expect(r.lines[0].itemDiscountVnd).toBe(84000);
    expect(r.breakdown.find((b) => b.lineType === "ITEM_PROMO")?.meta.promotionId).toBeTruthy();
  });
});

describe("vouchers", () => {
  it("rejects unknown codes without dropping them silently", () => {
    const r = price([{ variantId: "var_8", qty: 1 }], ["NOPE"]);
    expect(r.rejectedVouchers).toEqual([{ code: "NOPE", reason: "UNKNOWN" }]);
    expect(r.appliedVouchers).toHaveLength(0);
  });

  it("applies a shop voucher after item promos (SHOP2FIX)", () => {
    const r = price([{ variantId: "var_7", qty: 2 }], ["SHOP2FIX"]);
    const shop = r.perShop.find((g) => g.shopId === "shop_2")!;
    expect(shop.subtotalVnd).toBe(240000);
    expect(shop.shopDiscountVnd).toBe(20000);
    expect(r.lines[0].voucherDiscountVnd).toBe(20000);
    expect(r.lines[0].lineTotalVnd).toBe(220000);
  });

  it("enforces shop-voucher min spend on the shop merchandise subtotal", () => {
    const r = price([{ variantId: "var_8", qty: 1 }], ["SHOP2FIX"]);
    expect(r.rejectedVouchers).toEqual([{ code: "SHOP2FIX", reason: "MIN_SPEND" }]);
    expect(r.perShop.find((g) => g.shopId === "shop_2")!.shopDiscountVnd).toBe(0);
  });

  it("rejects a shop voucher when the order has no lines from its shop", () => {
    const r = price([{ variantId: "var_3", qty: 1 }], ["SHOP2FIX"]);
    expect(r.rejectedVouchers).toEqual([{ code: "SHOP2FIX", reason: "WRONG_SHOP" }]);
  });

  it("applies the platform voucher across the whole order, capped", () => {
    // 99000-4950 + 420000-21000 = 493050 → 10% = 49305 (< 50k cap)
    const r = price(
      [
        { variantId: "var_1", qty: 1 },
        { variantId: "var_3", qty: 1 },
      ],
      ["WELCOME10"],
    );
    expect(r.platformDiscountVnd).toBe(49305);
    // proportional: floor(49305 * 94050/493050)=9405, floor(*399030/493050)=39903, last line + remainder
    expect(r.lines[0].voucherDiscountVnd).toBe(9405);
    expect(r.lines[1].voucherDiscountVnd).toBe(39900);
    expect(r.lines[0].lineTotalVnd + r.lines[1].lineTotalVnd).toBe(493050 - 49305);
  });

  it("honours maxDiscountVnd on percent vouchers", () => {
    const r = price(
      [
        { variantId: "var_3", qty: 1 },
        { variantId: "var_5", qty: 1 },
      ],
      ["WELCOME10"],
    );
    // subtotal 399000 + 332500 = 731500 → 10% = 73150 → capped 50000
    expect(r.platformDiscountVnd).toBe(50000);
    expect(r.rejectedVouchers).toEqual([]);
  });

  it("floors percent voucher math (bps on remaining subtotal)", () => {
    // var_7 120000 shop_2 (no promos) → 10% = 12000 exactly; use qty to force fraction
    db.update(productVariants)
      .set({ basePriceVnd: 99999 })
      .where(eq(productVariants.id, "var_6"))
      .run();
    addVoucher({ code: "P10", value: 1000 });
    const r = price([{ variantId: "var_6", qty: 1 }], ["P10"]);
    expect(r.platformDiscountVnd).toBe(9999); // floor(99999 * 0.1)
  });

  it("clamps a fixed voucher to the remaining subtotal", () => {
    addVoucher({ code: "BIGFIX", scope: "SHOP", shopId: "shop_2", kind: "FIXED", value: 500000 });
    const r = price([{ variantId: "var_6", qty: 1 }], ["BIGFIX"]);
    const shop = r.perShop.find((g) => g.shopId === "shop_2")!;
    expect(shop.shopDiscountVnd).toBe(90000);
    expect(r.lines[0].lineTotalVnd).toBe(0);
  });

  it("allocates remainder to the last line", () => {
    addVoucher({ code: "F1000", scope: "SHOP", shopId: "shop_2", kind: "FIXED", value: 1000 });
    const r = price(
      [
        { variantId: "var_6", qty: 1 },
        { variantId: "var_7", qty: 1 },
      ],
      ["F1000"],
    );
    // floor(1000*90000/210000)=428; remainder 572 → last line
    expect(r.lines[0].voucherDiscountVnd).toBe(428);
    expect(r.lines[1].voucherDiscountVnd).toBe(572);
    expect(r.lines[1].lineTotalVnd).toBe(120000 - 572);
  });

  it("reports every rejection reason", () => {
    addVoucher({ code: "EXP", value: 1000, startsAt: NOW - 2000, endsAt: NOW - 1 });
    addVoucher({ code: "FUT", value: 1000, startsAt: NOW + 1000, endsAt: NOW + 2000 });
    addVoucher({ code: "OFF", value: 1000, status: "DISABLED" });
    addVoucher({ code: "EXH", value: 1000, totalLimit: 0 });
    const r = price([{ variantId: "var_8", qty: 1 }], ["EXP", "FUT", "OFF", "EXH", "GONE"]);
    expect(r.rejectedVouchers).toEqual([
      { code: "EXP", reason: "EXPIRED" },
      { code: "FUT", reason: "NOT_STARTED" },
      { code: "OFF", reason: "DISABLED" },
      { code: "EXH", reason: "TOTAL_LIMIT" },
      { code: "GONE", reason: "UNKNOWN" },
    ]);
  });

  it("rejects a second voucher for the same shop and a second platform voucher", () => {
    addVoucher({ code: "S2A", scope: "SHOP", shopId: "shop_2", kind: "FIXED", value: 1000 });
    addVoucher({ code: "P2", value: 500 });
    const r = price([{ variantId: "var_7", qty: 2 }], ["SHOP2FIX", "S2A", "WELCOME10", "P2"]);
    expect(r.rejectedVouchers).toEqual([
      { code: "S2A", reason: "STACKING" },
      { code: "P2", reason: "STACKING" },
    ]);
    // SHOP2FIX applied (20000) + WELCOME10 on remaining 220000 → 22000
    const shop = r.perShop.find((g) => g.shopId === "shop_2")!;
    expect(shop.shopDiscountVnd).toBe(20000);
    expect(r.platformDiscountVnd).toBe(22000);
  });

  it("treats per-user limit via voucher_redemptions", () => {
    db.insert(voucherRedemptions)
      .values({ id: "red_t1", voucherId: "vch_1", userId: USER, createdAt: NOW })
      .run();
    const r = price([{ variantId: "var_8", qty: 1 }], ["WELCOME10"]);
    expect(r.rejectedVouchers).toEqual([{ code: "WELCOME10", reason: "USER_LIMIT" }]);
  });

  it("normalizes case and dedupes repeated codes", () => {
    const r = price([{ variantId: "var_7", qty: 2 }], [" shop2fix ", "SHOP2FIX"]);
    expect(r.rejectedVouchers).toEqual([]);
    expect(r.appliedVouchers).toHaveLength(1);
  });
});

describe("shipping", () => {
  it("adds per-shop fees and applies a platform shipping voucher last", () => {
    addVoucher({ code: "SHIP", kind: "SHIPPING", value: 25000 });
    const r = price(
      [
        { variantId: "var_3", qty: 1 },
        { variantId: "var_6", qty: 1 },
      ],
      ["SHIP"],
      {
        shop_1: { method: "STANDARD", feeVnd: 20000 },
        shop_2: { method: "STANDARD", feeVnd: 30000 },
      },
    );
    // fee pool 50000 → applied 25000: shop_1 floor(25000*20000/50000)=10000, shop_2 15000
    const s1 = r.perShop.find((g) => g.shopId === "shop_1")!;
    const s2 = r.perShop.find((g) => g.shopId === "shop_2")!;
    expect([s1.shippingFeeVnd, s1.shippingDiscountVnd]).toEqual([20000, 10000]);
    expect([s2.shippingFeeVnd, s2.shippingDiscountVnd]).toEqual([30000, 15000]);
    expect(r.grandTotalVnd).toBe(399000 + 90000 + 50000 - 25000);
  });

  it("caps a shipping voucher at the remaining fee", () => {
    addVoucher({
      code: "SHIPALL",
      kind: "SHIPPING",
      scope: "SHOP",
      shopId: "shop_2",
      value: 99999,
    });
    const r = price([{ variantId: "var_6", qty: 1 }], ["SHIPALL"], {
      shop_2: { method: "EXPRESS", feeVnd: 20000 },
    });
    expect(r.perShop[0].shippingDiscountVnd).toBe(20000);
  });

  it("rejects a shipping voucher when nothing is left to discount", () => {
    addVoucher({ code: "SHIP", kind: "SHIPPING", value: 1000 });
    const r = price([{ variantId: "var_6", qty: 1 }], ["SHIP"]);
    expect(r.rejectedVouchers).toEqual([{ code: "SHIP", reason: "MIN_SPEND" }]);
  });
});

describe("order shape", () => {
  it("splits a multi-shop order and keeps the grand-total invariant", () => {
    const r = price(
      [
        { variantId: "var_1", qty: 1 },
        { variantId: "var_7", qty: 2 },
      ],
      ["SHOP2FIX", "WELCOME10"],
      {
        shop_1: { method: "STANDARD", feeVnd: 15000 },
        shop_2: { method: "EXPRESS", feeVnd: 30000 },
      },
    );
    expect(r.perShop.map((g) => g.shopId)).toEqual(["shop_1", "shop_2"]);
    const s1 = r.perShop[0];
    const s2 = r.perShop[1];
    // shop_1: 99000 - 4950 = 94050; shop_2: 240000 - 20000 = 220000
    expect(s1.subtotalVnd - s1.shopDiscountVnd).toBe(94050);
    expect(s2.subtotalVnd - s2.shopDiscountVnd).toBe(220000);
    // platform: 10% of 314050 = 31405
    expect(r.platformDiscountVnd).toBe(31405);
    expect(r.grandTotalVnd).toBe(94050 + 220000 - 31405 + 45000);
    const recomputed =
      r.lines.reduce((s, l) => s + l.lineTotalVnd, 0) +
      r.perShop.reduce((s, g) => s + g.shippingFeeVnd - g.shippingDiscountVnd, 0);
    expect(r.grandTotalVnd).toBe(recomputed);
    expect(r.appliedVouchers.map((v) => v.code)).toEqual(["SHOP2FIX", "WELCOME10"]);
  });

  it("rejects empty orders, bad qty, unknown variants, unsellable products", () => {
    expect(errorCode(() => price([]))).toBe("INVALID_INPUT");
    expect(errorCode(() => price([{ variantId: "var_6", qty: 0 }]))).toBe("INVALID_INPUT");
    expect(errorCode(() => price([{ variantId: "var_nope", qty: 1 }]))).toBe("NOT_FOUND");
    db.update(products).set({ status: "DRAFT" }).where(eq(products.id, "prod_6")).run();
    expect(errorCode(() => price([{ variantId: "var_8", qty: 1 }]))).toBe("NOT_FOUND");
  });

  it("merges duplicate variant rows into one line", () => {
    const r = price([
      { variantId: "var_6", qty: 1 },
      { variantId: "var_6", qty: 2 },
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].qty).toBe(3);
  });
});
