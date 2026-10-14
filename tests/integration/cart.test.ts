import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthError } from "@/server/api/errors";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { cartItems, carts, inventory, products } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import {
  addItem,
  clearCart,
  getCart,
  mergeGuestCart,
  removeItem,
  updateQty,
} from "@/server/modules/cart/service";

const PATH = "./tests/.tmp/cart-test.db";
const USER = "usr_customer";
const OTHER = "usr_admin";
// var_1/var_3 → shop_1 products; var_6 → shop_2 product.
const SHOP1_VAR = "var_1"; // sale 135000
const SHOP1_VAR2 = "var_3"; // base 420000
const SHOP2_VAR = "var_6"; // base 90000

let db: DB;

function errorCode(fn: () => unknown): { code: string; status: number } {
  try {
    fn();
  } catch (e) {
    const err = e as AuthError;
    return { code: err.code, status: err.status };
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

beforeEach(() => {
  db.delete(cartItems).run();
  db.delete(carts).run();
  for (const v of [SHOP1_VAR, SHOP1_VAR2, SHOP2_VAR]) {
    db.update(inventory).set({ onHand: 20, reserved: 0 }).where(eq(inventory.variantId, v)).run();
  }
  db.update(products).set({ status: "ACTIVE" }).run();
});

describe("getCart", () => {
  it("returns an empty view without creating a cart row", () => {
    const view = getCart(db, USER);
    expect(view).toEqual({ cartId: null, items: [], byShop: [], subtotalVnd: 0 });
    expect(db.select().from(carts).all()).toHaveLength(0);
  });

  it("groups lines by shop and resolves live prices", () => {
    addItem(db, USER, SHOP1_VAR, 2); // 135000 sale
    addItem(db, USER, SHOP1_VAR2, 1); // 420000
    addItem(db, USER, SHOP2_VAR, 3); // 90000

    const view = getCart(db, USER);
    expect(view.items).toHaveLength(3);
    expect(view.subtotalVnd).toBe(135000 * 2 + 420000 + 90000 * 3);

    expect(view.byShop).toHaveLength(2);
    const s1 = view.byShop.find((g) => g.shopId === "shop_1")!;
    const s2 = view.byShop.find((g) => g.shopId === "shop_2")!;
    expect(s1.shopName).toBe("Saigon Crafts");
    expect(s2.shopName).toBe("Danang Goods");
    expect(s1.items.map((i) => i.variantId).sort()).toEqual([SHOP1_VAR, SHOP1_VAR2]);
    expect(s2.items).toHaveLength(1);

    const line = view.items.find((i) => i.variantId === SHOP1_VAR)!;
    expect(line).toMatchObject({
      productId: "prod_1",
      sku: "MUG-BLU",
      name: "Handmade Ceramic Mug · Blue",
      attrs: { color: "blue" },
      unitPriceVnd: 135000,
      qty: 2,
      available: true,
      shopId: "shop_1",
    });
  });
});

describe("addItem", () => {
  it("creates the cart on first add and increments on repeat variant", () => {
    const first = addItem(db, USER, SHOP1_VAR, 1);
    expect(first.cartId).toMatch(/^cart_/);
    const second = addItem(db, USER, SHOP1_VAR, 2);
    expect(second.cartId).toBe(first.cartId);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].qty).toBe(3);
  });

  it("rejects unknown variants and bad qty", () => {
    expect(errorCode(() => addItem(db, USER, "var_nope", 1))).toEqual({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(errorCode(() => addItem(db, USER, SHOP1_VAR, 0))).toEqual({
      code: "INVALID_INPUT",
      status: 400,
    });
    expect(errorCode(() => addItem(db, USER, SHOP1_VAR, 1.5))).toEqual({
      code: "INVALID_INPUT",
      status: 400,
    });
    expect(getCart(db, USER).items).toHaveLength(0);
  });

  it("allows qty > stock in the cart but flags the line unavailable", () => {
    db.update(inventory)
      .set({ onHand: 1, reserved: 0 })
      .where(eq(inventory.variantId, SHOP1_VAR))
      .run();
    const view = addItem(db, USER, SHOP1_VAR, 5);
    expect(view.items[0]).toMatchObject({ qty: 5, available: false });
  });

  it("flags lines unavailable when the product is no longer ACTIVE", () => {
    addItem(db, USER, SHOP1_VAR, 1);
    db.update(products).set({ status: "ARCHIVED" }).where(eq(products.id, "prod_1")).run();
    expect(getCart(db, USER).items[0].available).toBe(false);
  });

  it("rejects variants whose product is not ACTIVE", () => {
    db.update(products).set({ status: "DRAFT" }).where(eq(products.id, "prod_1")).run();
    expect(errorCode(() => addItem(db, USER, SHOP1_VAR, 1))).toEqual({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(getCart(db, USER).items).toHaveLength(0);
  });
});

describe("updateQty / removeItem", () => {
  it("sets absolute qty and deletes at qty 0", () => {
    const { items } = addItem(db, USER, SHOP1_VAR, 2);
    const id = items[0].cartItemId;
    expect(updateQty(db, USER, id, 7).items[0].qty).toBe(7);
    expect(updateQty(db, USER, id, 0).items).toHaveLength(0);
  });

  it("removes a line by id", () => {
    const view = addItem(db, USER, SHOP1_VAR, 1);
    addItem(db, USER, SHOP2_VAR, 1);
    const next = removeItem(db, USER, view.items[0].cartItemId);
    expect(next.items).toHaveLength(1);
    expect(next.items[0].variantId).toBe(SHOP2_VAR);
  });

  it("denies mutations on another user's items and missing ids", () => {
    const { items } = addItem(db, OTHER, SHOP1_VAR, 1);
    const foreignId = items[0].cartItemId;
    expect(errorCode(() => updateQty(db, USER, foreignId, 5))).toEqual({
      code: "FORBIDDEN",
      status: 403,
    });
    expect(errorCode(() => removeItem(db, USER, foreignId))).toEqual({
      code: "FORBIDDEN",
      status: 403,
    });
    expect(errorCode(() => removeItem(db, USER, "ci_missing"))).toEqual({
      code: "NOT_FOUND",
      status: 404,
    });
    // Foreign cart is untouched.
    expect(getCart(db, OTHER).items[0].qty).toBe(1);
  });
});

describe("clearCart", () => {
  it("empties the cart and is a no-op without one", () => {
    addItem(db, USER, SHOP1_VAR, 1);
    addItem(db, USER, SHOP2_VAR, 1);
    const cleared = clearCart(db, USER);
    expect(cleared.items).toHaveLength(0);
    expect(cleared.subtotalVnd).toBe(0);
    expect(clearCart(db, "usr_seller2").cartId).toBeNull();
  });
});

describe("mergeGuestCart", () => {
  it("upserts guest lines onto the server cart additively", () => {
    addItem(db, USER, SHOP1_VAR, 1);
    const merged = mergeGuestCart(db, USER, [
      { variantId: SHOP1_VAR, qty: 2 },
      { variantId: SHOP2_VAR, qty: 4 },
    ]);
    const v1 = merged.items.find((i) => i.variantId === SHOP1_VAR)!;
    const v6 = merged.items.find((i) => i.variantId === SHOP2_VAR)!;
    expect(v1.qty).toBe(3);
    expect(v6.qty).toBe(4);
  });

  it("skips dead and non-ACTIVE variants and creates the cart when needed", () => {
    db.update(products).set({ status: "DRAFT" }).where(eq(products.id, "prod_1")).run();
    const merged = mergeGuestCart(db, USER, [
      { variantId: "var_gone", qty: 2 },
      { variantId: SHOP1_VAR, qty: 5 }, // product DRAFT → skipped
      { variantId: SHOP2_VAR, qty: 1 },
    ]);
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].variantId).toBe(SHOP2_VAR);
  });

  it("rolls back the whole merge on an invalid line", () => {
    expect(
      errorCode(() =>
        mergeGuestCart(db, USER, [
          { variantId: SHOP1_VAR, qty: 1 },
          { variantId: SHOP2_VAR, qty: 0 },
        ]),
      ),
    ).toEqual({ code: "INVALID_INPUT", status: 400 });
    expect(getCart(db, USER).items).toHaveLength(0);
  });
});
