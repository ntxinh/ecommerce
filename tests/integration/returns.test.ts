import { mkdirSync, rmSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { RequestReturnInput } from "@/server/api/contracts/returns";
import type { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import {
  orderItems,
  returnItems,
  returnRequests,
  sellerOrders,
  shipments,
  trackingEvents,
} from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { addItem } from "@/server/modules/cart/service";
import { placeOrder } from "@/server/modules/orders/checkout";
import {
  completeSellerOrder,
  confirmSellerOrder,
  deliverSellerOrder,
  packSellerOrder,
  shipSellerOrder,
} from "@/server/modules/orders/fulfillment";
import {
  decideReturn,
  disputeReturn,
  getReturnRequest,
  listReturnRequests,
  requestReturn,
} from "@/server/modules/orders/returns";

const PATH = "./tests/.tmp/returns-test.db";
const CUSTOMER: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };
const CUSTOMER2: Actor = { userId: "usr_seller2", roles: ["CUSTOMER"], memberships: [] };
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

let db: DB;
let keySeq = 0;
const nextKey = () => `ret_${++keySeq}`;

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

const soStatus = (id: string) =>
  db.select().from(sellerOrders).where(eq(sellerOrders.id, id)).get()!.status;

const soItems = (sellerOrderId: string) =>
  db.select().from(orderItems).where(eq(orderItems.sellerOrderId, sellerOrderId)).all();

const rr = (id: string) => db.select().from(returnRequests).where(eq(returnRequests.id, id)).get()!;

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

/** Drives a COD order's shop_1 leg to DELIVERED; returns the leg id. */
async function deliveredLeg(variantId: string, qty: number) {
  const res = await codOrder(variantId, qty);
  const so = leg(res.orderId, "shop_1");
  confirmSellerOrder(db, SHOP1_OWNER, so.id);
  packSellerOrder(db, SHOP1_OWNER, so.id);
  shipSellerOrder(db, SHOP1_OWNER, so.id, { carrier: "ghn", trackingNumber: nextKey() });
  deliverSellerOrder(db, SHOP1_OWNER, so.id);
  return so.id;
}

function backdateDelivery(sellerOrderId: string, msAgo: number) {
  const shipment = db
    .select()
    .from(shipments)
    .where(eq(shipments.sellerOrderId, sellerOrderId))
    .get()!;
  db.update(trackingEvents)
    .set({ createdAt: Date.now() - msAgo })
    .where(and(eq(trackingEvents.shipmentId, shipment.id), eq(trackingEvents.status, "DELIVERED")))
    .run();
}

function input(sellerOrderId: string, items: { orderItemId: string; qty: number }[]) {
  return RequestReturnInput.parse({
    sellerOrderId,
    items,
    reason: "arrived broken",
    evidence: ["https://cdn.example.com/ev1.jpg"],
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

describe("requestReturn", () => {
  it("files a PENDING request on a DELIVERED leg; leg → RETURN_REQUESTED", async () => {
    const soId = await deliveredLeg("var_1", 2);
    const item = soItems(soId)[0];

    const id = requestReturn(db, CUSTOMER, input(soId, [{ orderItemId: item.id, qty: 1 }]));
    const req = rr(id);
    expect(req.status).toBe("PENDING");
    expect(req.userId).toBe(CUSTOMER.userId);
    expect(req.reason).toBe("arrived broken");
    expect(JSON.parse(req.evidenceJson)).toEqual(["https://cdn.example.com/ev1.jpg"]);
    expect(soStatus(soId)).toBe("RETURN_REQUESTED");

    const lines = db.select().from(returnItems).where(eq(returnItems.returnRequestId, id)).all();
    expect(lines).toHaveLength(1);
    // floor(lineTotal * qty / item.qty)
    expect(lines[0].refundVnd).toBe(Math.floor(item.lineTotalVnd / item.qty));

    const detail = getReturnRequest(db, CUSTOMER, id);
    expect(detail.request.id).toBe(id);
    expect(detail.items[0].orderItemId).toBe(item.id);
    expect(listReturnRequests(db, CUSTOMER, {}).items.map((r) => r.id)).toContain(id);
    expect(
      listReturnRequests(db, SHOP1_OWNER, { shopId: "shop_1" }).items.map((r) => r.id),
    ).toContain(id);
  });

  it("rejects RETURN_WINDOW_EXPIRED once deliveredAt is older than the window", async () => {
    const soId = await deliveredLeg("var_2", 1);
    backdateDelivery(soId, 8 * 86_400_000); // default window: 7 days
    const item = soItems(soId)[0];
    expect(
      await errorCode(() =>
        requestReturn(db, CUSTOMER, input(soId, [{ orderItemId: item.id, qty: 1 }])),
      ),
    ).toBe("RETURN_WINDOW_EXPIRED");
    expect(soStatus(soId)).toBe("DELIVERED");
  });

  it("rejects non-owner customers and admin (admin does not file)", async () => {
    const soId = await deliveredLeg("var_3", 1);
    const item = soItems(soId)[0];
    for (const actor of [CUSTOMER2, ADMIN]) {
      expect(
        await errorCode(() =>
          requestReturn(db, actor, input(soId, [{ orderItemId: item.id, qty: 1 }])),
        ),
      ).toBe("FORBIDDEN");
    }
  });

  it("rejects qty over purchased and overlapping second requests", async () => {
    const soId = await deliveredLeg("var_4", 2);
    completeSellerOrder(db, SHOP1_OWNER, soId); // COMPLETED leg: no flip, overlaps live
    const item = soItems(soId)[0];

    expect(
      await errorCode(() =>
        requestReturn(db, CUSTOMER, input(soId, [{ orderItemId: item.id, qty: 3 }])),
      ),
    ).toBe("INVALID_INPUT");

    requestReturn(db, CUSTOMER, input(soId, [{ orderItemId: item.id, qty: 2 }]));
    // PENDING lines count against the remaining returnable qty.
    expect(
      await errorCode(() =>
        requestReturn(db, CUSTOMER, input(soId, [{ orderItemId: item.id, qty: 1 }])),
      ),
    ).toBe("INVALID_INPUT");
  });

  it("rejects non-DELIVERED/COMPLETED legs with INVALID_STATE", async () => {
    const res = await codOrder("var_5", 1); // leg still NEW
    const so = leg(res.orderId, "shop_1");
    const item = soItems(so.id)[0];
    expect(
      await errorCode(() =>
        requestReturn(db, CUSTOMER, input(so.id, [{ orderItemId: item.id, qty: 1 }])),
      ),
    ).toBe("INVALID_STATE");

    // A RETURN_REQUESTED leg is likewise outside the {DELIVERED, COMPLETED} gate.
    const soId = await deliveredLeg("var_5", 1);
    const live = soItems(soId)[0];
    requestReturn(db, CUSTOMER, input(soId, [{ orderItemId: live.id, qty: 1 }]));
    expect(soStatus(soId)).toBe("RETURN_REQUESTED");
    expect(
      await errorCode(() =>
        requestReturn(db, CUSTOMER, input(soId, [{ orderItemId: live.id, qty: 1 }])),
      ),
    ).toBe("INVALID_STATE");
  });
});

describe("decideReturn / disputeReturn", () => {
  it("REJECTED releases the leg to COMPLETED and frees the returnable qty", async () => {
    const soId = await deliveredLeg("var_1", 1);
    const item = soItems(soId)[0];
    const id = requestReturn(db, CUSTOMER, input(soId, [{ orderItemId: item.id, qty: 1 }]));
    expect(soStatus(soId)).toBe("RETURN_REQUESTED");

    decideReturn(db, SHOP1_OWNER, id, "REJECTED", "looks fine in the photo");
    expect(rr(id).status).toBe("REJECTED");
    expect(rr(id).decidedBy).toBe(SHOP1_OWNER.userId);
    expect(rr(id).decisionNote).toBe("looks fine in the photo");
    expect(soStatus(soId)).toBe("COMPLETED");

    // REJECTED lines don't count — the buyer can file again on the now-COMPLETED leg.
    const retry = requestReturn(db, CUSTOMER, input(soId, [{ orderItemId: item.id, qty: 1 }]));
    expect(rr(retry).status).toBe("PENDING");
    expect(soStatus(soId)).toBe("COMPLETED"); // no flip on COMPLETED legs
  });

  it("REJECTED → DISPUTED by the buyer → admin APPROVED", async () => {
    const soId = await deliveredLeg("var_2", 1);
    const item = soItems(soId)[0];
    const id = requestReturn(db, CUSTOMER, input(soId, [{ orderItemId: item.id, qty: 1 }]));

    decideReturn(db, SHOP1_OWNER, id, "REJECTED");
    expect(await errorCode(() => disputeReturn(db, CUSTOMER2, id))).toBe("FORBIDDEN");
    disputeReturn(db, CUSTOMER, id);
    expect(rr(id).status).toBe("DISPUTED");

    // Seller can't decide a DISPUTED request; admin can.
    expect(await errorCode(() => decideReturn(db, SHOP1_OWNER, id, "APPROVED"))).toBe(
      "INVALID_STATE",
    );
    decideReturn(db, ADMIN, id, "APPROVED", "evidence accepted");
    expect(rr(id).status).toBe("APPROVED");
    expect(rr(id).decidedBy).toBe(ADMIN.userId);
  });

  it("non-member decide is FORBIDDEN; non-PENDING decide is INVALID_STATE", async () => {
    const soId = await deliveredLeg("var_3", 1);
    const item = soItems(soId)[0];
    const id = requestReturn(db, CUSTOMER, input(soId, [{ orderItemId: item.id, qty: 1 }]));

    for (const actor of [CUSTOMER, CUSTOMER2, SHOP2_OWNER]) {
      expect(await errorCode(() => decideReturn(db, actor, id, "APPROVED"))).toBe("FORBIDDEN");
    }

    decideReturn(db, SHOP1_OWNER, id, "APPROVED");
    expect(rr(id).status).toBe("APPROVED");
    expect(await errorCode(() => decideReturn(db, SHOP1_OWNER, id, "REJECTED"))).toBe(
      "INVALID_STATE",
    );
    expect(await errorCode(() => disputeReturn(db, CUSTOMER, id))).toBe("INVALID_STATE");
  });

  it("request on a COMPLETED leg is allowed and does not flip status", async () => {
    const soId = await deliveredLeg("var_4", 1);
    completeSellerOrder(db, SHOP1_OWNER, soId);
    expect(soStatus(soId)).toBe("COMPLETED");

    const item = soItems(soId)[0];
    const id = requestReturn(db, CUSTOMER, input(soId, [{ orderItemId: item.id, qty: 1 }]));
    expect(rr(id).status).toBe("PENDING");
    expect(soStatus(soId)).toBe("COMPLETED");
  });

  it("non-member reads are FORBIDDEN; shopId list needs order:read", async () => {
    const soId = await deliveredLeg("var_5", 1);
    const item = soItems(soId)[0];
    const id = requestReturn(db, CUSTOMER, input(soId, [{ orderItemId: item.id, qty: 1 }]));

    expect(await errorCode(() => getReturnRequest(db, CUSTOMER2, id))).toBe("FORBIDDEN");
    expect(getReturnRequest(db, SHOP1_OWNER, id).request.id).toBe(id);
    expect(listReturnRequests(db, CUSTOMER2, {}).items.map((r) => r.id)).not.toContain(id);
    expect(await errorCode(() => listReturnRequests(db, SHOP2_OWNER, { shopId: "shop_1" }))).toBe(
      "FORBIDDEN",
    );
    expect(await errorCode(() => listReturnRequests(db, CUSTOMER, { shopId: "shop_1" }))).toBe(
      "FORBIDDEN",
    );
  });
});
