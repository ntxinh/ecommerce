import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { products, shops } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { addItem } from "@/server/modules/cart/service";
import { createProduct, setProductStatus } from "@/server/modules/catalog/manage";
import {
  createCategory,
  deleteCategory,
  listAdminCategories,
  listModerationQueue,
  listProductModerations,
  moderateProduct,
  submitForReview,
  updateCategory,
} from "@/server/modules/catalog/moderation";
import {
  cardsForIds,
  getProductBySlug,
  getShopBySlug,
  listProducts,
} from "@/server/modules/catalog/service";
import { placeOrder } from "@/server/modules/orders/checkout";
import { search, suggest } from "@/server/modules/search/service";

const PATH = "./tests/.tmp/moderation-test.db";
let db: DB;

const admin: Actor = { userId: "usr_admin", roles: ["ADMIN"], memberships: [] };
const seller1: Actor = {
  userId: "usr_seller",
  roles: ["CUSTOMER", "SELLER"],
  memberships: [{ shopId: "shop_1", role: "OWNER", permissions: [] }],
};
const customer: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };

const productInput = {
  shopId: "shop_1",
  nameEn: "Moderated Kettle",
  nameVi: "Ấm kiểm duyệt",
  categoryId: "cat_3",
  descriptionEn: "A kettle.",
  descriptionVi: "Một cái ấm.",
  status: "DRAFT" as const,
};
const variantInput = {
  sku: "MOD-KETTLE-1",
  nameEn: "Standard",
  nameVi: "Tiêu chuẩn",
  attrs: {},
  basePriceVnd: 99000,
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

function prodRow(id: string) {
  return db.select().from(products).where(eq(products.id, id)).get();
}
const modStatus = (id: string) => prodRow(id)?.moderationStatus;
const pStatus = (id: string) => prodRow(id)?.status;
function publicIds() {
  return listProducts(db, {}).items.map((i) => i.id);
}

beforeAll(() => {
  for (const f of [PATH, `${PATH}-wal`, `${PATH}-shm`]) rmSync(f, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
});

describe("submit for review", () => {
  it("moves a seller draft into the moderation queue with a SUBMIT audit row", () => {
    const id = createProduct(db, seller1, {
      ...productInput,
      variants: [variantInput],
    });
    submitForReview(db, seller1, id);
    expect(modStatus(id)).toBe("SUBMITTED");
    expect(pStatus(id)).toBe("DRAFT");

    const queue = listModerationQueue(db, admin);
    const row = queue.find((r) => r.productId === id);
    expect(row).toMatchObject({ productId: id, shopId: "shop_1", status: "DRAFT" });

    const audit = listProductModerations(db, admin, id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "SUBMIT", actorId: "usr_seller" });
  });

  it("rejects re-submit, submitting non-drafts, and foreign-shop drafts", () => {
    const id = listModerationQueue(db, admin)[0].productId;
    expectErr(() => submitForReview(db, seller1, id), "INVALID_INPUT"); // already SUBMITTED
    expectErr(() => submitForReview(db, seller1, "prod_1"), "INVALID_INPUT"); // ACTIVE
    expectErr(() => submitForReview(db, seller1, "prod_4"), "FORBIDDEN"); // shop_2 product
    expectErr(() => submitForReview(db, customer, id), "FORBIDDEN");
    expectErr(() => submitForReview(db, null, id), "UNAUTHORIZED");
    expectErr(() => submitForReview(db, seller1, "prd_nope"), "NOT_FOUND");
  });
});

describe("admin moderation decisions", () => {
  it("approve clears the gate without touching the seller status", () => {
    const id = listModerationQueue(db, admin)[0].productId;
    moderateProduct(db, admin, { productId: id, action: "approve" });
    expect(modStatus(id)).toBe("APPROVED");
    // Reviewer fix: approve must not publish — the seller decides that.
    expect(pStatus(id)).toBe("DRAFT");
    expect(publicIds()).not.toContain(id);
    expect(listModerationQueue(db, admin).map((r) => r.productId)).not.toContain(id);

    const audit = listProductModerations(db, admin, id);
    expect(audit.map((a) => a.action)).toEqual(["SUBMIT", "APPROVE"]);

    // Seller publishes → publicly visible.
    setProductStatus(db, seller1, id, "ACTIVE");
    expect(publicIds()).toContain(id);
  });

  it("reject returns the product to DRAFT+REJECTED and keeps the note", () => {
    const id = createProduct(db, seller1, {
      ...productInput,
      nameEn: "Rejectable Lamp",
      variants: [{ ...variantInput, sku: "MOD-LAMP-1" }],
    });
    submitForReview(db, seller1, id);
    moderateProduct(db, admin, { productId: id, action: "reject", note: "bad photos" });
    expect(modStatus(id)).toBe("REJECTED");
    expect(pStatus(id)).toBe("DRAFT");
    const audit = listProductModerations(db, admin, id);
    expect(audit.at(-1)).toMatchObject({ action: "REJECT", note: "bad photos" });

    // Resubmission is allowed after a rejection; approve clears the gate and
    // the seller publishes.
    submitForReview(db, seller1, id);
    expect(modStatus(id)).toBe("SUBMITTED");
    moderateProduct(db, admin, { productId: id, action: "approve" });
    expect(pStatus(id)).toBe("DRAFT");
    setProductStatus(db, seller1, id, "ACTIVE");
    expect(publicIds()).toContain(id);
  });

  it("suspend hides an APPROVED product from every public read path", () => {
    // prod_1 is a seeded ACTIVE+NONE product — suspension must hide it too.
    const target = "prod_1";
    expect(publicIds()).toContain(target);
    moderateProduct(db, admin, { productId: target, action: "suspend", note: "policy" });
    expect(modStatus(target)).toBe("SUSPENDED");
    expect(pStatus(target)).toBe("ACTIVE"); // seller status untouched; gate does the hiding

    expect(publicIds()).not.toContain(target);
    expectErr(() => getProductBySlug(db, "handmade-ceramic-mug"), "NOT_FOUND");
    expect(cardsForIds(db, [target])).toHaveLength(0);
    expect(search(db, { q: "ceramic" }).items.map((i) => i.id)).not.toContain(target);
    expect(suggest(db, "handmade")).not.toContain("Handmade Ceramic Mug");
    // Shop page's product count drops too.
    expect(getShopBySlug(db, "saigon-crafts").productCount).toBe(4);
  });

  it("approve un-suspends back into public view", () => {
    moderateProduct(db, admin, { productId: "prod_1", action: "approve", note: "cleared" });
    expect(modStatus("prod_1")).toBe("APPROVED");
    expect(publicIds()).toContain("prod_1");
    expect(getProductBySlug(db, "handmade-ceramic-mug").id).toBe("prod_1");
  });

  it("approve keeps the seller status — a suspended archived product stays archived", () => {
    moderateProduct(db, admin, { productId: "prod_2", action: "suspend", note: "policy" });
    setProductStatus(db, seller1, "prod_2", "ARCHIVED");
    moderateProduct(db, admin, { productId: "prod_2", action: "approve" });
    expect(modStatus("prod_2")).toBe("APPROVED");
    expect(pStatus("prod_2")).toBe("ARCHIVED");
    expect(publicIds()).not.toContain("prod_2");
    setProductStatus(db, seller1, "prod_2", "ACTIVE"); // restore for other tests
  });

  it("suspended products are unsellable at checkout", async () => {
    // prod_5 (shop_2) is ACTIVE+NONE: line added first, then the admin suspends.
    const view = addItem(db, customer.userId, "var_7", 1);
    const line = view.items.find((i) => i.variantId === "var_7");
    if (!line) throw new Error("cart line missing");
    expect(line.available).toBe(true);
    moderateProduct(db, admin, { productId: "prod_5", action: "suspend", note: "fraud review" });
    try {
      await placeOrder(db, customer, {
        cartItemIds: [line.cartItemId],
        addressId: "addr_1",
        shippingByShop: {},
        voucherCodes: [],
        paymentMethod: "COD",
        idempotencyKey: "mod_suspended_order",
      });
      expect.unreachable("expected NOT_FOUND");
    } catch (e) {
      expect((e as AuthError).code).toBe("NOT_FOUND");
    }
    moderateProduct(db, admin, { productId: "prod_5", action: "approve", note: "cleared" });
  });

  it("suspended shops are unsellable at cart + checkout", async () => {
    const view = addItem(db, customer.userId, "var_7", 1);
    const line = view.items.find((i) => i.variantId === "var_7");
    if (!line) throw new Error("cart line missing");
    db.update(shops).set({ status: "SUSPENDED" }).where(eq(shops.id, "shop_2")).run();
    try {
      // direct add of another shop_2 variant is rejected, and the held line flips unavailable
      expect(() => addItem(db, customer.userId, "var_8", 1)).toThrow(AuthError);
      const after = addItem(db, customer.userId, "var_5", 1); // shop_1: still fine
      const staleLine = after.items.find((i) => i.variantId === "var_7");
      expect(staleLine?.available).toBe(false);
      await expect(
        placeOrder(db, customer, {
          cartItemIds: [line.cartItemId],
          addressId: "addr_1",
          shippingByShop: {},
          voucherCodes: [],
          paymentMethod: "COD",
          idempotencyKey: "mod_shop_suspended",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      db.update(shops).set({ status: "ACTIVE" }).where(eq(shops.id, "shop_2")).run();
    }
  });

  it("requires a note on reject/suspend and valid queue states on approve/reject", () => {
    expectErr(
      () => moderateProduct(db, admin, { productId: "prod_2", action: "reject" }),
      "INVALID_INPUT",
    );
    // prod_2 is ACTIVE+NONE — not in the queue.
    expectErr(
      () => moderateProduct(db, admin, { productId: "prod_2", action: "approve" }),
      "INVALID_INPUT",
    );
    expectErr(
      () => moderateProduct(db, admin, { productId: "prod_2", action: "reject", note: "x" }),
      "INVALID_INPUT",
    );
    expectErr(
      () => moderateProduct(db, admin, { productId: "prd_nope", action: "approve" }),
      "NOT_FOUND",
    );
  });

  it("denies non-admin actors on every admin surface", () => {
    expectErr(() => listModerationQueue(db, seller1), "FORBIDDEN");
    expectErr(() => listModerationQueue(db, null), "UNAUTHORIZED");
    expectErr(
      () => moderateProduct(db, seller1, { productId: "prod_2", action: "approve" }),
      "FORBIDDEN",
    );
    expectErr(() => listProductModerations(db, seller1, "prod_2"), "FORBIDDEN");
    expectErr(() => listAdminCategories(db, customer), "FORBIDDEN");
    expectErr(
      () => createCategory(db, seller1, { slug: "x", nameEn: "X", nameVi: "X", sortOrder: 0 }),
      "FORBIDDEN",
    );
    expectErr(() => deleteCategory(db, customer, "cat_4"), "FORBIDDEN");
  });
});

describe("admin category management", () => {
  it("creates, updates, and deletes an empty category", () => {
    const id = createCategory(db, admin, {
      parentId: "cat_1",
      slug: "admin-cat",
      nameEn: "Admin Cat",
      nameVi: "Danh mục admin",
      sortOrder: 9,
    });
    let row = listAdminCategories(db, admin).find((c) => c.id === id);
    expect(row).toMatchObject({ slug: "admin-cat", parentId: "cat_1", productCount: 0 });

    updateCategory(db, admin, {
      id,
      nameEn: "Admin Cat 2",
      nameVi: "Danh mục admin 2",
      sortOrder: 3,
    });
    row = listAdminCategories(db, admin).find((c) => c.id === id);
    expect(row).toMatchObject({ nameEn: "Admin Cat 2", sortOrder: 3 });

    deleteCategory(db, admin, id);
    expect(listAdminCategories(db, admin).map((c) => c.id)).not.toContain(id);
  });

  it("blocks deleting categories that hold products or children", () => {
    expectErr(() => deleteCategory(db, admin, "cat_3"), "INVALID_INPUT"); // prod_1, prod_2
    expectErr(() => deleteCategory(db, admin, "cat_1"), "INVALID_INPUT"); // parent of cat_3
    expectErr(() => deleteCategory(db, admin, "cat_nope"), "NOT_FOUND");
    // Self/descendant parenting would make the tree unreachable.
    expectErr(
      () =>
        updateCategory(db, admin, {
          id: "cat_1",
          parentId: "cat_3",
          nameEn: "x",
          nameVi: "x",
          sortOrder: 1,
        }),
      "INVALID_INPUT",
    );
    expectErr(
      () =>
        createCategory(db, admin, {
          slug: "x2",
          nameEn: "X",
          nameVi: "X",
          parentId: "nope",
          sortOrder: 0,
        }),
      "INVALID_INPUT",
    );
    expectErr(
      () => updateCategory(db, admin, { id: "cat_nope", nameEn: "x", nameVi: "x", sortOrder: 1 }),
      "NOT_FOUND",
    );
  });
});
