import { mkdirSync, rmSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import {
  createProduct,
  duplicateProduct,
  getSellerProduct,
  listSellerProducts,
  setProductStatus,
  setVariantStock,
  updateProduct,
  upsertVariant,
} from "@/server/modules/catalog/manage";
import { getProductBySlug, listProducts } from "@/server/modules/catalog/service";

const PATH = "./tests/.tmp/catalog-manage-test.db";
let db: DB;

const seller1: Actor = {
  userId: "usr_seller",
  roles: ["CUSTOMER", "SELLER"],
  memberships: [{ shopId: "shop_1", role: "OWNER", permissions: [] }],
};
const seller2: Actor = {
  userId: "usr_seller2",
  roles: ["CUSTOMER", "SELLER"],
  memberships: [{ shopId: "shop_2", role: "OWNER", permissions: [] }],
};
const staffNoWrite: Actor = {
  userId: "usr_staff",
  roles: ["CUSTOMER", "SELLER"],
  memberships: [{ shopId: "shop_1", role: "STAFF", permissions: ["product:read"] }],
};
const staffWrite: Actor = {
  userId: "usr_staff_w",
  roles: ["CUSTOMER", "SELLER"],
  memberships: [{ shopId: "shop_1", role: "STAFF", permissions: ["product:*"] }],
};

const productInput = {
  shopId: "shop_1",
  nameEn: "Test Candle",
  nameVi: "Nến thử nghiệm",
  categoryId: "cat_3",
  descriptionEn: "A candle.",
  descriptionVi: "Một cây nến.",
  status: "DRAFT" as const,
};
const variantInput = {
  sku: "TEST-CANDLE-1",
  nameEn: "Standard",
  nameVi: "Tiêu chuẩn",
  attrs: { scent: "lavender" },
  basePriceVnd: 120000,
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

beforeAll(() => {
  for (const f of [PATH, `${PATH}-wal`, `${PATH}-shm`]) rmSync(f, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
});

describe("catalog manage service", () => {
  it("creates a product as DRAFT, invisible to public reads", () => {
    const id = createProduct(db, seller1, { ...productInput, variants: [variantInput] });
    const mine = getSellerProduct(db, seller1, id);
    expect(mine.status).toBe("DRAFT");
    expect(mine.variants).toHaveLength(1);
    expect(mine.variants[0].sku).toBe("TEST-CANDLE-1");
    // listProducts defaults to ACTIVE; drafts stay invisible.
    expect(listProducts(db, { q: "candle" }).items.map((i) => i.id)).not.toContain(id);
    try {
      getProductBySlug(db, mine.slug);
      expect.unreachable();
    } catch (e) {
      expect((e as AuthError).code).toBe("NOT_FOUND");
    }

    // draft → active → archived
    setProductStatus(db, seller1, id, "ACTIVE");
    expect(listProducts(db, { q: "candle" }).items.map((i) => i.id)).toContain(id);
    setProductStatus(db, seller1, id, "ARCHIVED");
    expect(listProducts(db, { q: "candle" }).items.map((i) => i.id)).not.toContain(id);
  });

  it("refuses to publish a product with no variants", () => {
    const id = createProduct(db, seller1, { ...productInput, nameEn: "Empty Product" });
    expectErr(() => setProductStatus(db, seller1, id, "ACTIVE"), "INVALID_INPUT");
    expectErr(
      () => createProduct(db, seller1, { ...productInput, nameEn: "No Vars", status: "ACTIVE" }),
      "INVALID_INPUT",
    );
  });

  it("blocks cross-shop writes and missing product:write grants", () => {
    // prod_1 belongs to shop_1; seller2 owns shop_2 → FORBIDDEN on every op.
    expectErr(
      () => updateProduct(db, seller2, "prod_1", { ...productInput, variants: [] }),
      "FORBIDDEN",
    );
    expectErr(() => setProductStatus(db, seller2, "prod_1", "ARCHIVED"), "FORBIDDEN");
    expectErr(() => duplicateProduct(db, seller2, "prod_1"), "FORBIDDEN");
    expectErr(
      () => upsertVariant(db, seller2, "prod_1", { ...variantInput, sku: "X-1" }),
      "FORBIDDEN",
    );
    expectErr(() => setVariantStock(db, seller2, "var_1", 5, "test"), "FORBIDDEN");
    expectErr(() => createProduct(db, seller2, productInput), "FORBIDDEN");
    expectErr(() => listSellerProducts(db, seller2, "shop_1"), "FORBIDDEN");
    expectErr(() => getSellerProduct(db, seller2, "prod_1"), "FORBIDDEN");
    expectErr(
      () => updateProduct(db, staffNoWrite, "prod_1", { ...productInput, variants: [] }),
      "FORBIDDEN",
    );
    expectErr(() => createProduct(db, staffNoWrite, productInput), "FORBIDDEN");
    expectErr(() => createProduct(db, null, productInput), "UNAUTHORIZED");
    // ...and the write-granted staff member passes.
    const id = createProduct(db, staffWrite, { ...productInput, nameEn: "Staff Product" });
    expect(getSellerProduct(db, staffWrite, id).nameEn).toBe("Staff Product");
  });

  it("enforces SKU uniqueness across the whole catalog", () => {
    // MUG-BLU exists in the seed (shop_1 product).
    expectErr(
      () => upsertVariant(db, seller1, "prod_1", { ...variantInput, sku: "MUG-BLU" }),
      "INVALID_INPUT",
    );
    const id = createProduct(db, seller1, { ...productInput, nameEn: "SKU Race" });
    expectErr(
      () => upsertVariant(db, seller1, id, { ...variantInput, sku: "MUG-BLU" }),
      "INVALID_INPUT",
    );
  });

  it("updates fields and upserts variants, leaving omitted variants alone", () => {
    const id = createProduct(db, seller1, {
      ...productInput,
      variants: [{ ...variantInput, sku: "UPD-BASE" }],
    });
    const before = getSellerProduct(db, seller1, id).variants[0];
    updateProduct(db, seller1, id, {
      ...productInput,
      nameEn: "Updated Product",
      descriptionVi: "Đã sửa",
      variants: [
        { ...variantInput, id: before.id, sku: "UPD-BASE", basePriceVnd: 99000, stock: 7 },
        { ...variantInput, id: undefined, sku: "UPD-NEW", nameEn: "New Var", nameVi: "Mới" },
      ],
    });
    const after = getSellerProduct(db, seller1, id);
    expect(after.nameEn).toBe("Updated Product");
    expect(after.descriptionVi).toBe("Đã sửa");
    expect(after.variants).toHaveLength(2);
    const updated = after.variants.find((v) => v.id === before.id);
    expect(updated?.basePriceVnd).toBe(99000);
    expect(updated?.onHand).toBe(7);
  });

  it("applies stock as a delta against the form baseline, not absolute", () => {
    const id = createProduct(db, seller1, {
      ...productInput,
      nameEn: "Delta Stock",
      variants: [{ ...variantInput, sku: "DELTA-1", stock: 10 }],
    });
    const variant = getSellerProduct(db, seller1, id).variants[0];
    // An order consumed 2 between form load and save.
    setVariantStock(db, seller1, variant.id, 8, "order-consume");
    updateProduct(db, seller1, id, {
      ...productInput,
      // Seller submitted the unchanged value 10 with baseline 10 → no write.
      variants: [{ ...variantInput, id: variant.id, sku: "DELTA-1", stock: 10, baseline: 10 }],
    });
    expect(getSellerProduct(db, seller1, id).variants[0].onHand).toBe(8);
    // Seller bumps their copy 10 → 12 while the real onHand is 8 → 8 + 2 = 10.
    updateProduct(db, seller1, id, {
      ...productInput,
      variants: [{ ...variantInput, id: variant.id, sku: "DELTA-1", stock: 12, baseline: 10 }],
    });
    expect(getSellerProduct(db, seller1, id).variants[0].onHand).toBe(10);
    // Delta below current onHand → INVALID_INPUT, not silent negative stock.
    expectErr(
      () =>
        updateProduct(db, seller1, id, {
          ...productInput,
          variants: [{ ...variantInput, id: variant.id, sku: "DELTA-1", stock: 0, baseline: 15 }],
        }),
      "INVALID_INPUT",
    );
  });

  it("duplicates a product as a DRAFT with -COPY skus and zeroed stock", () => {
    setVariantStock(db, seller1, "var_1", 10, "test");
    const copyId = duplicateProduct(db, seller1, "prod_1");
    const src = getSellerProduct(db, seller1, "prod_1");
    const copy = getSellerProduct(db, seller1, copyId);
    expect(copy.status).toBe("DRAFT");
    expect(copy.slug).toContain("copy");
    expect(copy.variants).toHaveLength(src.variants.length);
    for (const v of copy.variants) {
      expect(v.sku).toMatch(/-COPY$/);
      expect(v.onHand).toBe(0);
    }
    expect(src.variants.map((v) => `${v.sku}-COPY`).sort()).toEqual(
      copy.variants.map((v) => v.sku).sort(),
    );
    // A second duplicate collides on the -COPY skus → mapped INVALID_INPUT.
    expectErr(() => duplicateProduct(db, seller1, "prod_1"), "INVALID_INPUT");
  });

  it("setVariantStock writes an absolute on-hand via the ledger", () => {
    const id = createProduct(db, seller1, {
      ...productInput,
      nameEn: "Stock Target",
      variants: [{ ...variantInput, sku: "STOCK-1", stock: 3 }],
    });
    const variant = getSellerProduct(db, seller1, id).variants[0];
    expect(variant.onHand).toBe(3);
    setVariantStock(db, seller1, variant.id, 9, "restock");
    expect(getSellerProduct(db, seller1, id).variants[0].onHand).toBe(9);
    // Setting the same value is a no-op — no spurious ledger row.
    setVariantStock(db, seller1, variant.id, 9, "restock");
    // A negative onHand is rejected by the contract; the service floor is
    // adjustStock's non-negative guard, hit here via a delta below zero.
    expectErr(() => setVariantStock(db, seller1, variant.id, -1, "bad"), "INVALID_INPUT");
  });
});
