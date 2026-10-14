import { mkdirSync, rmSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as autoCompleteRoute } from "@/app/api/v1/internal/auto-complete/route";
import { GET as readyRoute } from "@/app/api/v1/ready/route";
import { env } from "@/env";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { sellerOrders, shipments, trackingEvents } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { addItem } from "@/server/modules/cart/service";
import { placeOrder } from "@/server/modules/orders/checkout";
import {
  autoCompleteSellerOrders,
  confirmSellerOrder,
  deliveredAt,
  deliverSellerOrder,
  packSellerOrder,
  shipSellerOrder,
} from "@/server/modules/orders/fulfillment";

const PATH = "./tests/.tmp/auto-complete-test.db";
const CUSTOMER: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };
const SHOP1_OWNER: Actor = {
  userId: "usr_seller",
  roles: ["SELLER"],
  memberships: [{ shopId: "shop_1", role: "OWNER", permissions: [] }],
};
const ADDRESS = "addr_1"; // seeded for usr_customer
const DAY = 86_400_000;

let db: DB;
let keySeq = 0;
const nextKey = () => `ac_${++keySeq}`;

/** Places a COD order and walks its shop_1 leg to DELIVERED. */
async function deliveredLeg(target: DB = db): Promise<string> {
  const view = addItem(target, CUSTOMER.userId, "var_1", 1);
  const cartItemId = view.items.find((i) => i.variantId === "var_1")!.cartItemId;
  const res = await placeOrder(target, CUSTOMER, {
    cartItemIds: [cartItemId],
    addressId: ADDRESS,
    shippingByShop: {},
    voucherCodes: [],
    paymentMethod: "COD",
    idempotencyKey: nextKey(),
  });
  const so = target
    .select()
    .from(sellerOrders)
    .where(eq(sellerOrders.orderId, res.orderId))
    .all()
    .find((s) => s.shopId === "shop_1")!;
  confirmSellerOrder(target, SHOP1_OWNER, so.id);
  packSellerOrder(target, SHOP1_OWNER, so.id);
  shipSellerOrder(target, SHOP1_OWNER, so.id, {
    carrier: "ghn",
    trackingNumber: `TRK-${nextKey()}`,
  });
  deliverSellerOrder(target, SHOP1_OWNER, so.id);
  return so.id;
}

function backdate(target: DB, sellerOrderId: string, msAgo: number) {
  const shipment = target
    .select()
    .from(shipments)
    .where(eq(shipments.sellerOrderId, sellerOrderId))
    .get()!;
  target
    .update(trackingEvents)
    .set({ createdAt: Date.now() - msAgo })
    .where(and(eq(trackingEvents.shipmentId, shipment.id), eq(trackingEvents.status, "DELIVERED")))
    .run();
}

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${PATH}${suffix}`, { force: true });
    rmSync(`./tests/.tmp/test.db${suffix}`, { force: true });
  }
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
  // Route handlers go through getDb() → the env default (tests/.tmp/test.db).
  const routeDb = getDb();
  migrateDb(routeDb);
  seedIdentity(routeDb);
  seedCatalog(routeDb);
});

describe("deliveredAt", () => {
  it("null before DELIVERED; the latest DELIVERED event's timestamp after", async () => {
    const view = addItem(db, CUSTOMER.userId, "var_1", 1);
    const res = await placeOrder(db, CUSTOMER, {
      cartItemIds: [view.items.find((i) => i.variantId === "var_1")!.cartItemId],
      addressId: ADDRESS,
      shippingByShop: {},
      voucherCodes: [],
      paymentMethod: "COD",
      idempotencyKey: nextKey(),
    });
    const so = db
      .select()
      .from(sellerOrders)
      .where(eq(sellerOrders.orderId, res.orderId))
      .all()
      .find((s) => s.shopId === "shop_1")!;
    expect(deliveredAt(db, so.id)).toBeNull();

    const delivered = await deliveredLeg();
    const at = deliveredAt(db, delivered);
    expect(at).toBeTypeOf("number");
  });
});

describe("autoCompleteSellerOrders", () => {
  it("completes DELIVERED legs past auto_complete_days; leaves fresh ones", async () => {
    const stale = await deliveredLeg();
    const fresh = await deliveredLeg();
    backdate(db, stale, 4 * DAY); // seeded auto_complete_days = 3

    expect(autoCompleteSellerOrders(db)).toBe(1);
    expect(db.select().from(sellerOrders).where(eq(sellerOrders.id, stale)).get()!.status).toBe(
      "COMPLETED",
    );
    expect(db.select().from(sellerOrders).where(eq(sellerOrders.id, fresh)).get()!.status).toBe(
      "DELIVERED",
    );
    // Second sweep is a no-op.
    expect(autoCompleteSellerOrders(db)).toBe(0);
  });
});

describe("POST /api/v1/internal/auto-complete", () => {
  it("401 without the bearer token", async () => {
    const res = await autoCompleteRoute(
      new Request("http://localhost/api/v1/internal/auto-complete", { method: "POST" }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("runs the sweep against the default DB with the token", async () => {
    const routeDb = getDb();
    const stale = await deliveredLeg(routeDb);
    backdate(routeDb, stale, 4 * DAY);

    const res = await autoCompleteRoute(
      new Request("http://localhost/api/v1/internal/auto-complete", {
        method: "POST",
        headers: { authorization: `Bearer ${env.INTERNAL_CRON_TOKEN}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.completed).toBe(1);
    expect(
      routeDb.select().from(sellerOrders).where(eq(sellerOrders.id, stale)).get()!.status,
    ).toBe("COMPLETED");
  });
});

describe("GET /api/v1/ready", () => {
  it("returns {status:'ready'} when the DB answers", async () => {
    const res = await readyRoute();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: "ready" } });
  });
});
