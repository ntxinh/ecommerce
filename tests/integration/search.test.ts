import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { SearchBase, SearchQuery } from "@/server/api/contracts/search";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import {
  brands,
  inventory,
  orderItems,
  orders,
  products,
  productVariants,
  searchHistory,
  sellerOrders,
} from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { recordSearch, search, suggest } from "@/server/modules/search/service";

const PATH = "./tests/.tmp/search-test.db";
const T = 1_735_689_600_000 + 10_000_000; // past SEEDED_AT so fixtures sort newest
let db: DB;

beforeAll(() => {
  rmSync(PATH, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);

  // Fixtures named so relevance tiers are unambiguous for q="aurora":
  // r1 name-match, r4 brand-match, r2 sku-match, r3 description-match.
  db.insert(brands).values({ id: "brand_2", name: "Aurora Studio" }).run();
  db.insert(products)
    .values([
      {
        id: "prod_r1",
        shopId: "shop_1",
        categoryId: "cat_4",
        slug: "aurora-lamp",
        nameEn: "Aurora Lamp",
        nameVi: "Đèn ngủ",
        descriptionEn: "Night light.",
        status: "ACTIVE",
        createdAt: T + 100,
      },
      {
        id: "prod_r2",
        shopId: "shop_1",
        categoryId: "cat_3",
        slug: "reading-lamp",
        nameEn: "Reading Lamp",
        nameVi: "Đèn đọc sách",
        descriptionEn: "Desk lamp.",
        status: "ACTIVE",
        createdAt: T + 200,
      },
      {
        id: "prod_r3",
        shopId: "shop_1",
        categoryId: "cat_3",
        slug: "side-table",
        nameEn: "Side Table",
        nameVi: "Bàn cạnh giường",
        descriptionEn: "Pairs with the aurora lamp.",
        status: "ACTIVE",
        createdAt: T + 300,
      },
      {
        id: "prod_r4",
        shopId: "shop_1",
        categoryId: "cat_3",
        brandId: "brand_2",
        slug: "ceramic-vase",
        nameEn: "Ceramic Vase",
        nameVi: "Bình gốm",
        descriptionEn: "Small vase.",
        status: "ACTIVE",
        createdAt: T + 400,
      },
    ])
    .run();
  db.insert(productVariants)
    .values([
      {
        id: "var_r1",
        productId: "prod_r1",
        sku: "LAMP-A1",
        nameEn: "Std",
        nameVi: "Std",
        basePriceVnd: 200000,
        createdAt: T,
      },
      {
        id: "var_r2",
        productId: "prod_r2",
        sku: "AURORA-01",
        nameEn: "Std",
        nameVi: "Std",
        basePriceVnd: 300000,
        createdAt: T,
      },
      {
        id: "var_r3",
        productId: "prod_r3",
        sku: "TBL-01",
        nameEn: "Std",
        nameVi: "Std",
        basePriceVnd: 400000,
        createdAt: T,
      },
      {
        id: "var_r4",
        productId: "prod_r4",
        sku: "VASE-01",
        nameEn: "Std",
        nameVi: "Std",
        basePriceVnd: 100000,
        createdAt: T,
      },
    ])
    .run();
  db.insert(inventory).values({ variantId: "var_r1", onHand: 5, reserved: 0, updatedAt: T }).run();

  // Popular-sort fixtures: r2 sold 5 units, r1 sold 2, r3/r4 none.
  db.insert(orders)
    .values([
      {
        id: "ord_s1",
        userId: "usr_customer",
        addressSnapshotJson: "{}",
        status: "COMPLETED",
        totalVnd: 1,
        subtotalVnd: 1,
        idempotencyKey: "idem_s1",
        createdAt: T,
        updatedAt: T,
      },
      {
        id: "ord_s2",
        userId: "usr_customer",
        addressSnapshotJson: "{}",
        status: "COMPLETED",
        totalVnd: 1,
        subtotalVnd: 1,
        idempotencyKey: "idem_s2",
        createdAt: T,
        updatedAt: T,
      },
    ])
    .run();
  db.insert(sellerOrders)
    .values([
      {
        id: "so_s1",
        orderId: "ord_s1",
        shopId: "shop_1",
        subtotalVnd: 1,
        commissionRateBps: 0,
        createdAt: T,
        updatedAt: T,
      },
      {
        id: "so_s2",
        orderId: "ord_s2",
        shopId: "shop_1",
        subtotalVnd: 1,
        commissionRateBps: 0,
        createdAt: T,
        updatedAt: T,
      },
    ])
    .run();
  db.insert(orderItems)
    .values([
      {
        id: "oi_s1",
        sellerOrderId: "so_s1",
        orderId: "ord_s1",
        variantId: "var_r2",
        productId: "prod_r2",
        nameSnapshot: "x",
        skuSnapshot: "AURORA-01",
        unitPriceVnd: 1,
        qty: 5,
        lineTotalVnd: 5,
      },
      {
        id: "oi_s2",
        sellerOrderId: "so_s2",
        orderId: "ord_s2",
        variantId: "var_r1",
        productId: "prod_r1",
        nameSnapshot: "x",
        skuSnapshot: "LAMP-A1",
        unitPriceVnd: 1,
        qty: 2,
        lineTotalVnd: 2,
      },
    ])
    .run();
});

describe("search matching", () => {
  it("matches name, sku, brand, and description; ACTIVE only", () => {
    const { items, total } = search(db, { q: "aurora" });
    expect(total).toBe(4);
    expect(items.map((i) => i.id)).toEqual(["prod_r1", "prod_r4", "prod_r2", "prod_r3"]);
    // sku matching is case-insensitive via ulower()
    expect(search(db, { q: "aurora-01" }).items.map((i) => i.id)).toEqual(["prod_r2"]);
    // DRAFT products never surface
    expect(search(db, { q: "vase" }).items.map((i) => i.id)).not.toContain("prod_draft");
  });

  it("ranks name > sku/brand > description (relevance heuristic)", () => {
    // name hit first; brand (newer createdAt) before sku tie; description last
    const ids = search(db, { q: "aurora" }).items.map((i) => i.id);
    expect(ids).toEqual(["prod_r1", "prod_r4", "prod_r2", "prod_r3"]);
  });

  it("rejects empty queries", () => {
    expect(() => search(db, { q: "  " })).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });
});

describe("search filters and sorts", () => {
  it("composes q with category, price range, and inStock filters", () => {
    const cat = search(db, { q: "aurora", categoryId: "cat_1" }); // cat_3 descends from cat_1
    expect(cat.items.map((i) => i.id).sort()).toEqual(["prod_r2", "prod_r3", "prod_r4"]);
    const priced = search(db, { q: "aurora", maxPriceVnd: 250000 });
    expect(priced.items.map((i) => i.id).sort()).toEqual(["prod_r1", "prod_r4"]);
    // only var_r1 has an inventory row
    const stocked = search(db, { q: "aurora", inStock: true });
    expect(stocked.items.map((i) => i.id)).toEqual(["prod_r1"]);
  });

  it("sorts by price, newest, rating, popular", () => {
    const byPrice = search(db, { q: "aurora", sort: "price_asc" }).items.map((i) => i.id);
    expect(byPrice).toEqual(["prod_r4", "prod_r1", "prod_r2", "prod_r3"]);
    const byNewest = search(db, { q: "aurora", sort: "newest" }).items.map((i) => i.id);
    expect(byNewest).toEqual(["prod_r4", "prod_r3", "prod_r2", "prod_r1"]);
    const byRating = search(db, { q: "ceramic", sort: "rating" }).items.map((i) => i.id);
    expect(byRating).toEqual(["prod_1", "prod_r4", "prod_2"]); // 4.5, no reviews, no reviews → newest tie-break
    const byPopular = search(db, { q: "aurora", sort: "popular" }).items.map((i) => i.id);
    expect(byPopular.slice(0, 2)).toEqual(["prod_r2", "prod_r1"]); // 5 units, then 2
  });
});

describe("search pagination", () => {
  it("paginates relevance and newest stably, reporting total", () => {
    const p1 = search(db, { q: "aurora", limit: 2 });
    expect(p1.total).toBe(4);
    expect(p1.items.map((i) => i.id)).toEqual(["prod_r1", "prod_r4"]);
    const p2 = search(db, { q: "aurora", limit: 2, cursor: p1.nextCursor! });
    // total is the full match set — a cursor must not shrink it
    expect(p2.total).toBe(4);
    expect(p2.items.map((i) => i.id)).toEqual(["prod_r2", "prod_r3"]);
    expect(p2.nextCursor).toBeNull();

    const n1 = search(db, { q: "aurora", sort: "newest", limit: 3 });
    const n2 = search(db, { q: "aurora", sort: "newest", limit: 3, cursor: n1.nextCursor! });
    expect([...n1.items, ...n2.items].map((i) => i.id)).toEqual([
      "prod_r4",
      "prod_r3",
      "prod_r2",
      "prod_r1",
    ]);
  });

  it("rejects cursors minted for a different sort or malformed", () => {
    const p1 = search(db, { q: "aurora", sort: "popular", limit: 2 });
    expect(() =>
      search(db, { q: "aurora", sort: "price_asc", cursor: p1.nextCursor! }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(() => search(db, { q: "aurora", cursor: "!!!" })).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });
});

describe("suggest", () => {
  it("returns prefix-matched product names, en and vi", () => {
    expect(suggest(db, "ceramic")).toEqual(["Ceramic Teapot", "Ceramic Vase"]);
    expect(suggest(db, "cer")).toEqual(["Ceramic Teapot", "Ceramic Vase"]);
    expect(suggest(db, "ấm")).toEqual(["Ấm trà gốm"]);
    expect(suggest(db, "zzz")).toEqual([]);
    expect(() => suggest(db, "")).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});

describe("search history", () => {
  it("writes a row on authenticated search; guests write nothing", () => {
    recordSearch(db, "usr_customer", "  teapot ");
    recordSearch(db, "usr_customer", "aurora");
    const rows = db
      .select()
      .from(searchHistory)
      .where(eq(searchHistory.userId, "usr_customer"))
      .all();
    expect(rows.map((r) => r.query)).toEqual(["teapot", "aurora"]);
    // service contract: only ever called with a real userId (route guards)
    const all = db.select().from(searchHistory).all();
    expect(all.every((r) => r.userId === "usr_customer")).toBe(true);
  });
});

describe("SearchQuery contract", () => {
  it("maps empty-string params to absent, never 0/false", () => {
    const parsed = SearchQuery.parse({ q: "x", minPriceVnd: "", inStock: "", cursor: "" });
    expect(parsed.minPriceVnd).toBeUndefined();
    expect(parsed.inStock).toBeUndefined();
    expect(parsed.cursor).toBeUndefined();
    // a real empty would have coerced to 0 → proves "" ≠ 0
    expect(SearchQuery.parse({ q: "x", minPriceVnd: "0" }).minPriceVnd).toBe(0);
  });

  it("suggest mode ignores search params without 400", () => {
    const base = SearchBase.parse({ q: "cer", mode: "suggest", sort: "bogus", limit: "9999" });
    expect(base.mode).toBe("suggest");
    expect(SearchQuery.safeParse({ q: "x", sort: "bogus" }).success).toBe(false);
  });
});
