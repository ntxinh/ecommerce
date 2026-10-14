import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import {
  orderItems,
  refunds,
  returnItems,
  returnRequests,
  sellerOrders,
  sellerSettlements,
} from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { addItem } from "@/server/modules/cart/service";
import { sellerAnalytics } from "@/server/modules/finance/analytics";
import { generateSettlement } from "@/server/modules/finance/settlements";
import { placeOrder } from "@/server/modules/orders/checkout";
import {
  cancelSellerOrder,
  completeSellerOrder,
  confirmSellerOrder,
  deliverSellerOrder,
  packSellerOrder,
  shipSellerOrder,
} from "@/server/modules/orders/fulfillment";
import { decideReturn, requestReturn } from "@/server/modules/orders/returns";

const PATH = "./tests/.tmp/analytics-test.db";
const CUSTOMER: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };
const ADMIN: Actor = { userId: "usr_admin", roles: ["ADMIN"], memberships: [] };
const SHOP1_OWNER: Actor = {
  userId: "usr_seller",
  roles: ["SELLER"],
  memberships: [{ shopId: "shop_1", role: "OWNER", permissions: [] }],
};
const SHOP2_OWNER: Actor = {
  userId: "usr_seller2",
  roles: ["SELLER"],
  memberships: [{ shopId: "shop_2", role: "OWNER", permissions: [] }],
};
const ADDRESS = "addr_1"; // seeded for usr_customer
const BPS = 500; // seeded commission_rate_bps
const comm = (subtotalVnd: number) => Math.floor((subtotalVnd * BPS) / 10_000);

// seedReviews legs: shop_1 has so_1 135000 + so_2 135000 + so_4 299000 (all COMPLETED).
const SEED_GMV_1 = 135_000 + 135_000 + 299_000;
const SEED_UNITS_1 = 3; // oi_1 qty1 + oi_2 qty1 + oi_5 qty1
const SEED_LEGS_1 = 3;

let db: DB;
let keySeq = 0;
const nextKey = () => `an_${++keySeq}`;

async function errorCode(fn: () => Promise<unknown> | unknown): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as AuthError).code;
  }
  throw new Error("expected AuthError");
}

function cartItemId(variantId: string, qty: number): string {
  const view = addItem(db, CUSTOMER.userId, variantId, qty);
  return view.items.find((i) => i.variantId === variantId)!.cartItemId;
}

function leg(orderId: string, shopId: string) {
  return db
    .select()
    .from(sellerOrders)
    .where(eq(sellerOrders.orderId, orderId))
    .all()
    .find((s) => s.shopId === shopId)!;
}

async function placeLeg(variantId: string, qty: number) {
  const res = await placeOrder(db, CUSTOMER, {
    cartItemIds: [cartItemId(variantId, qty)],
    addressId: ADDRESS,
    shippingByShop: {},
    voucherCodes: [],
    paymentMethod: "MOCK_WALLET",
    idempotencyKey: nextKey(),
  });
  return res.orderId;
}

/** One paid order → leg of `shopId` driven NEW → … → COMPLETED by its owner. */
async function completedLeg(variantId: string, shopId = "shop_1", qty = 1) {
  const owner = shopId === "shop_1" ? SHOP1_OWNER : SHOP2_OWNER;
  const orderId = await placeLeg(variantId, qty);
  const so = leg(orderId, shopId);
  confirmSellerOrder(db, owner, so.id);
  packSellerOrder(db, owner, so.id);
  shipSellerOrder(db, owner, so.id, { carrier: "ghn", trackingNumber: nextKey() });
  deliverSellerOrder(db, owner, so.id);
  completeSellerOrder(db, owner, so.id);
  return leg(orderId, shopId);
}

const pct = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 10 : 0);
const dayKey = () => new Date().toISOString().slice(0, 10);

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
});

describe("sellerAnalytics", () => {
  it("requires order:read on the shop", async () => {
    expect(await errorCode(() => sellerAnalytics(db, null, "shop_1"))).toBe("UNAUTHORIZED");
    expect(await errorCode(() => sellerAnalytics(db, CUSTOMER, "shop_1"))).toBe("FORBIDDEN");
    expect(await errorCode(() => sellerAnalytics(db, SHOP2_OWNER, "shop_1"))).toBe("FORBIDDEN");
    expect(() => sellerAnalytics(db, ADMIN, "shop_1")).not.toThrow();
  });

  it("reports seeded legs for a fresh shop", () => {
    const a = sellerAnalytics(db, SHOP1_OWNER, "shop_1");
    expect(a.gmvVnd).toBe(SEED_GMV_1);
    expect(a.netSalesVnd).toBe(SEED_GMV_1); // no refunds yet
    expect(a.orderCount).toBe(SEED_LEGS_1);
    expect(a.unitsSold).toBe(SEED_UNITS_1);
    expect(a.avgOrderValueVnd).toBe(Math.floor(SEED_GMV_1 / SEED_LEGS_1));
    expect(a.cancelRatePct).toBe(0);
    expect(a.returnRatePct).toBe(0);
    expect(a.estimatedCommissionsVnd).toBe(comm(SEED_GMV_1));
    expect(a.pendingSettlementVnd).toBe(0);
    // prod_1 sells 1+1 across so_1/so_2; prod_3 sells 1.
    expect(a.bestSellers[0]).toEqual({
      productId: "prod_1",
      name: "Handmade Ceramic Mug",
      units: 2,
    });
    // Seeded legs are at SEEDED_AT (2025-01-01) — outside the 30-day window.
    expect(a.daily).toHaveLength(30);
    expect(a.daily[0].day).toBe(new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));
    expect(a.daily[29].day).toBe(dayKey());
    expect(a.daily.every((d) => d.gmvVnd === 0)).toBe(true);
    expect(a.lowStockCount).toBeGreaterThanOrEqual(0);
  });

  it("counts new legs, a cancelled leg, and a refunded leg correctly", async () => {
    const a = await completedLeg("var_1", "shop_1", 1);
    const b = await completedLeg("var_2", "shop_1", 2);
    const cOrder = await placeLeg("var_4", 1);
    const cLeg = leg(cOrder, "shop_1");
    await cancelSellerOrder(db, SHOP1_OWNER, cLeg.id);

    // Refunded leg: full-quantity return on a COMPLETED leg → RETURNED +
    // COMPLETED refund. var_5 is a fresh cart line (addItem bumps qty on reuse).
    const r = await completedLeg("var_5", "shop_1", 1);
    const item = db.select().from(orderItems).where(eq(orderItems.sellerOrderId, r.id)).get()!;
    const rrId = requestReturn(db, CUSTOMER, {
      sellerOrderId: r.id,
      items: [{ orderItemId: item.id, qty: 1, restock: false }],
      reason: "arrived damaged",
      evidence: [],
    });
    await decideReturn(db, SHOP1_OWNER, rrId, "APPROVED");
    expect(leg(r.orderId, "shop_1").status).toBe("RETURNED");
    const refundRows = db
      .select()
      .from(refunds)
      .innerJoin(returnItems, eq(refunds.returnItemId, returnItems.id))
      .innerJoin(returnRequests, eq(returnItems.returnRequestId, returnRequests.id))
      .where(eq(returnRequests.sellerOrderId, r.id))
      .all();
    expect(refundRows).toHaveLength(1);
    expect(refundRows[0].refunds.status).toBe("COMPLETED");
    const x = refundRows[0].refunds.amountVnd;

    // PENDING settlement covering everything to date.
    generateSettlement(db, ADMIN, "shop_1");
    const pending = db
      .select()
      .from(sellerSettlements)
      .all()
      .filter((s) => s.shopId === "shop_1" && s.status === "PENDING");

    const s = sellerAnalytics(db, SHOP1_OWNER, "shop_1");

    // CANCELLED leg excluded from gmv/orderCount/units, counted in cancelRate.
    const gmv = SEED_GMV_1 + a.subtotalVnd + b.subtotalVnd + r.subtotalVnd;
    const legs = SEED_LEGS_1 + 4; // 3 completed + 1 cancelled
    expect(s.gmvVnd).toBe(gmv);
    expect(s.netSalesVnd).toBe(gmv - x);
    expect(s.orderCount).toBe(legs - 1);
    expect(s.unitsSold).toBe(SEED_UNITS_1 + 1 + 2 + 1);
    expect(s.avgOrderValueVnd).toBe(Math.floor(gmv / (legs - 1)));
    expect(s.cancelRatePct).toBe(pct(1, legs));
    expect(s.returnRatePct).toBe(pct(1, legs));
    expect(s.estimatedCommissionsVnd).toBe(
      comm(SEED_GMV_1) + comm(a.subtotalVnd) + comm(b.subtotalVnd) + comm(r.subtotalVnd),
    );
    expect(s.pendingSettlementVnd).toBe(pending.reduce((n, st) => n + st.netVnd, 0));
    expect(s.pendingSettlementVnd).toBeGreaterThan(0);

    // prod_1: 2 seeded + a(qty1) + b(var_2 is prod_1, qty2) = 5.
    expect(s.bestSellers[0]).toEqual({
      productId: "prod_1",
      name: "Handmade Ceramic Mug",
      units: 5,
    });

    // Today's bucket holds the three live legs' gmv; cancelled contributes 0.
    const today = s.daily.find((d) => d.day === dayKey())!;
    expect(today.gmvVnd).toBe(a.subtotalVnd + b.subtotalVnd + r.subtotalVnd);
    expect(s.daily.reduce((n, d) => n + d.gmvVnd, 0)).toBe(today.gmvVnd);
  });
});
