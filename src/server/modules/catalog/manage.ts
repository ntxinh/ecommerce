import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import type { z } from "zod";
import type { ProductInput, ProductSaveInput, VariantInput } from "@/server/api/contracts/catalog";
import { AuthError } from "@/server/api/errors";
import { type Actor, requirePermission } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import {
  brands,
  inventory,
  inventoryMovements,
  productImages,
  products,
  productVariants,
} from "@/server/db/schema";
import { adjustStock, type Tx } from "@/server/modules/inventory/service";
import { availSql, type CategoryNode, listCategories, minPrice } from "./service";

type ProductIn = z.infer<typeof ProductInput>;
type SaveIn = z.infer<typeof ProductSaveInput>;
type VariantIn = z.infer<typeof VariantInput>;
type ProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export type SellerProductRow = {
  id: string;
  slug: string;
  nameEn: string;
  nameVi: string;
  status: ProductStatus;
  categoryId: string;
  variantCount: number;
  available: number;
  minPriceVnd: number | null;
};

export type SellerVariant = {
  id: string;
  sku: string;
  nameEn: string;
  nameVi: string;
  attrs: Record<string, unknown>;
  basePriceVnd: number;
  salePriceVnd: number | null;
  onHand: number;
};

export type SellerProductDetail = typeof products.$inferSelect & { variants: SellerVariant[] };

function loadProduct(tx: Tx, productId: string) {
  const product = tx.select().from(products).where(eq(products.id, productId)).get();
  if (!product) throw new AuthError("NOT_FOUND", 404, "product not found");
  return product;
}

/** Loads the product, then asserts `product:write` on its shop. */
function writeTarget(tx: Tx, actor: Actor | null, productId: string) {
  const product = loadProduct(tx, productId);
  return { product, actor: requirePermission(actor, "product:write", { shopId: product.shopId }) };
}

/** A product may only go ACTIVE when it has at least one purchasable variant —
 *  public listProducts inner-joins variants, so variantless ACTIVES are invisible
 *  anyway; fail the publish instead of silently listing nothing. */
function assertPublishable(tx: Tx, productId: string) {
  const variants = tx
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .all();
  if (variants.length === 0) {
    throw new AuthError("INVALID_INPUT", 400, "product needs at least one variant to publish");
  }
}

function uniqueSlug(tx: Tx, nameEn: string): string {
  const base =
    nameEn
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "product";
  let slug = base;
  for (let i = 2; tx.select().from(products).where(eq(products.slug, slug)).get(); i += 1) {
    slug = `${base}-${i}`;
  }
  return slug;
}

/** SQLite reports constraint violations as message text only; map the ones a
 *  seller form can plausibly hit, rethrow everything else. */
function mapConstraint(e: unknown): never {
  if (e instanceof Error) {
    if (e.message.includes("UNIQUE") && e.message.includes("sku")) {
      throw new AuthError("INVALID_INPUT", 400, "SKU already in use");
    }
    if (e.message.includes("FOREIGN KEY")) {
      throw new AuthError("INVALID_INPUT", 400, "referenced record does not exist");
    }
  }
  throw e;
}

/** Absolute on-hand set inside a caller-owned tx, with a ledger row; no-op when unchanged. */
function setStock(
  tx: Tx,
  variantId: string,
  onHand: number,
  reason: string,
  actorId: string,
): void {
  const inv = tx.select().from(inventory).where(eq(inventory.variantId, variantId)).get();
  const delta = onHand - (inv?.onHand ?? 0);
  if (delta === 0 && inv) return;
  if (!inv) {
    tx.insert(inventory).values({ variantId, onHand: 0, reserved: 0, updatedAt: Date.now() }).run();
  }
  if (delta !== 0) moveStock(tx, variantId, delta, reason, actorId);
}

/** Delta move inside a caller-owned tx — same atomic non-negative guard + ledger
 *  row as adjustStock (which needs a DB handle, not a tx). */
function moveStock(
  tx: Tx,
  variantId: string,
  delta: number,
  reason: string,
  actorId: string,
): void {
  const res = tx
    .update(inventory)
    .set({ onHand: sql`${inventory.onHand} + ${delta}`, updatedAt: Date.now() })
    .where(and(eq(inventory.variantId, variantId), sql`${inventory.onHand} + ${delta} >= 0`))
    .run();
  if (res.changes === 0) {
    throw new AuthError("INVALID_INPUT", 400, "stock adjustment would make onHand negative");
  }
  tx.insert(inventoryMovements)
    .values({
      id: `mov_${ulid()}`,
      variantId,
      delta,
      reason,
      actorId,
      createdAt: Date.now(),
    })
    .run();
}

/** Insert-or-update a variant row inside a caller-owned tx; returns its id. */
function upsertVariantRow(tx: Tx, actor: Actor, productId: string, v: VariantIn): string {
  if (v.id) {
    const existing = tx.select().from(productVariants).where(eq(productVariants.id, v.id)).get();
    if (!existing || existing.productId !== productId) {
      throw new AuthError("NOT_FOUND", 404, "variant not found");
    }
    try {
      tx.update(productVariants)
        .set({
          sku: v.sku,
          nameEn: v.nameEn,
          nameVi: v.nameVi,
          attributesJson: JSON.stringify(v.attrs),
          basePriceVnd: v.basePriceVnd,
          salePriceVnd: v.salePriceVnd ?? null,
        })
        .where(eq(productVariants.id, v.id))
        .run();
    } catch (e) {
      mapConstraint(e);
    }
    if (v.stock != null) {
      // Form submits a baseline (the onHand it loaded): write the delta so
      // concurrent order/reservation movement isn't clobbered. No baseline →
      // absolute set (e.g. API callers that mean "make it exactly this").
      const delta = v.baseline == null ? null : v.stock - v.baseline;
      if (delta == null) setStock(tx, v.id, v.stock, "seller-adjust", actor.userId);
      else if (delta !== 0) moveStock(tx, v.id, delta, "seller-adjust", actor.userId);
    }
    return v.id;
  }
  const id = `var_${ulid()}`;
  try {
    tx.insert(productVariants)
      .values({
        id,
        productId,
        sku: v.sku,
        nameEn: v.nameEn,
        nameVi: v.nameVi,
        attributesJson: JSON.stringify(v.attrs),
        basePriceVnd: v.basePriceVnd,
        salePriceVnd: v.salePriceVnd ?? null,
        createdAt: Date.now(),
      })
      .run();
  } catch (e) {
    mapConstraint(e);
  }
  setStock(tx, id, v.stock ?? 0, "seller-adjust", actor.userId);
  return id;
}

// --- seller reads -------------------------------------------------------------

export function listSellerProducts(
  db: DB,
  actor: Actor | null,
  shopId: string,
): SellerProductRow[] {
  requirePermission(actor, "product:read", { shopId });
  const rows = db
    .select({
      id: products.id,
      slug: products.slug,
      nameEn: products.nameEn,
      nameVi: products.nameVi,
      status: products.status,
      categoryId: products.categoryId,
      variantCount: sql<number>`count(${productVariants.id})`,
      available: availSql.mapWith(Number),
      minPriceVnd: minPrice.mapWith((v) => (v == null ? null : Number(v))),
    })
    .from(products)
    .leftJoin(productVariants, eq(productVariants.productId, products.id))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(eq(products.shopId, shopId))
    .groupBy(products.id)
    .orderBy(products.createdAt, products.id)
    .all();
  return rows;
}

export function getSellerProduct(
  db: DB,
  actor: Actor | null,
  productId: string,
): SellerProductDetail {
  const product = loadProduct(db, productId);
  requirePermission(actor, "product:read", { shopId: product.shopId });
  const variants = db
    .select({ v: productVariants, onHand: inventory.onHand })
    .from(productVariants)
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.id))
    .all();
  return {
    ...product,
    variants: variants.map(({ v, onHand }) => ({
      id: v.id,
      sku: v.sku,
      nameEn: v.nameEn,
      nameVi: v.nameVi,
      attrs: JSON.parse(v.attributesJson) as Record<string, unknown>,
      basePriceVnd: v.basePriceVnd,
      salePriceVnd: v.salePriceVnd,
      onHand: onHand ?? 0,
    })),
  };
}

/** Category tree flattened to depth-indented select options + all brands, for
 *  the seller product form. Not permission-gated: categories/brands are global
 *  reference data the layout already guards behind the seller shell. */
export function listFormOptions(
  db: DB,
  locale: string,
): { categories: { id: string; label: string }[]; brands: { id: string; name: string }[] } {
  const categories: { id: string; label: string }[] = [];
  const walk = (nodes: CategoryNode[], depth: number) => {
    for (const n of nodes) {
      const label = `${"　".repeat(depth)}${locale === "vi" ? n.nameVi : n.nameEn}`;
      categories.push({ id: n.id, label });
      walk(n.children, depth + 1);
    }
  };
  walk(listCategories(db), 0);
  const brandRows = db.select().from(brands).orderBy(asc(brands.name)).all();
  return { categories, brands: brandRows.map((b) => ({ id: b.id, name: b.name })) };
}

// --- writes -------------------------------------------------------------------

/** Creates a product (plus its variants when `input.variants` is present). */
export function createProduct(db: DB, actor: Actor | null, input: ProductIn | SaveIn): string {
  const auth = requirePermission(actor, "product:write", { shopId: input.shopId });
  if (input.status === "ACTIVE" && !("variants" in input && input.variants.length > 0)) {
    throw new AuthError("INVALID_INPUT", 400, "product needs at least one variant to publish");
  }
  return db.transaction((tx) => {
    const id = `prd_${ulid()}`;
    try {
      tx.insert(products)
        .values({
          id,
          shopId: input.shopId,
          categoryId: input.categoryId,
          brandId: input.brandId ?? null,
          slug: uniqueSlug(tx, input.nameEn),
          nameEn: input.nameEn,
          nameVi: input.nameVi,
          descriptionEn: input.descriptionEn,
          descriptionVi: input.descriptionVi,
          status: input.status,
          createdAt: Date.now(),
        })
        .run();
    } catch (e) {
      mapConstraint(e);
    }
    for (const v of "variants" in input ? input.variants : []) {
      upsertVariantRow(tx, auth, id, v);
    }
    return id;
  });
}

/**
 * Updates product fields and upserts every variant row in `input.variants`.
 * Existing variants absent from the payload are left alone — deleting a variant
 * would orphan order history, so removal stays a manual/archive operation.
 * Status changes go through setProductStatus.
 */
export function updateProduct(db: DB, actor: Actor | null, productId: string, input: SaveIn): void {
  db.transaction((tx) => {
    const { actor: auth } = writeTarget(tx, actor, productId);
    try {
      tx.update(products)
        .set({
          nameEn: input.nameEn,
          nameVi: input.nameVi,
          categoryId: input.categoryId,
          brandId: input.brandId ?? null,
          descriptionEn: input.descriptionEn,
          descriptionVi: input.descriptionVi,
        })
        .where(eq(products.id, productId))
        .run();
    } catch (e) {
      mapConstraint(e);
    }
    for (const v of input.variants) upsertVariantRow(tx, auth, productId, v);
  });
}

export function setProductStatus(
  db: DB,
  actor: Actor | null,
  productId: string,
  status: ProductStatus,
): void {
  db.transaction((tx) => {
    writeTarget(tx, actor, productId);
    if (status === "ACTIVE") assertPublishable(tx, productId);
    tx.update(products).set({ status }).where(eq(products.id, productId)).run();
  });
}

/**
 * Copies a product as a new DRAFT: slug/name get a suffix, every variant is
 * cloned with a `-COPY` sku and zero stock, product images follow their
 * variant mapping.
 */
export function duplicateProduct(db: DB, actor: Actor | null, productId: string): string {
  return db.transaction((tx) => {
    const { product: src } = writeTarget(tx, actor, productId);
    const id = `prd_${ulid()}`;
    tx.insert(products)
      .values({
        id,
        shopId: src.shopId,
        categoryId: src.categoryId,
        brandId: src.brandId,
        slug: uniqueSlug(tx, `${src.slug}-copy`),
        nameEn: `${src.nameEn} (copy)`,
        nameVi: `${src.nameVi} (copy)`,
        descriptionEn: src.descriptionEn,
        descriptionVi: src.descriptionVi,
        status: "DRAFT",
        createdAt: Date.now(),
      })
      .run();
    const srcVariants = tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .orderBy(asc(productVariants.id))
      .all();
    const idMap = new Map<string, string>();
    for (const v of srcVariants) {
      const newId = `var_${ulid()}`;
      idMap.set(v.id, newId);
      try {
        tx.insert(productVariants)
          .values({
            ...v,
            id: newId,
            productId: id,
            sku: `${v.sku}-COPY`,
            createdAt: Date.now(),
          })
          .run();
      } catch (e) {
        // A second duplicate hits UNIQUE(sku) on -COPY → INVALID_INPUT, not a 500.
        mapConstraint(e);
      }
      tx.insert(inventory)
        .values({ variantId: newId, onHand: 0, reserved: 0, updatedAt: Date.now() })
        .run();
    }
    const imgs = tx
      .select()
      .from(productImages)
      .where(eq(productImages.productId, productId))
      .all();
    for (const img of imgs) {
      if (img.variantId && !idMap.has(img.variantId)) continue;
      tx.insert(productImages)
        .values({
          ...img,
          id: `img_${ulid()}`,
          productId: id,
          variantId: img.variantId ? (idMap.get(img.variantId) ?? null) : null,
        })
        .run();
    }
    return id;
  });
}

/** Insert a new variant (v.id unset) or update an existing one on a product. */
export function upsertVariant(
  db: DB,
  actor: Actor | null,
  productId: string,
  variant: VariantIn,
): string {
  return db.transaction((tx) => {
    const { actor: auth } = writeTarget(tx, actor, productId);
    return upsertVariantRow(tx, auth, productId, variant);
  });
}

/**
 * Sets a variant's absolute on-hand count via adjustStock (so the delta lands
 * in the movement ledger). Creates the inventory row if the variant never had one.
 */
export function setVariantStock(
  db: DB,
  actor: Actor | null,
  variantId: string,
  onHand: number,
  reason: string,
): void {
  const variant = db.select().from(productVariants).where(eq(productVariants.id, variantId)).get();
  if (!variant) throw new AuthError("NOT_FOUND", 404, "variant not found");
  const product = loadProduct(db, variant.productId);
  const auth = requirePermission(actor, "product:write", { shopId: product.shopId });
  const inv = db.select().from(inventory).where(eq(inventory.variantId, variantId)).get();
  if (!inv) {
    db.insert(inventory).values({ variantId, onHand: 0, reserved: 0, updatedAt: Date.now() }).run();
  }
  const delta = onHand - (inv?.onHand ?? 0);
  if (delta !== 0) adjustStock(db, variantId, delta, reason, auth.userId);
}
