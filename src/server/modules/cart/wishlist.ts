import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import type { DB } from "@/server/db/client";
import { products, wishlistItems, wishlists } from "@/server/db/schema";
import { cardsForIds, type ProductCard } from "@/server/modules/catalog/service";

/** Query surface shared by DB and a drizzle tx so merges can run atomically. */
type Store = Pick<DB, "select" | "insert" | "update" | "delete">;

/** Returns the user's wishlist id, creating the row on first write. */
function wishlistIdFor(db: Store, userId: string): string {
  const row = db
    .select({ id: wishlists.id })
    .from(wishlists)
    .where(eq(wishlists.userId, userId))
    .get();
  if (row) return row.id;
  const id = `wl_${ulid()}`;
  db.insert(wishlists).values({ id, userId, createdAt: Date.now() }).run();
  return id;
}

/** Product ids on the user's wishlist, oldest first. */
export function getWishlist(db: DB, userId: string): string[] {
  const wl = db
    .select({ id: wishlists.id })
    .from(wishlists)
    .where(eq(wishlists.userId, userId))
    .get();
  if (!wl) return [];
  return db
    .select({ productId: wishlistItems.productId })
    .from(wishlistItems)
    .where(eq(wishlistItems.wishlistId, wl.id))
    .orderBy(asc(wishlistItems.createdAt), asc(wishlistItems.id))
    .all()
    .map((r) => r.productId);
}

/** Toggles `productId`; returns true when now on the wishlist, false when removed. */
export function toggleWishlistItem(db: DB, userId: string, productId: string): boolean {
  const product = db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId))
    .get();
  if (!product) throw new AuthError("NOT_FOUND", 404, "product not found");
  const wishlistId = wishlistIdFor(db, userId);
  const existing = db
    .select({ id: wishlistItems.id })
    .from(wishlistItems)
    .where(and(eq(wishlistItems.wishlistId, wishlistId), eq(wishlistItems.productId, productId)))
    .get();
  if (existing) {
    db.delete(wishlistItems).where(eq(wishlistItems.id, existing.id)).run();
    return false;
  }
  // onConflictDoNothing so a double-submit never 500s on the UNIQUE index.
  db.insert(wishlistItems)
    .values({ id: `wli_${ulid()}`, wishlistId, productId, createdAt: Date.now() })
    .onConflictDoNothing()
    .run();
  return true;
}

/** Guest-merge: appends ids not already on the server wishlist; dead ids are skipped. */
export function mergeGuestWishlist(db: DB, userId: string, productIds: string[]): string[] {
  const wanted = [...new Set(productIds)];
  if (wanted.length === 0) return getWishlist(db, userId);
  db.transaction((tx) => {
    const live = tx
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.id, wanted))
      .all()
      .map((r) => r.id);
    if (live.length === 0) return;
    const wishlistId = wishlistIdFor(tx, userId);
    tx.insert(wishlistItems)
      .values(
        live.map((productId) => ({
          id: `wli_${ulid()}`,
          wishlistId,
          productId,
          createdAt: Date.now(),
        })),
      )
      .onConflictDoNothing()
      .run();
  });
  return getWishlist(db, userId);
}

/** Public cards for the account wishlist page (dead/unpublished products drop off). */
export function listWishlistCards(db: DB, userId: string): ProductCard[] {
  const ids = getWishlist(db, userId);
  return ids.length ? cardsForIds(db, ids) : [];
}
