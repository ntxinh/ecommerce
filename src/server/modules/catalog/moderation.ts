import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import type { z } from "zod";
import type {
  CategoryInput,
  ModerateProductInput,
  UpdateCategoryInput,
} from "@/server/api/contracts/catalog";
import { AuthError } from "@/server/api/errors";
import { type Actor, requirePermission } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import { categories, productModerations, products, shops } from "@/server/db/schema";
import type { Tx } from "@/server/modules/inventory/service";
import { assertPublishable, mapConstraint, writeTarget } from "./manage";
import { categoryDescendants } from "./service";

type ModerateIn = z.infer<typeof ModerateProductInput>;
type CategoryIn = z.infer<typeof CategoryInput>;
type UpdateCategoryIn = z.infer<typeof UpdateCategoryInput>;

const invalid = (msg: string): never => {
  throw new AuthError("INVALID_INPUT", 400, msg);
};

function audit(
  tx: Tx,
  productId: string,
  actorId: string,
  action: "SUBMIT" | "APPROVE" | "REJECT" | "SUSPEND",
  note?: string,
) {
  tx.insert(productModerations)
    .values({
      id: `mod_${ulid()}`,
      productId,
      actorId,
      action,
      note: note ?? null,
      createdAt: Date.now(),
    })
    .run();
}

// --- seller -----------------------------------------------------------------

/** Seller submits a DRAFT for admin review. REJECTED drafts may resubmit. */
export function submitForReview(db: DB, actor: Actor | null, productId: string): void {
  db.transaction((tx) => {
    const { product, actor: a } = writeTarget(tx, actor, productId);
    if (product.status !== "DRAFT") invalid("only drafts can be submitted for review");
    if (!["NONE", "REJECTED"].includes(product.moderationStatus)) {
      invalid("product is already in or past review");
    }
    assertPublishable(tx, productId);
    tx.update(products)
      .set({ moderationStatus: "SUBMITTED" })
      .where(eq(products.id, productId))
      .run();
    audit(tx, productId, a.userId, "SUBMIT");
  });
}

// --- admin: queue ------------------------------------------------------------

export type QueueRow = {
  productId: string;
  slug: string;
  nameEn: string;
  nameVi: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  shopId: string;
  shopName: string;
  submittedAt: number | null;
  submitterNote: string | null;
};

/** Products awaiting a decision, oldest submission first. */
export function listModerationQueue(db: DB, actor: Actor | null): QueueRow[] {
  requirePermission(actor, "admin:*");
  const rows = db
    .select({
      productId: products.id,
      slug: products.slug,
      nameEn: products.nameEn,
      nameVi: products.nameVi,
      status: products.status,
      shopId: shops.id,
      shopName: shops.name,
    })
    .from(products)
    .innerJoin(shops, eq(shops.id, products.shopId))
    .where(eq(products.moderationStatus, "SUBMITTED"))
    .all();
  if (rows.length === 0) return [];
  // Attach the latest SUBMIT row per product (when/how it entered the queue).
  const subs = db
    .select()
    .from(productModerations)
    .where(eq(productModerations.action, "SUBMIT"))
    .all();
  const latest = new Map<string, { at: number; note: string | null }>();
  for (const s of subs) {
    const cur = latest.get(s.productId);
    if (!cur || s.createdAt > cur.at) latest.set(s.productId, { at: s.createdAt, note: s.note });
  }
  return rows
    .map((r) => ({
      ...r,
      submittedAt: latest.get(r.productId)?.at ?? null,
      submitterNote: latest.get(r.productId)?.note ?? null,
    }))
    .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
}

/** Append-only decision history for one product, oldest first. */
export function listProductModerations(db: DB, actor: Actor | null, productId: string) {
  requirePermission(actor, "admin:*");
  return db
    .select()
    .from(productModerations)
    .where(eq(productModerations.productId, productId))
    .orderBy(sql`${productModerations}.rowid`) // ULIDs don't order ties within the same ms
    .all();
}

/**
 * Admin decision. approve: SUBMITTED|SUSPENDED → APPROVED, seller status
 * untouched (a suspended DRAFT/ARCHIVED stays so — it only becomes public if
 * the seller publishes it). reject: SUBMITTED → DRAFT+REJECTED (note
 * required). suspend: any non-archived product → SUSPENDED while keeping its
 * seller status (note required); the public gate hides it until approved.
 */
export function moderateProduct(db: DB, actor: Actor | null, input: ModerateIn): void {
  const a = requirePermission(actor, "admin:*");
  const note = input.note?.trim() || undefined;
  db.transaction((tx) => {
    const product = tx.select().from(products).where(eq(products.id, input.productId)).get();
    if (!product) throw new AuthError("NOT_FOUND", 404, "product not found");
    const mod = product.moderationStatus;
    let status = product.status;
    let next: "APPROVED" | "REJECTED" | "SUSPENDED";
    if (input.action === "approve") {
      if (mod !== "SUBMITTED" && mod !== "SUSPENDED") invalid("product is not awaiting review");
      next = "APPROVED";
    } else if (input.action === "reject") {
      if (mod !== "SUBMITTED") invalid("product is not awaiting review");
      if (!note) invalid("a reason is required to reject");
      status = "DRAFT";
      next = "REJECTED";
    } else {
      if (product.status === "ARCHIVED") invalid("archived products need no moderation");
      if (mod === "SUSPENDED") invalid("product is already suspended");
      if (!note) invalid("a reason is required to suspend");
      next = "SUSPENDED";
    }
    tx.update(products)
      .set({ moderationStatus: next, status })
      .where(eq(products.id, product.id))
      .run();
    audit(
      tx,
      product.id,
      a.userId,
      input.action.toUpperCase() as "APPROVE" | "REJECT" | "SUSPEND",
      note,
    );
  });
}

// --- admin: categories -------------------------------------------------------

export type AdminCategoryRow = typeof categories.$inferSelect & { productCount: number };

/** Flat category list with product counts, for the admin CRUD page. */
export function listAdminCategories(db: DB, actor: Actor | null): AdminCategoryRow[] {
  requirePermission(actor, "admin:*");
  const rows = db
    .select()
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.id))
    .all();
  const counts = db
    .select({ categoryId: products.categoryId, n: sql<number>`count(*)` })
    .from(products)
    .groupBy(products.categoryId)
    .all();
  const byCat: Record<string, number> = {};
  for (const c of counts) byCat[c.categoryId] = c.n;
  return rows.map((r) => ({ ...r, productCount: byCat[r.id] ?? 0 }));
}

function assertParent(tx: Tx, parentId: string | undefined | null) {
  if (!parentId) return;
  const p = tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, parentId))
    .get();
  if (!p) invalid("parent category does not exist");
}

export function createCategory(db: DB, actor: Actor | null, input: CategoryIn): string {
  requirePermission(actor, "admin:*");
  return db.transaction((tx) => {
    assertParent(tx, input.parentId);
    const id = `cat_${ulid()}`;
    try {
      tx.insert(categories)
        .values({
          id,
          parentId: input.parentId ?? null,
          slug: input.slug,
          nameEn: input.nameEn,
          nameVi: input.nameVi,
          sortOrder: input.sortOrder,
        })
        .run();
    } catch (e) {
      mapConstraint(e);
    }
    return id;
  });
}

/** Full-field update; slug is immutable (public URLs are built from it). */
export function updateCategory(db: DB, actor: Actor | null, input: UpdateCategoryIn): void {
  requirePermission(actor, "admin:*");
  db.transaction((tx) => {
    const row = tx.select().from(categories).where(eq(categories.id, input.id)).get();
    if (!row) throw new AuthError("NOT_FOUND", 404, "category not found");
    const parentId = input.parentId ?? null;
    if (parentId === input.id) invalid("a category cannot be its own parent");
    // Reparenting under a descendant would cut the branch off the tree.
    if (parentId && categoryDescendants(db, input.id).includes(parentId)) {
      invalid("a category cannot move under its own descendant");
    }
    assertParent(tx, parentId);
    tx.update(categories)
      .set({
        parentId,
        nameEn: input.nameEn,
        nameVi: input.nameVi,
        sortOrder: input.sortOrder,
      })
      .where(eq(categories.id, input.id))
      .run();
  });
}

/** Delete is refused while products or child categories reference it. */
export function deleteCategory(db: DB, actor: Actor | null, categoryId: string): void {
  requirePermission(actor, "admin:*");
  db.transaction((tx) => {
    const row = tx.select().from(categories).where(eq(categories.id, categoryId)).get();
    if (!row) throw new AuthError("NOT_FOUND", 404, "category not found");
    const used = tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.categoryId, categoryId))
      .limit(1)
      .get();
    if (used) invalid("category still has products");
    const child = tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.parentId, categoryId))
      .limit(1)
      .get();
    if (child) invalid("category still has subcategories");
    tx.delete(categories).where(eq(categories.id, categoryId)).run();
  });
}
