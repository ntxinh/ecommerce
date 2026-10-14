import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import {
  financialLedgerEntries,
  sellerOrders,
  sellerSettlements,
  settlementItems,
} from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { addItem } from "@/server/modules/cart/service";
import {
  generateSettlement,
  listSettlements,
  markSettlementPaid,
} from "@/server/modules/finance/settlements";
import { placeOrder } from "@/server/modules/orders/checkout";
import {
  completeSellerOrder,
  confirmSellerOrder,
  deliverSellerOrder,
  packSellerOrder,
  shipSellerOrder,
} from "@/server/modules/orders/fulfillment";

const PATH = "./tests/.tmp/settlements-test.db";
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

let db: DB;
let keySeq = 0;
const nextKey = () => `set_${++keySeq}`;

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

/** One paid order → shop_1 leg driven NEW → … → COMPLETED by its owner. */
async function completedLeg(variantId: string, qty = 1) {
  const res = await placeOrder(db, CUSTOMER, {
    cartItemIds: [cartItemId(variantId, qty)],
    addressId: ADDRESS,
    shippingByShop: {},
    voucherCodes: [],
    paymentMethod: "MOCK_WALLET",
    idempotencyKey: nextKey(),
  });
  const so = leg(res.orderId, "shop_1");
  confirmSellerOrder(db, SHOP1_OWNER, so.id);
  packSellerOrder(db, SHOP1_OWNER, so.id);
  shipSellerOrder(db, SHOP1_OWNER, so.id, { carrier: "ghn", trackingNumber: nextKey() });
  deliverSellerOrder(db, SHOP1_OWNER, so.id);
  completeSellerOrder(db, SHOP1_OWNER, so.id);
  return leg(res.orderId, "shop_1");
}

const settlement = (id: string) =>
  db.select().from(sellerSettlements).where(eq(sellerSettlements.id, id)).get();

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
  // seedCatalog → seedReviews leaves COMPLETED legs behind; settle them up
  // front so every test below counts only legs it creates itself.
  generateSettlement(db, ADMIN, "shop_1");
  generateSettlement(db, ADMIN, "shop_2");
});

describe("generateSettlement", () => {
  it("settles two COMPLETED legs with correct gross/commission/net sums", async () => {
    const a = await completedLeg("var_1"); // sale price 135000
    const b = await completedLeg("var_2"); // base 150000

    const id = generateSettlement(db, SHOP1_OWNER, "shop_1");
    const s = settlement(id)!;
    expect(s.shopId).toBe("shop_1");
    expect(s.status).toBe("PENDING");
    const gross = a.subtotalVnd + b.subtotalVnd;
    const commission = comm(a.subtotalVnd) + comm(b.subtotalVnd);
    expect(s.grossVnd).toBe(gross);
    expect(s.commissionVnd).toBe(commission);
    expect(s.refundVnd).toBe(0);
    expect(s.netVnd).toBe(gross - commission);

    const items = db
      .select()
      .from(settlementItems)
      .where(eq(settlementItems.settlementId, id))
      .all();
    expect(items.map((i) => i.sellerOrderId).sort()).toEqual([a.id, b.id].sort());
    for (const item of items) {
      const so = item.sellerOrderId === a.id ? a : b;
      expect(item.grossVnd).toBe(so.subtotalVnd);
      expect(item.commissionVnd).toBe(comm(so.subtotalVnd));
      expect(item.netVnd).toBe(so.subtotalVnd - comm(so.subtotalVnd));
    }
  });

  it("a second generate settles only unsettled legs, then INVALID_INPUT when none left", async () => {
    const c = await completedLeg("var_3"); // base 420000
    const id = generateSettlement(db, ADMIN, "shop_1");
    const items = db
      .select()
      .from(settlementItems)
      .where(eq(settlementItems.settlementId, id))
      .all();
    expect(items).toHaveLength(1);
    expect(items[0].sellerOrderId).toBe(c.id);
    expect(settlement(id)?.netVnd).toBe(c.subtotalVnd - comm(c.subtotalVnd));

    expect(await errorCode(() => generateSettlement(db, ADMIN, "shop_1"))).toBe("INVALID_INPUT");
    expect(await errorCode(() => generateSettlement(db, ADMIN, "shop_2"))).toBe("INVALID_INPUT");
  });

  it("rejects non-admin non-owner actors", async () => {
    expect(await errorCode(() => generateSettlement(db, CUSTOMER, "shop_1"))).toBe("FORBIDDEN");
    expect(await errorCode(() => generateSettlement(db, SHOP2_OWNER, "shop_1"))).toBe("FORBIDDEN");
    expect(await errorCode(() => generateSettlement(db, null, "shop_1"))).toBe("UNAUTHORIZED");
  });
});

describe("markSettlementPaid", () => {
  it("PENDING → PAID, sets paid_at, posts SELLER_PAYABLE −net SETTLEMENT entry", async () => {
    await completedLeg("var_4");
    const id = generateSettlement(db, SHOP1_OWNER, "shop_1");
    const s = settlement(id)!;

    markSettlementPaid(db, ADMIN, id);
    const paid = settlement(id)!;
    expect(paid.status).toBe("PAID");
    expect(paid.paidAt).not.toBeNull();

    const entries = db
      .select()
      .from(financialLedgerEntries)
      .where(eq(financialLedgerEntries.refId, id))
      .all();
    expect(entries).toHaveLength(1);
    expect(entries[0].account).toBe("SELLER_PAYABLE");
    expect(entries[0].refType).toBe("SETTLEMENT");
    expect(entries[0].shopId).toBe("shop_1");
    expect(entries[0].amountVnd).toBe(-s.netVnd);
  });

  it("rejects non-admin and already-paid settlements", async () => {
    await completedLeg("var_5");
    const id = generateSettlement(db, SHOP1_OWNER, "shop_1");
    expect(await errorCode(() => markSettlementPaid(db, SHOP1_OWNER, id))).toBe("FORBIDDEN");
    expect(await errorCode(() => markSettlementPaid(db, ADMIN, "set_missing"))).toBe("NOT_FOUND");

    markSettlementPaid(db, ADMIN, id);
    expect(await errorCode(() => markSettlementPaid(db, ADMIN, id))).toBe("INVALID_INPUT");
  });
});

describe("listSettlements", () => {
  it("owner sees own shop only; admin sees all; status/cursor filter", async () => {
    const own = listSettlements(db, SHOP1_OWNER, {});
    expect(own.items.length).toBeGreaterThanOrEqual(3);
    expect(own.items.every((s) => s.shopId === "shop_1")).toBe(true);

    expect(await errorCode(() => listSettlements(db, SHOP1_OWNER, { shopId: "shop_2" }))).toBe(
      "FORBIDDEN",
    );
    expect(await errorCode(() => listSettlements(db, null, {}))).toBe("UNAUTHORIZED");

    const all = listSettlements(db, ADMIN, {});
    // own shop_1 settlements + the drained shop_2 seed settlement
    expect(all.items.length).toBe(own.items.length + 1);
    expect(all.items.some((s) => s.shopId === "shop_2")).toBe(true);

    const pending = listSettlements(db, ADMIN, { status: "PENDING" });
    expect(pending.items.every((s) => s.status === "PENDING")).toBe(true);
    expect(pending.items.length).toBeLessThan(all.items.length); // two are PAID

    const first = listSettlements(db, ADMIN, { shopId: "shop_1", limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const rest = listSettlements(db, ADMIN, {
      shopId: "shop_1",
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(rest.items[0].id).not.toBe(first.items[0].id);
  });
});
