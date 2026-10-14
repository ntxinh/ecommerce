import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { notificationPreferences, notifications, sellerOrders } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { addItem, clearCart } from "@/server/modules/cart/service";
import { register } from "@/server/modules/identity/service";
import {
  listNotifications,
  markAllRead,
  markRead,
  notify,
} from "@/server/modules/notifications/service";
import { placeOrder } from "@/server/modules/orders/checkout";
import {
  confirmSellerOrder,
  deliverSellerOrder,
  packSellerOrder,
  shipSellerOrder,
} from "@/server/modules/orders/fulfillment";

const PATH = "./tests/.tmp/notifications-test.db";
const CUSTOMER: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };
const SELLER2: Actor = { userId: "usr_seller2", roles: ["CUSTOMER"], memberships: [] };
const SHOP1_OWNER: Actor = {
  userId: "usr_seller",
  roles: ["SELLER"],
  memberships: [{ shopId: "shop_1", role: "OWNER", permissions: [] }],
};
const ADDRESS = "addr_1"; // seeded for usr_customer

let db: DB;
let keySeq = 0;
const nextKey = () => `ntf_${++keySeq}`;

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

async function codOrder(variantId: string, qty: number) {
  return placeOrder(db, CUSTOMER, {
    cartItemIds: [cartItemId(variantId, qty)],
    addressId: ADDRESS,
    shippingByShop: {},
    voucherCodes: [],
    paymentMethod: "COD",
    idempotencyKey: nextKey(),
  });
}

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
});

describe("notify + list", () => {
  it("stores a notification and reports it unread; keyset cursor paginates", () => {
    notify(db, SELLER2.userId, "voucher", { title: "return.approved" });
    notify(db, SELLER2.userId, "order", { title: "order.created", body: { orderId: "ord_x" } });

    const page1 = listNotifications(db, SELLER2, { limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.unread).toBe(2);
    expect(page1.nextCursor).toBe(page1.items[0].id);
    expect(page1.items[0].title).toBe("order.created");
    expect(JSON.parse(page1.items[0].body)).toEqual({ orderId: "ord_x" });

    const page2 = listNotifications(db, SELLER2, { limit: 1, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    expect(page2.items[0].id).not.toBe(page1.items[0].id);
  });

  it("disabled preference suppresses the row; absent row means enabled", () => {
    db.insert(notificationPreferences)
      .values({ userId: "usr_admin", type: "voucher", enabled: false })
      .onConflictDoNothing()
      .run();
    notify(db, "usr_admin", "voucher", { title: "return.approved" });
    expect(
      listNotifications(db, { userId: "usr_admin", roles: ["ADMIN"], memberships: [] }).items,
    ).toHaveLength(0);
    notify(db, "usr_admin", "order", { title: "order.created" });
    expect(
      listNotifications(db, { userId: "usr_admin", roles: ["ADMIN"], memberships: [] }).unread,
    ).toBe(1);
  });
});

describe("read markers", () => {
  it("markRead requires ownership; markAllRead returns the marked count", async () => {
    notify(db, SELLER2.userId, "order", { title: "order.created" });
    const [mine] = listNotifications(db, SELLER2).items.filter((i) => !i.readAt);

    // Another user's id → FORBIDDEN; unknown id → NOT_FOUND.
    expect(await errorCode(() => markRead(db, CUSTOMER, mine.id))).toBe("FORBIDDEN");
    expect(await errorCode(() => markRead(db, SELLER2, "ntf_missing"))).toBe("NOT_FOUND");

    markRead(db, SELLER2, mine.id);
    const after = listNotifications(db, SELLER2);
    expect(after.items.find((i) => i.id === mine.id)!.readAt).not.toBeNull();

    const marked = markAllRead(db, SELLER2);
    expect(marked).toBeGreaterThanOrEqual(1);
    expect(listNotifications(db, SELLER2).unread).toBe(0);
  });
});

describe("wiring", () => {
  it("register → account notification; placeOrder → order notification for the buyer", async () => {
    const user = await register(db, {
      email: "buyer@notifications.test",
      name: "Ntf Buyer",
      password: "correct horse battery staple",
    });
    const acc = listNotifications(db, { userId: user.id, roles: ["CUSTOMER"], memberships: [] });
    expect(acc.items.map((i) => i.title)).toEqual(["account.welcome"]);
    expect(acc.items[0].type).toBe("account");

    const res = await codOrder("var_1", 1);
    const list = listNotifications(db, CUSTOMER);
    const created = list.items.find((i) => i.title === "order.created");
    expect(created).toBeDefined();
    expect(created!.type).toBe("order");
    expect(created!.href).toBe(`/account/orders/${res.orderId}`);
    expect(JSON.parse(created!.body)).toEqual({ orderId: res.orderId });
  });

  it("deliverSellerOrder → buyer gets a shipment notification", async () => {
    const res = await codOrder("var_2", 1);
    const so = db.select().from(sellerOrders).where(eq(sellerOrders.orderId, res.orderId)).get()!;
    confirmSellerOrder(db, SHOP1_OWNER, so.id);
    packSellerOrder(db, SHOP1_OWNER, so.id);
    shipSellerOrder(db, SHOP1_OWNER, so.id, { carrier: "ghn", trackingNumber: nextKey() });
    deliverSellerOrder(db, SHOP1_OWNER, so.id);

    const titles = listNotifications(db, CUSTOMER)
      .items.filter((i) => i.type === "shipment")
      .map((i) => i.title);
    expect(titles).toContain("shipment.shipped");
    expect(titles).toContain("shipment.delivered");
  });
});

// Keep the table import used (schema smoke): notifications rows exist after wiring.
describe("rows", () => {
  it("notifications table carries the wired rows", () => {
    const rows = db.select().from(notifications).all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.id.startsWith("ntf_"))).toBe(true);
  });
});
