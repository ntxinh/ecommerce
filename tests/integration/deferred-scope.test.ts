import { mkdirSync, rmSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { createPromotion } from "@/server/modules/admin/ops";
import {
  getWishlist,
  mergeGuestWishlist,
  toggleWishlistItem,
} from "@/server/modules/cart/wishlist";
import { getSellerProduct, updateProduct } from "@/server/modules/catalog/manage";
import {
  clearSearchHistory,
  listRecentSearches,
  recordSearch,
} from "@/server/modules/search/service";

const PATH = "./tests/.tmp/deferred-scope-test.db";
let db: DB;

const seller1: Actor = {
  userId: "usr_seller",
  roles: ["CUSTOMER", "SELLER"],
  memberships: [{ shopId: "shop_1", role: "OWNER", permissions: [] }],
};
const admin: Actor = { userId: "usr_admin", roles: ["ADMIN"], memberships: [] };
const customer: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as AuthError).code;
  }
  throw new Error("expected AuthError");
}

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
});

describe("wishlist", () => {
  it("toggle is idempotent: add → remove → add", () => {
    const uid = "usr_customer";
    expect(toggleWishlistItem(db, uid, "prod_1")).toBe(true);
    expect(getWishlist(db, uid)).toContain("prod_1");
    expect(toggleWishlistItem(db, uid, "prod_1")).toBe(false);
    expect(getWishlist(db, uid)).not.toContain("prod_1");
    expect(toggleWishlistItem(db, uid, "prod_1")).toBe(true);
    // The UNIQUE wishlist+product index means the list holds it exactly once.
    expect(getWishlist(db, uid).filter((p) => p === "prod_1")).toHaveLength(1);
  });

  it("mergeGuestWishlist dedupes against existing items", () => {
    const uid = "usr_admin";
    toggleWishlistItem(db, uid, "prod_1");
    mergeGuestWishlist(db, uid, ["prod_1", "prod_2"]);
    const ids = getWishlist(db, uid);
    expect(ids.filter((p) => p === "prod_1")).toHaveLength(1);
    expect(ids).toContain("prod_2");
  });
});

describe("createPromotion permission gate", () => {
  const base = {
    scope: "SHOP" as const,
    kind: "PERCENT" as const,
    value: 500,
    startsAt: Date.now(),
    endsAt: Date.now() + 86_400_000,
  };

  it("rejects anonymous and non-member actors; allows shop owner", () => {
    expect(errorCode(() => createPromotion(db, null, { ...base, shopId: "shop_1" }))).toBe(
      "UNAUTHORIZED",
    );
    expect(errorCode(() => createPromotion(db, customer, { ...base, shopId: "shop_1" }))).toBe(
      "FORBIDDEN",
    );
    // seller1 owns shop_1, not shop_2 — cross-shop is FORBIDDEN.
    expect(errorCode(() => createPromotion(db, seller1, { ...base, shopId: "shop_2" }))).toBe(
      "FORBIDDEN",
    );
    expect(typeof createPromotion(db, seller1, { ...base, shopId: "shop_1" })).toBe("string");
    // SHOP scope without a shopId is invalid input.
    expect(errorCode(() => createPromotion(db, seller1, base))).toBe("INVALID_INPUT");
    // ADMIN bypass lets ops create a SHOP promo for any shop.
    expect(typeof createPromotion(db, admin, { ...base, shopId: "shop_2" })).toBe("string");
    // PRODUCT scope requires a real product.
    expect(
      errorCode(() =>
        createPromotion(db, admin, {
          scope: "PRODUCT",
          kind: "FIXED",
          value: 1000,
          productId: "prd_missing",
          startsAt: base.startsAt,
          endsAt: base.endsAt,
        }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("product_attributes roundtrip via product save", () => {
  it("replace-sets attributes on update and reads them back", () => {
    // prod_1 ships with seeded spec rows; the save payload replaces them.
    updateProduct(db, seller1, "prod_1", {
      shopId: "shop_1",
      nameEn: "Seed product en",
      nameVi: "Seed product vi",
      categoryId: getSellerProduct(db, seller1, "prod_1").categoryId,
      descriptionEn: "",
      descriptionVi: "",
      status: "ACTIVE",
      variants: [],
      attributes: [
        { name: "Material", value: "Cotton" },
        { name: "Origin", value: "VN" },
      ],
    });
    const detail = getSellerProduct(db, seller1, "prod_1");
    expect(detail.attributes.map((a) => [a.name, a.value])).toEqual([
      ["Material", "Cotton"],
      ["Origin", "VN"],
    ]);
    // A second save replaces the whole set (deleted rows stay deleted).
    updateProduct(db, seller1, "prod_1", {
      shopId: "shop_1",
      nameEn: "Seed product en",
      nameVi: "Seed product vi",
      categoryId: detail.categoryId,
      descriptionEn: "",
      descriptionVi: "",
      status: "ACTIVE",
      variants: [],
      attributes: [{ name: "Origin", value: "JP" }],
    });
    expect(getSellerProduct(db, seller1, "prod_1").attributes).toEqual([
      expect.objectContaining({ name: "Origin", value: "JP" }),
    ]);
  });
});

describe("search history", () => {
  it("records, lists most-recent-first deduped, and clears", () => {
    const uid = "usr_customer";
    clearSearchHistory(db, uid);
    // Fake timers so each insert lands on a distinct createdAt — same-ms ULIDs
    // order by their random tail, which would flake recency assertions.
    vi.useFakeTimers();
    let t0 = 1_700_000_000_000;
    for (const q of ["mug", "shirt", "mug"]) {
      t0 += 1000;
      vi.setSystemTime(t0);
      recordSearch(db, uid, q);
    }
    vi.useRealTimers();
    const recent = listRecentSearches(db, uid);
    expect(recent[0]).toBe("mug");
    expect(recent.filter((q) => q === "mug")).toHaveLength(1);
    expect(recent).toContain("shirt");
    clearSearchHistory(db, uid);
    expect(listRecentSearches(db, uid)).toEqual([]);
  });
});
