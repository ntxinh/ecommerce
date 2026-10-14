import { mkdirSync, rmSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { auditLogs, orderItems, orders, products, reviews, sellerOrders } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { seedReviews } from "@/server/db/seed/media";
import { listProductReviews } from "@/server/modules/catalog/service";
import {
  createReview,
  deleteReview,
  listReviewableItems,
  moderateReview,
  updateReview,
} from "@/server/modules/reviews/service";

const PATH = "./tests/.tmp/reviews-test.db";
let db: DB;

const admin: Actor = { userId: "usr_admin", roles: ["ADMIN"], memberships: [] };
const customer: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };
// shop_1 member — also a customer in the eyes of orders on other shops.
const seller1: Actor = {
  userId: "usr_seller",
  roles: ["CUSTOMER", "SELLER"],
  memberships: [{ shopId: "shop_1", role: "OWNER", permissions: [] }],
};
// shop_2 member — owns the products seeded into the dedicated order below.
const seller2: Actor = {
  userId: "usr_seller2",
  roles: ["CUSTOMER", "SELLER"],
  memberships: [{ shopId: "shop_2", role: "OWNER", permissions: [] }],
};
// ADMIN with a shop_2 membership — exercises the admin exemption to the
// can't-review-own-shop rule on a product their membership would block.
const adminSeller: Actor = {
  userId: "usr_admin",
  roles: ["ADMIN"],
  memberships: [{ shopId: "shop_2", role: "OWNER", permissions: [] }],
};

function expectErr(fn: () => unknown, code: string) {
  try {
    fn();
    expect.unreachable("expected AuthError");
  } catch (e) {
    expect(e).toBeInstanceOf(AuthError);
    expect((e as AuthError).code).toBe(code);
  }
}

/** Minimal COMPLETED order scaffold for a dedicated (orderId, itemId, productId). */
function insertOrder(orderId: string, userId: string, itemId: string, productId: string) {
  const now = Date.now();
  db.insert(orders)
    .values({
      id: orderId,
      userId,
      addressSnapshotJson: '{"line1":"1 Test","city":"HCMC"}',
      status: "COMPLETED",
      totalVnd: 100000,
      subtotalVnd: 100000,
      idempotencyKey: `test-${orderId}`,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(sellerOrders)
    .values({
      id: `so_${orderId}`,
      orderId,
      shopId: "shop_2",
      status: "COMPLETED",
      subtotalVnd: 100000,
      shippingVnd: 0,
      commissionRateBps: 500,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(orderItems)
    .values({
      id: itemId,
      sellerOrderId: `so_${orderId}`,
      orderId,
      variantId: "var_6",
      productId,
      nameSnapshot: "Test item",
      skuSnapshot: "TEST-1",
      unitPriceVnd: 100000,
      qty: 1,
      lineTotalVnd: 100000,
    })
    .run();
}

// Mirrors the ratingAvg read gate: avg over PUBLISHED reviews for prod_4.
const prod4Avg = () =>
  db
    .select({ avg: sql<number | null>`avg(${reviews.rating})` })
    .from(reviews)
    .where(and(eq(reviews.productId, "prod_4"), eq(reviews.status, "PUBLISHED")))
    .get()?.avg;

beforeAll(() => {
  for (const f of [PATH, `${PATH}-wal`, `${PATH}-shm`]) rmSync(f, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
  seedReviews(db); // COMPLETED orders ord_1..3 for usr_customer; oi_4 unreviewed
});

describe("createReview", () => {
  it("creates a review on a delivered-purchase order item", () => {
    // oi_4: prod_6 in completed ord_2 for usr_customer, no seeded review.
    const id = createReview(db, customer, {
      orderItemId: "oi_4",
      rating: 4,
      title: "Nice hat",
      body: "Wears well.",
      images: ["https://img.example/hat.jpg"],
    });
    expect(id).toMatch(/^rev_/);
    const row = db.select().from(reviews).where(eq(reviews.id, id)).get();
    expect(row).toMatchObject({
      orderItemId: "oi_4",
      productId: "prod_6",
      userId: "usr_customer",
      rating: 4,
      title: "Nice hat",
      status: "PUBLISHED",
      imagesJson: '["https://img.example/hat.jpg"]',
    });
    expect(listProductReviews(db, "prod_6").items.map((r) => r.id)).toContain(id);
  });

  it("rejects a second review on the same order item", () => {
    // oi_1 already has seeded rev_1.
    expectErr(
      () => createReview(db, customer, { orderItemId: "oi_1", rating: 5 }),
      "INVALID_INPUT",
    );
    // And the item reviewed in the previous test is now taken too.
    expectErr(
      () => createReview(db, customer, { orderItemId: "oi_4", rating: 1 }),
      "INVALID_INPUT",
    );
  });

  it("rejects bad ratings and missing items", () => {
    expectErr(
      () => createReview(db, customer, { orderItemId: "oi_1", rating: 0 }),
      "INVALID_INPUT",
    );
    expectErr(
      () => createReview(db, customer, { orderItemId: "oi_1", rating: 6 }),
      "INVALID_INPUT",
    );
    expectErr(() => createReview(db, customer, { orderItemId: "oi_nope", rating: 3 }), "NOT_FOUND");
    expectErr(() => createReview(db, null, { orderItemId: "oi_4", rating: 3 }), "UNAUTHORIZED");
  });

  it("forbids a non-buyer", () => {
    // seller1 is not a member of shop_2 → the failure is purely order ownership.
    expectErr(() => createReview(db, seller1, { orderItemId: "oi_4", rating: 5 }), "FORBIDDEN");
  });

  it("forbids a shop member reviewing their own product, but exempts ADMIN", () => {
    // seller2's own completed purchase of prod_4 (their shop's product).
    insertOrder("ord_s2", "usr_seller2", "oi_s2", "prod_4");
    expectErr(() => createReview(db, seller2, { orderItemId: "oi_s2", rating: 5 }), "FORBIDDEN");

    // An admin holding a shop_2 membership is exempt from the own-shop rule.
    insertOrder("ord_a", "usr_admin", "oi_a", "prod_4");
    const id = createReview(db, adminSeller, { orderItemId: "oi_a", rating: 5 });
    expect(id).toMatch(/^rev_/);
  });
});

describe("updateReview / deleteReview", () => {
  it("lets the author edit title/body/rating", () => {
    updateReview(db, customer, "rev_3", { rating: 2, title: "Revised", body: "Changed my mind." });
    const row = db.select().from(reviews).where(eq(reviews.id, "rev_3")).get();
    expect(row).toMatchObject({ rating: 2, title: "Revised", body: "Changed my mind." });
    // undefined fields leave the row alone; "" clears.
    updateReview(db, customer, "rev_3", { body: "" });
    expect(db.select().from(reviews).where(eq(reviews.id, "rev_3")).get()?.body).toBeNull();
    expect(db.select().from(reviews).where(eq(reviews.id, "rev_3")).get()?.title).toBe("Revised");
  });

  it("forbids non-authors and unknown reviews", () => {
    expectErr(() => updateReview(db, seller1, "rev_3", { rating: 1 }), "FORBIDDEN");
    expectErr(() => updateReview(db, admin, "rev_3", { rating: 1 }), "FORBIDDEN");
    expectErr(() => updateReview(db, customer, "rev_nope", { rating: 1 }), "NOT_FOUND");
    expectErr(() => updateReview(db, customer, "rev_3", { rating: 9 }), "INVALID_INPUT");
  });

  it("lets the author delete their review and admin delete anyone's", () => {
    deleteReview(db, customer, "rev_4");
    expect(db.select().from(reviews).where(eq(reviews.id, "rev_4")).get()).toBeUndefined();
    expectErr(() => deleteReview(db, seller1, "rev_2"), "FORBIDDEN");
    deleteReview(db, admin, "rev_2");
    expect(db.select().from(reviews).where(eq(reviews.id, "rev_2")).get()).toBeUndefined();
  });
});

describe("moderateReview", () => {
  it("admin HIDE removes a review from public list + aggregate; UNHIDE restores", () => {
    // prod_4 has rev_3 (rating 2) plus the adminSeller review (rating 5).
    const before = listProductReviews(db, "prod_4").items.map((r) => r.id);
    expect(before).toContain("rev_3");
    expect(before).toHaveLength(2);
    expect(prod4Avg()).toBeCloseTo(3.5);

    moderateReview(db, admin, "rev_3", "HIDE", "spam");
    const after = listProductReviews(db, "prod_4").items.map((r) => r.id);
    expect(after).toHaveLength(1);
    expect(after).not.toContain("rev_3");
    expect(prod4Avg()).toBe(5);

    const audits = db
      .select()
      .from(auditLogs)
      .all()
      .filter((a) => a.action === "review.moderate" && a.targetId === "rev_3");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: "usr_admin", action: "review.moderate" });

    moderateReview(db, admin, "rev_3", "UNHIDE");
    expect(listProductReviews(db, "prod_4").items.map((r) => r.id)).toContain("rev_3");
    expect(prod4Avg()).toBeCloseTo(3.5);
  });

  it("requires admin", () => {
    expectErr(() => moderateReview(db, customer, "rev_1", "HIDE"), "FORBIDDEN");
    expectErr(() => moderateReview(db, null, "rev_1", "HIDE"), "UNAUTHORIZED");
    expectErr(() => moderateReview(db, admin, "rev_nope", "HIDE"), "NOT_FOUND");
  });
});

describe("listReviewableItems", () => {
  it("lists the actor's delivered, not-yet-reviewed items and skips own-shop products", () => {
    const items = listReviewableItems(db, customer);
    // oi_1, oi_3, oi_4 are reviewed; deleteReview freed oi_2 and oi_5 back.
    const ids = items.map((i) => i.orderItemId).sort();
    expect(ids).toEqual(["oi_2", "oi_5"]);
    expect(items.find((i) => i.orderItemId === "oi_5")).toMatchObject({
      orderId: "ord_3",
      productName: "Linen Shirt",
    });

    // seller2's own-shop purchase is never reviewable.
    expect(listReviewableItems(db, seller2)).toHaveLength(0);
    // Logged-out callers have no purchases to review.
    expect(listReviewableItems(db, null)).toEqual([]);
  });
});
