import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import type { DB } from "@/server/db/client";
import { cartItems, carts, products, productVariants, shops } from "@/server/db/schema";
import { availableStock, sweepExpiredReservations } from "@/server/modules/inventory/service";

/** Query surface shared by DB and a drizzle tx so mergeGuestCart can run atomically. */
type CartStore = Pick<DB, "select" | "insert" | "update" | "delete">;

export type CartLine = {
  cartItemId: string;
  variantId: string;
  productId: string;
  /** Product name + variant name (English), e.g. "Handmade Ceramic Mug · Blue". */
  name: string;
  sku: string;
  attrs: Record<string, unknown>;
  unitPriceVnd: number;
  qty: number;
  /** Live check: enough stock AND product still ACTIVE. Revalidated at checkout. */
  available: boolean;
  shopId: string;
  shopName: string;
};

export type CartShopGroup = {
  shopId: string;
  shopName: string;
  items: CartLine[];
};

export type CartView = {
  cartId: string | null;
  items: CartLine[];
  byShop: CartShopGroup[];
  subtotalVnd: number;
};

function assertQty(qty: number, allowZero = false) {
  const lo = allowZero ? 0 : 1;
  if (!Number.isInteger(qty) || qty < lo || qty > 999) {
    throw new AuthError("INVALID_INPUT", 400, "qty must be an integer in range");
  }
}

/** Returns the user's cart id, creating the row on first write. */
function cartIdFor(db: CartStore, userId: string, create: true): string;
function cartIdFor(db: CartStore, userId: string, create?: false): string | null;
function cartIdFor(db: CartStore, userId: string, create = false): string | null {
  const existing = db.select({ id: carts.id }).from(carts).where(eq(carts.userId, userId)).get();
  if (existing) return existing.id;
  if (!create) return null;
  const id = `cart_${ulid()}`;
  const now = Date.now();
  db.insert(carts)
    .values({ id, userId, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: carts.userId })
    .run();
  // A concurrent insert may have won — re-read rather than trusting `id`.
  return db.select({ id: carts.id }).from(carts).where(eq(carts.userId, userId)).get()!.id;
}

function touch(db: CartStore, cartId: string) {
  db.update(carts).set({ updatedAt: Date.now() }).where(eq(carts.id, cartId)).run();
}

function parseAttrs(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Variant exists AND its product is sellable (ACTIVE). */
function isSellable(db: CartStore, variantId: string) {
  return !!db
    .select({ id: productVariants.id })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(productVariants.id, variantId), eq(products.status, "ACTIVE")))
    .get();
}

function upsertItem(db: CartStore, cartId: string, variantId: string, qty: number) {
  db.insert(cartItems)
    .values({ id: `ci_${ulid()}`, cartId, variantId, qty })
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.variantId],
      set: { qty: sql`${cartItems.qty} + ${qty}` },
    })
    .run();
}

/** Asserts the line belongs to this user's cart. */
function ownedItem(db: CartStore, userId: string, cartItemId: string) {
  const row = db
    .select({ id: cartItems.id, cartId: cartItems.cartId, ownerId: carts.userId })
    .from(cartItems)
    .innerJoin(carts, eq(carts.id, cartItems.cartId))
    .where(eq(cartItems.id, cartItemId))
    .get();
  if (!row) throw new AuthError("NOT_FOUND", 404, "cart item not found");
  if (row.ownerId !== userId) throw new AuthError("FORBIDDEN", 403);
  return row;
}

/** Reads the cart joined to variant/product/shop, grouping lines by shop. */
export function getCart(db: DB, userId: string): CartView {
  // On-read expiry sweep: abandoned reservations must free stock before
  // availability is computed (no background timers by design).
  sweepExpiredReservations(db);
  const empty: CartView = { cartId: null, items: [], byShop: [], subtotalVnd: 0 };
  const cartId = cartIdFor(db, userId);
  if (!cartId) return empty;

  const rows = db
    .select({
      cartItemId: cartItems.id,
      variantId: cartItems.variantId,
      qty: cartItems.qty,
      productId: products.id,
      productName: products.nameEn,
      productStatus: products.status,
      variantName: productVariants.nameEn,
      sku: productVariants.sku,
      attrsJson: productVariants.attributesJson,
      basePriceVnd: productVariants.basePriceVnd,
      salePriceVnd: productVariants.salePriceVnd,
      shopId: shops.id,
      shopName: shops.name,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(shops, eq(shops.id, products.shopId))
    .where(eq(cartItems.cartId, cartId))
    .orderBy(asc(cartItems.id))
    .all();

  const items: CartLine[] = rows.map((r) => ({
    cartItemId: r.cartItemId,
    variantId: r.variantId,
    productId: r.productId,
    name: `${r.productName} · ${r.variantName}`,
    sku: r.sku,
    attrs: parseAttrs(r.attrsJson),
    unitPriceVnd: r.salePriceVnd ?? r.basePriceVnd,
    qty: r.qty,
    available: r.productStatus === "ACTIVE" && availableStock(db, r.variantId) >= r.qty,
    shopId: r.shopId,
    shopName: r.shopName,
  }));

  const shopMap = new Map<string, CartShopGroup>();
  for (const item of items) {
    let group = shopMap.get(item.shopId);
    if (!group) {
      group = { shopId: item.shopId, shopName: item.shopName, items: [] };
      shopMap.set(item.shopId, group);
    }
    group.items.push(item);
  }

  return {
    cartId,
    items,
    byShop: [...shopMap.values()],
    subtotalVnd: items.reduce((sum, i) => sum + i.unitPriceVnd * i.qty, 0),
  };
}

/** Additive upsert: repeats of the same variant increment qty. */
export function addItem(db: DB, userId: string, variantId: string, qty: number): CartView {
  assertQty(qty);
  if (!isSellable(db, variantId)) throw new AuthError("NOT_FOUND", 404, "variant not found");
  const cartId = cartIdFor(db, userId, true);
  upsertItem(db, cartId, variantId, qty);
  touch(db, cartId);
  return getCart(db, userId);
}

/** qty 0 deletes the line. */
export function updateQty(db: DB, userId: string, cartItemId: string, qty: number): CartView {
  assertQty(qty, true);
  const item = ownedItem(db, userId, cartItemId);
  if (qty === 0) {
    db.delete(cartItems).where(eq(cartItems.id, item.id)).run();
  } else {
    db.update(cartItems).set({ qty }).where(eq(cartItems.id, item.id)).run();
  }
  touch(db, item.cartId);
  return getCart(db, userId);
}

export function removeItem(db: DB, userId: string, cartItemId: string): CartView {
  const item = ownedItem(db, userId, cartItemId);
  db.delete(cartItems).where(eq(cartItems.id, item.id)).run();
  touch(db, item.cartId);
  return getCart(db, userId);
}

export function clearCart(db: DB, userId: string): CartView {
  const cartId = cartIdFor(db, userId);
  if (cartId) {
    db.delete(cartItems).where(eq(cartItems.cartId, cartId)).run();
    touch(db, cartId);
  }
  return getCart(db, userId);
}

/** Guest-merge: upserts each line into the server cart; dead variants are skipped. */
export function mergeGuestCart(
  db: DB,
  userId: string,
  items: { variantId: string; qty: number }[],
): CartView {
  if (items.length === 0) return getCart(db, userId);
  db.transaction((tx) => {
    const cartId = cartIdFor(tx, userId, true);
    for (const { variantId, qty } of items) {
      assertQty(qty);
      if (!isSellable(tx, variantId)) continue;
      upsertItem(tx, cartId, variantId, qty);
    }
    touch(tx, cartId);
  });
  return getCart(db, userId);
}
