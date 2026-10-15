import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { RequestReturnInput } from "@/server/api/contracts/returns";
import type { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { orderItems, sellerOrders } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { addItem, clearCart } from "@/server/modules/cart/service";
import { getSellerProduct } from "@/server/modules/catalog/manage";
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
import { decideReturn, requestReturn } from "@/server/modules/orders/returns";
import { getSellerOrder } from "@/server/modules/orders/service";

const PATH = "./tests/.tmp/authz-boundaries-test.db";
const CUSTOMER: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };
const ADMIN: Actor = { userId: "usr_admin", roles: ["ADMIN"], memberships: [] };
const SELLER_A: Actor = {
  userId: "usr_seller",
  roles: ["SELLER"],
  memberships: [{ shopId: "shop_1", role: "OWNER", permissions: [] }],
};
const SELLER_B: Actor = {
  userId: "usr_seller2",
  roles: ["SELLER"],
  memberships: [{ shopId: "shop_2", role: "OWNER", permissions: [] }],
};
const ADDRESS = "addr_1"; // seeded for usr_customer

let db: DB;
let keySeq = 0;
const nextKey = () => `az_${++keySeq}`;

async function errorCode(fn: () => Promise<unknown> | unknown): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as AuthError).code;
  }
  throw new Error("expected AuthError");
}

function cartItemId(variantId: string, qty: number): string {
  clearCart(db, CUSTOMER.userId); // cart persists across tests — qty must be exact
  return addItem(db, CUSTOMER.userId, variantId, qty).items.find((i) => i.variantId === variantId)!
    .cartItemId;
}

function leg(orderId: string, shopId = "shop_1") {
  return db
    .select()
    .from(sellerOrders)
    .where(eq(sellerOrders.orderId, orderId))
    .all()
    .find((s) => s.shopId === shopId)!;
}

/** A paid MOCK_WALLET order whose shop_1 leg is NEW. Returns the leg id. */
async function newLeg(variantId: string): Promise<string> {
  const res = await placeOrder(db, CUSTOMER, {
    cartItemIds: [cartItemId(variantId, 1)],
    addressId: ADDRESS,
    shippingByShop: {},
    voucherCodes: [],
    paymentMethod: "MOCK_WALLET",
    idempotencyKey: nextKey(),
  });
  return leg(res.orderId).id;
}

/** shop_1 leg driven NEW → CONFIRMED → PACKING by its owner. */
async function packingLeg(variantId: string): Promise<string> {
  const id = await newLeg(variantId);
  confirmSellerOrder(db, SELLER_A, id);
  packSellerOrder(db, SELLER_A, id);
  return id;
}

/** shop_1 leg driven through SHIPPED by its owner. */
async function shippedLeg(variantId: string): Promise<string> {
  const id = await packingLeg(variantId);
  shipSellerOrder(db, SELLER_A, id, { carrier: "ghn", trackingNumber: nextKey() });
  return id;
}

/** shop_1 leg DELIVERED by its owner. */
async function deliveredLeg(variantId: string): Promise<string> {
  const id = await shippedLeg(variantId);
  deliverSellerOrder(db, SELLER_A, id);
  return id;
}

/** shop_1 leg COMPLETED by its owner. */
async function completedLeg(variantId: string): Promise<string> {
  const id = await deliveredLeg(variantId);
  completeSellerOrder(db, SELLER_A, id);
  return id;
}

/** A PENDING return request (filed by the buyer) on a delivered shop_1 leg. */
async function pendingReturn(variantId: string): Promise<string> {
  const sellerOrderId = await deliveredLeg(variantId);
  const item = db
    .select()
    .from(orderItems)
    .where(eq(orderItems.sellerOrderId, sellerOrderId))
    .all()[0]!;
  return requestReturn(
    db,
    CUSTOMER,
    RequestReturnInput.parse({
      sellerOrderId,
      items: [{ orderItemId: item.id, qty: 1, restock: false }],
      reason: "changed my mind",
    }),
  );
}

let pendingSettlementId: string;

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
  // seedCatalog → seedReviews leaves COMPLETED legs behind; settle them so
  // generateSettlement assertions below only see legs this file creates.
  generateSettlement(db, ADMIN, "shop_1");
  generateSettlement(db, ADMIN, "shop_2");
});

describe("cross-seller boundary (SELLER_B acting on shop_1 resources)", () => {
  it("getSellerOrder → FORBIDDEN", async () => {
    const id = await newLeg("var_1");
    expect(await errorCode(() => getSellerOrder(db, SELLER_B, id))).toBe("FORBIDDEN");
  });

  it("shipSellerOrder → FORBIDDEN", async () => {
    const id = await packingLeg("var_2");
    expect(
      await errorCode(() =>
        shipSellerOrder(db, SELLER_B, id, { carrier: "ghn", trackingNumber: nextKey() }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("deliverSellerOrder → FORBIDDEN", async () => {
    const id = await shippedLeg("var_3");
    expect(await errorCode(() => deliverSellerOrder(db, SELLER_B, id))).toBe("FORBIDDEN");
  });

  it("decideReturn → FORBIDDEN", async () => {
    const id = await pendingReturn("var_4");
    expect(await errorCode(() => decideReturn(db, SELLER_B, id, "APPROVED"))).toBe("FORBIDDEN");
  });

  it("getSellerProduct → FORBIDDEN", async () => {
    expect(await errorCode(() => getSellerProduct(db, SELLER_B, "prod_1"))).toBe("FORBIDDEN");
  });

  it("generateSettlement → FORBIDDEN", async () => {
    await completedLeg("var_5"); // real pending work exists — the denial is authz, not INVALID_INPUT
    expect(await errorCode(() => generateSettlement(db, SELLER_B, "shop_1"))).toBe("FORBIDDEN");
  });

  it("markSettlementPaid → FORBIDDEN", async () => {
    pendingSettlementId = generateSettlement(db, ADMIN, "shop_1");
    expect(await errorCode(() => markSettlementPaid(db, SELLER_B, pendingSettlementId))).toBe(
      "FORBIDDEN",
    );
  });

  it("listSettlements(shopId: shop_1) → FORBIDDEN", async () => {
    expect(await errorCode(() => listSettlements(db, SELLER_B, { shopId: "shop_1" }))).toBe(
      "FORBIDDEN",
    );
  });
});

describe("customer boundary (CUSTOMER acting on seller/admin surfaces)", () => {
  it("getSellerOrder → FORBIDDEN", async () => {
    const id = await newLeg("var_1");
    expect(await errorCode(() => getSellerOrder(db, CUSTOMER, id))).toBe("FORBIDDEN");
  });

  it("shipSellerOrder → FORBIDDEN", async () => {
    const id = await packingLeg("var_2");
    expect(
      await errorCode(() =>
        shipSellerOrder(db, CUSTOMER, id, { carrier: "ghn", trackingNumber: nextKey() }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("deliverSellerOrder → FORBIDDEN", async () => {
    const id = await shippedLeg("var_3");
    expect(await errorCode(() => deliverSellerOrder(db, CUSTOMER, id))).toBe("FORBIDDEN");
  });

  it("decideReturn → FORBIDDEN", async () => {
    const id = await pendingReturn("var_4");
    expect(await errorCode(() => decideReturn(db, CUSTOMER, id, "REJECTED", "no"))).toBe(
      "FORBIDDEN",
    );
  });

  it("getSellerProduct → FORBIDDEN", async () => {
    expect(await errorCode(() => getSellerProduct(db, CUSTOMER, "prod_1"))).toBe("FORBIDDEN");
  });

  it("generateSettlement → FORBIDDEN", async () => {
    expect(await errorCode(() => generateSettlement(db, CUSTOMER, "shop_1"))).toBe("FORBIDDEN");
  });

  it("markSettlementPaid → FORBIDDEN", async () => {
    expect(await errorCode(() => markSettlementPaid(db, CUSTOMER, pendingSettlementId))).toBe(
      "FORBIDDEN",
    );
  });

  it("listSettlements → FORBIDDEN", async () => {
    // No membership: shopId can't be inferred and order:read has no shop.
    expect(await errorCode(() => listSettlements(db, CUSTOMER, {}))).toBe("FORBIDDEN");
  });
});

describe("admin access (ADMIN reaches shop_1 resources)", () => {
  it("getSellerOrder returns the detail", async () => {
    const id = await newLeg("var_1");
    const detail = getSellerOrder(db, ADMIN, id);
    expect(detail.sellerOrder.id).toBe(id);
    expect(detail.shop?.id).toBe("shop_1");
  });

  it("shipSellerOrder ships the leg", async () => {
    const id = await packingLeg("var_2");
    const so = shipSellerOrder(db, ADMIN, id, { carrier: "ghn", trackingNumber: nextKey() });
    expect(so.status).toBe("SHIPPED");
  });

  it("deliverSellerOrder delivers the leg", async () => {
    const id = await shippedLeg("var_3");
    const so = deliverSellerOrder(db, ADMIN, id);
    expect(so.status).toBe("DELIVERED");
  });

  it("decideReturn decides a pending request", async () => {
    const id = await pendingReturn("var_4");
    await decideReturn(db, ADMIN, id, "REJECTED", "admin declines");
  });

  it("getSellerProduct returns the product", async () => {
    const p = getSellerProduct(db, ADMIN, "prod_1");
    expect(p.id).toBe("prod_1");
    expect(p.shopId).toBe("shop_1");
  });

  it("generateSettlement creates a settlement", async () => {
    await completedLeg("var_5");
    const id = generateSettlement(db, ADMIN, "shop_1");
    expect(id).toMatch(/^stl_/);
  });

  it("markSettlementPaid pays a pending settlement", async () => {
    markSettlementPaid(db, ADMIN, pendingSettlementId);
  });
});

describe("owner access (SELLER_A on its own shop_1 resources)", () => {
  it("getSellerOrder returns the detail", async () => {
    const id = await newLeg("var_1");
    expect(getSellerOrder(db, SELLER_A, id).sellerOrder.id).toBe(id);
  });

  it("deliverSellerOrder delivers the leg", async () => {
    const id = await shippedLeg("var_3");
    expect(deliverSellerOrder(db, SELLER_A, id).status).toBe("DELIVERED");
  });

  it("decideReturn approves a pending request", async () => {
    const id = await pendingReturn("var_4");
    await decideReturn(db, SELLER_A, id, "APPROVED", "ok");
  });

  it("getSellerProduct returns the product", async () => {
    expect(getSellerProduct(db, SELLER_A, "prod_1").id).toBe("prod_1");
  });

  it("generateSettlement settles its own shop", async () => {
    await completedLeg("var_5");
    expect(generateSettlement(db, SELLER_A, "shop_1")).toMatch(/^stl_/);
  });

  it("listSettlements sees only its own shop", async () => {
    const { items } = listSettlements(db, SELLER_A, {});
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((s) => s.shopId === "shop_1")).toBe(true);
  });
});
