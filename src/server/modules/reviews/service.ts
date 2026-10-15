import "server-only";

import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import { type Actor, requirePermission } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import { auditLogs, orderItems, orders, products, reviews, users } from "@/server/db/schema";

export type ReviewableItem = {
  orderItemId: string;
  productName: string;
  orderId: string;
};

export type ModerationReviewRow = {
  id: string;
  productId: string;
  productName: string;
  authorName: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: "PUBLISHED" | "HIDDEN";
  createdAt: number;
};

// Parent statuses that prove a fulfilled purchase (returns can still file
// after refund, so PARTIALLY_REFUNDED stays reviewable).
const REVIEWABLE_ORDER_STATUSES = ["DELIVERED", "COMPLETED", "PARTIALLY_REFUNDED"] as const;

const invalid = (msg: string): never => {
  throw new AuthError("INVALID_INPUT", 400, msg);
};

const validRating = (r: number) => Number.isInteger(r) && r >= 1 && r <= 5;

/**
 * Creates the buyer's review for one order item. Requires: the order belongs
 * to the actor and has been fulfilled (DELIVERED/COMPLETED/PARTIALLY_REFUNDED);
 * the item's product is not one of the actor's shops (ADMIN exempt). One
 * review per order item — the UNIQUE(order_item_id) index is the backstop.
 */
export function createReview(
  db: DB,
  actor: Actor | null,
  input: { orderItemId: string; rating: number; title?: string; body?: string; images?: string[] },
): string {
  if (!actor) throw new AuthError("UNAUTHORIZED", 401);
  if (!validRating(input.rating)) invalid("rating must be an integer in 1..5");

  const id = `rev_${ulid()}`;
  db.transaction((tx) => {
    const item = tx.select().from(orderItems).where(eq(orderItems.id, input.orderItemId)).get();
    if (!item) throw new AuthError("NOT_FOUND", 404, "order item not found");
    const order = tx.select().from(orders).where(eq(orders.id, item.orderId)).get();
    if (!order || order.userId !== actor.userId) {
      throw new AuthError("FORBIDDEN", 403, "not your order item");
    }
    if (!(REVIEWABLE_ORDER_STATUSES as readonly string[]).includes(order.status)) {
      throw new AuthError("INVALID_INPUT", 422, `order is ${order.status} — not yet reviewable`);
    }
    const product = tx.select().from(products).where(eq(products.id, item.productId)).get();
    if (
      product &&
      !actor.roles.includes("ADMIN") &&
      actor.memberships.some((m) => m.shopId === product.shopId)
    ) {
      throw new AuthError("FORBIDDEN", 403, "cannot review your own shop's product");
    }
    try {
      tx.insert(reviews)
        .values({
          id,
          orderItemId: input.orderItemId,
          productId: item.productId,
          userId: actor.userId,
          rating: input.rating,
          title: input.title?.trim() || null,
          body: input.body?.trim() || null,
          imagesJson: JSON.stringify(input.images ?? []),
          status: "PUBLISHED",
          createdAt: Date.now(),
        })
        .run();
    } catch (e) {
      // The UNIQUE(order_item_id) index is authoritative — catches the race the
      // read-side listReviewableItems can't.
      if (e instanceof Error && e.message.includes("UNIQUE")) {
        invalid("already reviewed");
      }
      throw e;
    }
  });
  return id;
}

/**
 * Author-only patch. `undefined` leaves a field untouched; `null`/"" clears
 * title or body. Editing a HIDDEN review is allowed — moderation decides
 * visibility, the author owns the text.
 */
export function updateReview(
  db: DB,
  actor: Actor | null,
  reviewId: string,
  patch: { rating?: number; title?: string | null; body?: string | null },
): void {
  if (!actor) throw new AuthError("UNAUTHORIZED", 401);
  if (patch.rating !== undefined && !validRating(patch.rating)) {
    invalid("rating must be an integer in 1..5");
  }
  const review = db.select().from(reviews).where(eq(reviews.id, reviewId)).get();
  if (!review) throw new AuthError("NOT_FOUND", 404, "review not found");
  if (review.userId !== actor.userId) throw new AuthError("FORBIDDEN", 403, "not your review");

  const set: Partial<typeof reviews.$inferInsert> = {};
  if (patch.rating !== undefined) set.rating = patch.rating;
  if (patch.title !== undefined) set.title = patch.title?.trim() || null;
  if (patch.body !== undefined) set.body = patch.body?.trim() || null;
  if (Object.keys(set).length === 0) return;
  db.update(reviews).set(set).where(eq(reviews.id, reviewId)).run();
}

/** Author or ADMIN delete. `order_item_id` frees back to reviewable. */
export function deleteReview(db: DB, actor: Actor | null, reviewId: string): void {
  if (!actor) throw new AuthError("UNAUTHORIZED", 401);
  const review = db.select().from(reviews).where(eq(reviews.id, reviewId)).get();
  if (!review) throw new AuthError("NOT_FOUND", 404, "review not found");
  if (!actor.roles.includes("ADMIN") && review.userId !== actor.userId) {
    throw new AuthError("FORBIDDEN", 403, "not your review");
  }
  db.delete(reviews).where(eq(reviews.id, reviewId)).run();
}

/**
 * Admin visibility flip: PUBLISHED↔HIDDEN. Every call appends a
 * "review.moderate" audit row (from/to/note) — moderation decisions are
 * always audited, even no-op repeats.
 */
export function moderateReview(
  db: DB,
  actor: Actor | null,
  reviewId: string,
  action: "HIDE" | "UNHIDE",
  note?: string,
): void {
  const a = requirePermission(actor, "admin:*");
  const to = action === "HIDE" ? "HIDDEN" : "PUBLISHED";
  db.transaction((tx) => {
    const review = tx.select().from(reviews).where(eq(reviews.id, reviewId)).get();
    if (!review) throw new AuthError("NOT_FOUND", 404, "review not found");
    if (review.status !== to) {
      tx.update(reviews).set({ status: to }).where(eq(reviews.id, reviewId)).run();
    }
    tx.insert(auditLogs)
      .values({
        id: `aud_${ulid()}`,
        actorId: a.userId,
        action: "review.moderate",
        targetType: "review",
        targetId: reviewId,
        metaJson: JSON.stringify({ from: review.status, to, note: note ?? null }),
        createdAt: Date.now(),
      })
      .run();
  });
}

/**
 * The actor's purchased items that can still be reviewed: order fulfilled,
 * no review row yet, and (non-admin) not the actor's own shop's product.
 * Empty when logged out — callers need no purchase history to gate on.
 */
export function listReviewableItems(db: DB, actor: Actor | null): ReviewableItem[] {
  if (!actor) return [];
  const reviewed = db
    .select({ orderItemId: reviews.orderItemId })
    .from(reviews)
    .where(eq(reviews.userId, actor.userId))
    .all()
    .map((r) => r.orderItemId)
    .filter((id): id is string => id !== null);
  const ownShops: Record<string, true> = {};
  for (const m of actor.memberships) ownShops[m.shopId] = true;
  const isAdmin = actor.roles.includes("ADMIN");
  const where = [
    eq(orders.userId, actor.userId),
    inArray(orders.status, [...REVIEWABLE_ORDER_STATUSES]),
  ];
  if (reviewed.length) where.push(notInArray(orderItems.id, reviewed));
  return db
    .select({
      orderItemId: orderItems.id,
      productName: orderItems.nameSnapshot,
      orderId: orderItems.orderId,
      shopId: products.shopId,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(and(...where))
    .all()
    .filter((r) => isAdmin || !ownShops[r.shopId])
    .map(({ orderItemId, productName, orderId }) => ({ orderItemId, productName, orderId }));
}

/** Recent reviews for the admin moderation surface, newest first. */
export function listReviewModerationQueue(db: DB, actor: Actor | null): ModerationReviewRow[] {
  requirePermission(actor, "admin:*");
  return db
    .select({
      id: reviews.id,
      productId: reviews.productId,
      productName: products.nameEn,
      authorName: users.name,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      status: reviews.status,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .innerJoin(products, eq(products.id, reviews.productId))
    .innerJoin(users, eq(users.id, reviews.userId))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .all();
}
