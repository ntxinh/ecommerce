import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { inventory, shops } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import {
  cardsForIds,
  getHomepageData,
  getProductBySlug,
  getShopBySlug,
  listCategories,
  listProducts,
} from "@/server/modules/catalog/service";

const PATH = "./tests/.tmp/catalog-service-test.db";
let db: DB;

beforeAll(() => {
  rmSync(PATH, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
});

describe("listCategories", () => {
  it("returns a nested tree ordered by sortOrder", () => {
    const tree = listCategories(db);
    expect(tree.map((c) => c.slug)).toEqual(["handicrafts", "fashion"]);
    expect(tree[0].children[0].slug).toBe("ceramics");
    expect(tree[0].children[0].parentId).toBe("cat_1");
    expect(tree[1].children[0].slug).toBe("apparel");
  });
});

describe("listProducts", () => {
  it("lists ACTIVE products only by default, with cards hydrated", () => {
    const { items } = listProducts(db, {});
    const ids = items.map((i) => i.id).sort();
    expect(ids).toEqual(["prod_1", "prod_2", "prod_3", "prod_4", "prod_5", "prod_6"]);
    const mug = items.find((i) => i.id === "prod_1")!;
    expect(mug.priceVnd).toBe(135000); // min effective variant price
    expect(mug.shop).toMatchObject({ slug: "saigon-crafts", name: "Saigon Crafts" });
    expect(mug.imageUrl).toBe("/seed/prod_1-1.svg");
    expect(mug.ratingAvg).toBeCloseTo(4.5);
    expect(mug.ratingCount).toBe(2);
    expect(mug.inStock).toBe(true);
  });

  it("filters by category including descendants", () => {
    const { items } = listProducts(db, { categoryId: "cat_1" });
    expect(items.map((i) => i.id).sort()).toEqual(["prod_1", "prod_2", "prod_4"]);
    const { items: ceramics } = listProducts(db, { categoryId: "cat_3" });
    expect(ceramics.map((i) => i.id).sort()).toEqual(["prod_1", "prod_2"]);
  });

  it("filters by shop, text query, and status", () => {
    expect(
      listProducts(db, { shopId: "shop_2" })
        .items.map((i) => i.id)
        .sort(),
    ).toEqual(["prod_4", "prod_5", "prod_6"]);
    expect(listProducts(db, { q: "tea" }).items.map((i) => i.id)).toEqual(["prod_2"]);
    // seller/admin surfaces can request non-ACTIVE rows
    expect(listProducts(db, { status: "DRAFT" }).items.map((i) => i.id)).toEqual(["prod_draft"]);
    expect(listProducts(db, { status: "DRAFT", shopId: "shop_2" }).items).toHaveLength(0);
  });

  it("filters by card price range (min effective variant price)", () => {
    expect(
      listProducts(db, { minPriceVnd: 100000 })
        .items.map((i) => i.id)
        .sort(),
    ).toEqual(["prod_1", "prod_2", "prod_3", "prod_5"]);
    expect(
      listProducts(db, { maxPriceVnd: 100000 })
        .items.map((i) => i.id)
        .sort(),
    ).toEqual(["prod_4", "prod_6"]);
    expect(
      listProducts(db, { minPriceVnd: 100000, maxPriceVnd: 300000 })
        .items.map((i) => i.id)
        .sort(),
    ).toEqual(["prod_1", "prod_3", "prod_5"]);
  });

  it("filters by minRating on PUBLISHED reviews only", () => {
    expect(
      listProducts(db, { minRating: 4 })
        .items.map((i) => i.id)
        .sort(),
    ).toEqual(["prod_1", "prod_4", "prod_5"]);
    // prod_6's only review is HIDDEN → never matches a positive minRating
    expect(listProducts(db, { minRating: 1 }).items.map((i) => i.id)).not.toContain("prod_6");
  });

  it("filters inStock", () => {
    db.update(inventory)
      .set({ onHand: 0, reserved: 0 })
      .where(eq(inventory.variantId, "var_8"))
      .run();
    expect(listProducts(db, { inStock: true }).items.map((i) => i.id)).not.toContain("prod_6");
    expect(listProducts(db, { inStock: true }).items).toHaveLength(5);
    expect(listProducts(db, { inStock: false }).items.map((i) => i.id)).toEqual(["prod_6"]);
    db.update(inventory).set({ onHand: 55 }).where(eq(inventory.variantId, "var_8")).run();
  });

  it("sorts by price, newest, and rating", () => {
    const asc = listProducts(db, { sort: "price_asc" }).items.map((i) => i.id);
    expect(asc).toEqual(["prod_6", "prod_4", "prod_5", "prod_1", "prod_3", "prod_2"]);
    const desc = listProducts(db, { sort: "price_desc" }).items.map((i) => i.id);
    expect(desc).toEqual(["prod_2", "prod_3", "prod_1", "prod_5", "prod_4", "prod_6"]);
    const newest = listProducts(db, { sort: "newest" }).items.map((i) => i.id);
    expect(newest).toEqual(["prod_6", "prod_5", "prod_4", "prod_3", "prod_2", "prod_1"]);
    const rating = listProducts(db, { sort: "rating" }).items.map((i) => i.id);
    expect(rating.slice(0, 3)).toEqual(["prod_5", "prod_1", "prod_4"]); // 5.0, 4.5, 4.0
  });

  it("paginates stably across pages with no overlap or gaps", () => {
    const p1 = listProducts(db, { sort: "newest", limit: 4 });
    expect(p1.items.map((i) => i.id)).toEqual(["prod_6", "prod_5", "prod_4", "prod_3"]);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = listProducts(db, { sort: "newest", limit: 4, cursor: p1.nextCursor! });
    expect(p2.items.map((i) => i.id)).toEqual(["prod_2", "prod_1"]);
    expect(p2.nextCursor).toBeNull();

    const q1 = listProducts(db, { sort: "price_asc", limit: 3 });
    const q2 = listProducts(db, { sort: "price_asc", limit: 3, cursor: q1.nextCursor! });
    expect([...q1.items, ...q2.items].map((i) => i.id)).toEqual([
      "prod_6",
      "prod_4",
      "prod_5",
      "prod_1",
      "prod_3",
      "prod_2",
    ]);
    expect(q2.nextCursor).toBeNull();
  });

  it("rejects a cursor minted for a different sort", () => {
    const p1 = listProducts(db, { sort: "newest", limit: 2 });
    expect(() =>
      listProducts(db, { sort: "price_asc", limit: 2, cursor: p1.nextCursor! }),
    ).toThrow();
  });

  it("rejects malformed cursors instead of silently resetting to page 1", () => {
    const encode = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
    // missing sort key v for a price sort
    expect(() =>
      listProducts(db, { sort: "price_asc", cursor: encode({ s: "price_asc", i: "x" }) }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    // wrong-typed key for newest
    expect(() =>
      listProducts(db, { sort: "newest", cursor: encode({ s: "newest", c: "x", i: "p" }) }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    // garbage payload
    expect(() => listProducts(db, { cursor: "!!!" })).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    // missing rating key v
    expect(() =>
      listProducts(db, { sort: "rating", cursor: encode({ s: "rating", c: 1, i: "p" }) }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});

describe("getProductBySlug", () => {
  it("returns product detail with variants, images, rating, attributes, shop", () => {
    const d = getProductBySlug(db, "handmade-ceramic-mug");
    expect(d.slug).toBe("handmade-ceramic-mug");
    expect(d.nameVi).toBe("Cốc gốm thủ công");
    expect(d.shop.slug).toBe("saigon-crafts");
    expect(d.variants.map((v) => v.sku).sort()).toEqual(["MUG-BLU", "MUG-GRN"]);
    expect(d.variants[0].attrs).toEqual({ color: "blue" });
    expect(d.variants.every((v) => v.available > 0)).toBe(true);
    expect(d.images.map((i) => i.url)).toEqual(["/seed/prod_1-1.svg", "/seed/prod_1-2.svg"]);
    expect(d.rating).toEqual({ avg: 4.5, count: 2 });
    expect(d.attributes).toEqual([
      { name: "Material", value: "Glazed stoneware" },
      { name: "Origin", value: "Bat Trang" },
    ]);
    expect(d.flashSale).toMatchObject({ priceVnd: 99000 });
  });

  it("throws NOT_FOUND for missing and non-ACTIVE products", () => {
    expect(() => getProductBySlug(db, "nope")).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    expect(() => getProductBySlug(db, "unlisted-vase")).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });
});

describe("getShopBySlug / shop listing", () => {
  it("returns shop card with product count", () => {
    const shop = getShopBySlug(db, "danang-goods");
    expect(shop.name).toBe("Danang Goods");
    expect(shop.productCount).toBe(3);
    expect(() => getShopBySlug(db, "nope")).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });
});

describe("getHomepageData", () => {
  it("populates every section", () => {
    const h = getHomepageData(db);
    expect(h.categories.map((c) => c.slug)).toEqual(["handicrafts", "fashion"]);
    expect(h.flashSale.map((i) => i.productId)).toEqual(["prod_1"]);
    expect(h.flashSale[0].flashPriceVnd).toBe(99000);
    expect(h.flashSale[0].flashEndsAt).toBeGreaterThan(Date.now());
    expect(h.flashSale[0].card.imageUrl).toBe("/seed/prod_1-1.svg");
    expect(h.featuredShops.map((s) => s.slug)).toEqual(["danang-goods", "saigon-crafts"]);
    expect(h.featuredShops[0].productCount).toBe(3);
    expect(h.trending[0].id).toBe("prod_1"); // 2 seeded order items
    expect(h.trending.map((i) => i.id)).toEqual(["prod_1", "prod_3", "prod_4", "prod_6"]);
    expect(h.newest.items[0].id).toBe("prod_6");
    expect(h.newest.items).toHaveLength(6);
  });
});

describe("suspended shops", () => {
  it("excludes suspended-shop products from listings, ids, detail, and homepage", () => {
    db.update(shops).set({ status: "SUSPENDED" }).where(eq(shops.id, "shop_2")).run();
    try {
      const ids = listProducts(db, {}).items.map((i) => i.id);
      expect(ids).not.toContain("prod_4");
      expect(ids).not.toContain("prod_5");
      expect(ids).not.toContain("prod_6");
      expect(listProducts(db, { shopId: "shop_2" }).items).toHaveLength(0);
      expect(cardsForIds(db, ["prod_4", "prod_1"]).map((c) => c.id)).toEqual(["prod_1"]);
      expect(() => getProductBySlug(db, "straw-hat")).toThrowError(
        expect.objectContaining({ code: "NOT_FOUND" }),
      );
      const h = getHomepageData(db);
      expect(h.featuredShops.map((s) => s.slug)).toEqual(["saigon-crafts"]);
      expect(h.trending.map((i) => i.id)).not.toContain("prod_4");
      expect(h.newest.items.map((i) => i.id)).not.toContain("prod_6");
    } finally {
      db.update(shops).set({ status: "ACTIVE" }).where(eq(shops.id, "shop_2")).run();
    }
  });
});
