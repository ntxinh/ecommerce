import "server-only";

import { and, asc, desc, eq, gt, gte, inArray, lt, lte, or, type SQL, sql } from "drizzle-orm";
import { AuthError } from "@/server/api/errors";
import type { DB } from "@/server/db/client";
import {
  categories,
  inventory,
  orderItems,
  productAttributes,
  productImages,
  products,
  productVariants,
  promotions,
  reviews,
  shops,
  users,
} from "@/server/db/schema";

export type CategoryNode = {
  id: string;
  parentId: string | null;
  slug: string;
  nameEn: string;
  nameVi: string;
  sortOrder: number;
  children: CategoryNode[];
};

export type RatingAgg = { avg: number | null; count: number };

export type ProductCard = {
  id: string;
  slug: string;
  nameEn: string;
  nameVi: string;
  /** Lowest effective variant price (sale price wins over base). */
  priceVnd: number;
  ratingAvg: number | null;
  ratingCount: number;
  inStock: boolean;
  imageUrl: string | null;
  imageAlt: string;
  shop: { id: string; slug: string; name: string };
};

export type ProductSort = "newest" | "price_asc" | "price_desc" | "rating";

export type ListProductsOpts = {
  categoryId?: string;
  shopId?: string;
  /** Defaults to "ACTIVE" — the public surface. Sellers/admins pass explicitly. */
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  q?: string;
  minPriceVnd?: number;
  maxPriceVnd?: number;
  minRating?: number;
  inStock?: boolean;
  sort?: ProductSort;
  cursor?: string;
  /** 1..50, default 20. */
  limit?: number;
};

export type VariantView = {
  id: string;
  sku: string;
  nameEn: string;
  nameVi: string;
  attrs: Record<string, unknown>;
  priceVnd: number;
  salePriceVnd: number | null;
  available: number;
};

export type ProductDetail = {
  id: string;
  slug: string;
  nameEn: string;
  nameVi: string;
  descriptionEn: string;
  descriptionVi: string;
  categoryId: string;
  brandId: string | null;
  createdAt: number;
  shop: { id: string; slug: string; name: string; description: string };
  variants: VariantView[];
  images: { id: string; url: string; alt: string; variantId: string | null }[];
  rating: RatingAgg;
  attributes: { name: string; value: string }[];
  flashSale: { priceVnd: number; endsAt: number } | null;
};

export type ShopCard = {
  id: string;
  slug: string;
  name: string;
  description: string;
  productCount: number;
};

export type HomepageData = {
  categories: CategoryNode[];
  flashSale: { productId: string; flashPriceVnd: number; flashEndsAt: number; card: ProductCard }[];
  featuredShops: ShopCard[];
  trending: ProductCard[];
  newest: { items: ProductCard[]; nextCursor: string | null };
};

// --- shared select expressions -------------------------------------------

/** Effective variant price: sale price when set, else base. */
export const effectivePrice = sql`coalesce(${productVariants.salePriceVnd}, ${productVariants.basePriceVnd})`;
/** Card price = cheapest variant's effective price. */
export const minPrice = sql`min(${effectivePrice})`;
export const availSql = sql`coalesce(sum(${inventory.onHand} - ${inventory.reserved}), 0)`;
/** Public visibility gate: seller-published AND not held by moderation.
 *  NONE covers never-submitted (seeded/legacy) products; SUBMITTED, REJECTED
 *  and SUSPENDED are hidden. Exported for search + cart — same rule everywhere. */
export const publicGate = sql`${products.status} = 'ACTIVE' and ${products.moderationStatus} in ('NONE','APPROVED')`;
// Correlated aggregates over PUBLISHED reviews only — HIDDEN never counts.
export const ratingAvg = sql<number | null>`(
  select avg(r.rating) from ${reviews} r
  where r.product_id = ${products.id} and r.status = ${"PUBLISHED"})`;
const ratingCount = sql<number>`(
  select count(*) from ${reviews} r
  where r.product_id = ${products.id} and r.status = ${"PUBLISHED"})`;

// Exported for the search module — card rows must hydrate identically wherever
// a product list is built.
export const cardSelect = {
  id: products.id,
  slug: products.slug,
  nameEn: products.nameEn,
  nameVi: products.nameVi,
  status: products.status,
  createdAt: products.createdAt,
  shop: { id: shops.id, slug: shops.slug, name: shops.name },
  priceVnd: minPrice.mapWith(Number),
  ratingAvg: ratingAvg.mapWith((v) => (v == null ? null : Number(v))),
  ratingCount: ratingCount.mapWith(Number),
  available: availSql.mapWith(Number),
};

export type CardRow = {
  id: string;
  slug: string;
  nameEn: string;
  nameVi: string;
  status: string;
  createdAt: number;
  shop: { id: string; slug: string; name: string };
  priceVnd: number;
  ratingAvg: number | null;
  ratingCount: number;
  available: number;
};

// --- cursors ---------------------------------------------------------------

// Cursor = base64url JSON of the full sort-key tuple for the last row.
// Predicates are strictly lexicographic over (sortKey…, id) so pagination is
// stable even when sort keys tie (all seeds share createdAt≈).
type Cursor = { s: ProductSort; v?: number; c?: number; i: string };

export function encodeCursor(c: object): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(raw: string, sort: ProductSort): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
    const ok =
      c.s === sort &&
      typeof c.i === "string" &&
      c.i.length > 0 &&
      (sort === "newest" ? num(c.c) : sort === "rating" ? num(c.v) && num(c.c) : num(c.v));
    if (!ok) throw new Error("bad cursor");
    return c;
  } catch {
    throw new AuthError("INVALID_INPUT", 400, "invalid cursor");
  }
}

// (key op, tie → next key …, id > lastId). Key columns live in WHERE when they
// are plain columns/scalar subqueries, HAVING when they are aggregates.
function afterPredicate(sort: ProductSort, c: Cursor): { where?: SQL; having?: SQL } {
  const idGt = gt(products.id, c.i);
  switch (sort) {
    case "newest":
      return {
        where: or(lt(products.createdAt, c.c!), and(eq(products.createdAt, c.c!), idGt)),
      };
    case "rating": {
      const key = sql`coalesce(${ratingAvg}, 0)`;
      return {
        where: or(
          lt(key, c.v!),
          and(
            eq(key, c.v!),
            or(lt(products.createdAt, c.c!), and(eq(products.createdAt, c.c!), idGt)),
          ),
        ),
      };
    }
    case "price_asc":
      return { having: or(gt(minPrice, c.v!), and(eq(minPrice, c.v!), idGt)) };
    case "price_desc":
      return { having: or(lt(minPrice, c.v!), and(eq(minPrice, c.v!), idGt)) };
  }
}

function orderFor(sort: ProductSort): SQL[] {
  switch (sort) {
    case "newest":
      return [desc(products.createdAt), asc(products.id)];
    case "rating":
      return [desc(sql`coalesce(${ratingAvg}, 0)`), desc(products.createdAt), asc(products.id)];
    case "price_asc":
      return [asc(minPrice), asc(products.id)];
    case "price_desc":
      return [desc(minPrice), asc(products.id)];
  }
}

function cursorFor(sort: ProductSort, row: CardRow): Cursor {
  switch (sort) {
    case "newest":
      return { s: sort, c: row.createdAt, i: row.id };
    case "rating":
      return { s: sort, v: row.ratingAvg ?? 0, c: row.createdAt, i: row.id };
    case "price_asc":
    case "price_desc":
      return { s: sort, v: row.priceVnd, i: row.id };
  }
}

// --- helpers ---------------------------------------------------------------

/** All rows needed to build the category tree / descendant lookups. */
function allCategories(db: DB) {
  return db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.id)).all();
}

// ponytail: one fetch + BFS per listing call — the categories table is tiny;
// recursive CTE only if it ever grows.
export function categoryDescendants(db: DB, categoryId: string): string[] {
  const byParent = new Map<string | null, string[]>();
  for (const c of allCategories(db)) {
    const list = byParent.get(c.parentId) ?? [];
    list.push(c.id);
    byParent.set(c.parentId, list);
  }
  const out: string[] = [];
  const queue = [categoryId];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    queue.push(...(byParent.get(id) ?? []));
  }
  return out;
}

/** Escape LIKE metacharacters in user input. */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** LIKE pattern with user input escaped — matches name/description, en+vi. */
function textFilter(q: string): SQL {
  const pat = `%${escapeLike(q)}%`;
  // ulower: Unicode-aware fold registered in db/client (SQLite lower() is ASCII-only).
  return sql`(ulower(${products.nameEn}) like ${pat} escape '\\'
    or ulower(${products.nameVi}) like ${pat} escape '\\'
    or ulower(${products.descriptionEn}) like ${pat} escape '\\'
    or ulower(${products.descriptionVi}) like ${pat} escape '\\')`;
}

/** Rows → cards: attach the first product-level image per product. */
export function toCards(db: DB, rows: CardRow[]): ProductCard[] {
  if (!rows.length) return [];
  const imgs = db
    .select({
      productId: productImages.productId,
      url: productImages.url,
      alt: productImages.alt,
    })
    .from(productImages)
    .where(
      and(
        inArray(
          productImages.productId,
          rows.map((r) => r.id),
        ),
        sql`${productImages.variantId} is null`,
      ),
    )
    .orderBy(asc(productImages.sortOrder), asc(productImages.id))
    .all();
  const first = new Map<string, { url: string; alt: string }>();
  for (const img of imgs) {
    if (!first.has(img.productId)) first.set(img.productId, { url: img.url, alt: img.alt });
  }
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    nameEn: r.nameEn,
    nameVi: r.nameVi,
    priceVnd: r.priceVnd,
    ratingAvg: r.ratingAvg,
    ratingCount: r.ratingCount,
    inStock: r.available > 0,
    imageUrl: first.get(r.id)?.url ?? null,
    imageAlt: first.get(r.id)?.alt ?? "",
    shop: r.shop,
  }));
}

// --- public API ------------------------------------------------------------

export function listCategories(db: DB): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  const roots: CategoryNode[] = [];
  for (const c of allCategories(db)) {
    nodes.set(c.id, { ...c, children: [] });
  }
  for (const c of allCategories(db)) {
    const node = nodes.get(c.id)!;
    const parent = c.parentId ? nodes.get(c.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Flat category row by slug. NOT_FOUND on missing — categories have no status. */
export function getCategoryBySlug(
  db: DB,
  slug: string,
): { id: string; slug: string; nameEn: string; nameVi: string } {
  const row = db.select().from(categories).where(eq(categories.slug, slug)).get();
  if (!row) throw new AuthError("NOT_FOUND", 404, "category not found");
  return row;
}

export function listProducts(
  db: DB,
  opts: ListProductsOpts,
): { items: ProductCard[]; nextCursor: string | null } {
  const sort = opts.sort ?? "newest";
  const limit = opts.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new AuthError("INVALID_INPUT", 400, "limit must be an integer in 1..50");
  }

  const where: SQL[] = [opts.status ? eq(products.status, opts.status) : publicGate];
  const having: SQL[] = [];
  if (opts.categoryId) {
    where.push(inArray(products.categoryId, categoryDescendants(db, opts.categoryId)));
  }
  if (opts.shopId) where.push(eq(products.shopId, opts.shopId));
  if (opts.q) where.push(textFilter(opts.q));
  if (opts.minRating != null) where.push(gte(ratingAvg, opts.minRating));
  if (opts.minPriceVnd != null) having.push(gte(minPrice, opts.minPriceVnd));
  if (opts.maxPriceVnd != null) having.push(lte(minPrice, opts.maxPriceVnd));
  if (opts.inStock != null) {
    having.push(opts.inStock ? gt(availSql, 0) : lte(availSql, 0));
  }
  if (opts.cursor) {
    const p = afterPredicate(sort, decodeCursor(opts.cursor, sort));
    if (p.where) where.push(p.where);
    if (p.having) having.push(p.having);
  }

  // Inner join on variants: spec guarantees ≥1 variant per product, so a
  // variantless product is malformed and simply never lists.
  const rows = db
    .select(cardSelect)
    .from(products)
    .innerJoin(shops, and(eq(shops.id, products.shopId), eq(shops.status, "ACTIVE")))
    .innerJoin(productVariants, eq(productVariants.productId, products.id))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(and(...where))
    .groupBy(products.id, shops.id)
    .having(having.length ? and(...having) : undefined)
    .orderBy(...orderFor(sort))
    .limit(limit + 1)
    .all() as CardRow[];

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: toCards(db, page),
    nextCursor: rows.length > limit && last ? encodeCursor(cursorFor(sort, last)) : null,
  };
}

export function getProductBySlug(db: DB, slug: string): ProductDetail {
  const row = db
    .select({ product: products, shop: shops })
    .from(products)
    .innerJoin(shops, and(eq(shops.id, products.shopId), eq(shops.status, "ACTIVE")))
    .where(eq(products.slug, slug))
    .get();
  // Public callers never see DRAFT/ARCHIVED or moderated-hidden products — same
  // NOT_FOUND as missing (publicGate rule, applied post-fetch).
  if (
    !row ||
    row.product.status !== "ACTIVE" ||
    !["NONE", "APPROVED"].includes(row.product.moderationStatus)
  ) {
    throw new AuthError("NOT_FOUND", 404, "product not found");
  }

  const variantRows = db
    .select({ v: productVariants, inv: inventory })
    .from(productVariants)
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(eq(productVariants.productId, row.product.id))
    .orderBy(asc(productVariants.id))
    .all();

  const imgs = db
    .select({
      id: productImages.id,
      url: productImages.url,
      alt: productImages.alt,
      variantId: productImages.variantId,
    })
    .from(productImages)
    .where(eq(productImages.productId, row.product.id))
    .orderBy(asc(productImages.sortOrder), asc(productImages.id))
    .all();

  const agg = db
    .select({
      avg: sql<number | null>`avg(${reviews.rating})`.mapWith((v) =>
        v == null ? null : Number(v),
      ),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(reviews)
    .where(and(eq(reviews.productId, row.product.id), eq(reviews.status, "PUBLISHED")))
    .get()!;

  const attrs = db
    .select({ name: productAttributes.name, value: productAttributes.value })
    .from(productAttributes)
    .where(eq(productAttributes.productId, row.product.id))
    .orderBy(asc(productAttributes.sortOrder), asc(productAttributes.id))
    .all();

  const now = Date.now();
  const flash = db
    .select({ value: promotions.value, endsAt: promotions.endsAt })
    .from(promotions)
    .where(
      and(
        eq(promotions.scope, "FLASH"),
        // FLASH_PRICE only — a FLASH-scoped PERCENT promo stores bps, not VND.
        eq(promotions.kind, "FLASH_PRICE"),
        eq(promotions.productId, row.product.id),
        eq(promotions.status, "ACTIVE"),
        lte(promotions.startsAt, now),
        gt(promotions.endsAt, now),
      ),
    )
    .orderBy(asc(promotions.value))
    .limit(1)
    .get();

  const p = row.product;
  return {
    id: p.id,
    slug: p.slug,
    nameEn: p.nameEn,
    nameVi: p.nameVi,
    descriptionEn: p.descriptionEn,
    descriptionVi: p.descriptionVi,
    categoryId: p.categoryId,
    brandId: p.brandId,
    createdAt: p.createdAt,
    shop: {
      id: row.shop.id,
      slug: row.shop.slug,
      name: row.shop.name,
      description: row.shop.description,
    },
    variants: variantRows.map(({ v, inv }) => ({
      id: v.id,
      sku: v.sku,
      nameEn: v.nameEn,
      nameVi: v.nameVi,
      attrs: parseAttrs(v.attributesJson),
      priceVnd: v.salePriceVnd ?? v.basePriceVnd,
      salePriceVnd: v.salePriceVnd,
      available: Math.max(0, (inv?.onHand ?? 0) - (inv?.reserved ?? 0)),
    })),
    images: imgs,
    rating: { avg: agg.avg, count: agg.count },
    attributes: attrs,
    flashSale: flash ? { priceVnd: flash.value, endsAt: flash.endsAt } : null,
  };
}

function parseAttrs(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Public shop card. Suspended shops are NOT_FOUND, like missing. */
export function getShopBySlug(db: DB, slug: string): ShopCard {
  const row = db
    .select({
      id: shops.id,
      slug: shops.slug,
      name: shops.name,
      description: shops.description,
      productCount: sql<number>`count(${products.id})`.mapWith(Number),
    })
    .from(shops)
    .leftJoin(products, and(eq(products.shopId, shops.id), publicGate))
    .where(and(eq(shops.slug, slug), eq(shops.status, "ACTIVE")))
    .groupBy(shops.id)
    .get();
  if (!row) throw new AuthError("NOT_FOUND", 404, "shop not found");
  return row;
}

/** Products of a shop for public listing — thin wrapper over listProducts. */
export function listShopProducts(
  db: DB,
  shopId: string,
  opts: Omit<ListProductsOpts, "shopId"> = {},
) {
  return listProducts(db, { ...opts, shopId });
}

/** Cards for known ACTIVE ids, preserving the caller's ordering. */
export function cardsForIds(db: DB, ids: string[]): ProductCard[] {
  if (!ids.length) return [];
  const rows = db
    .select(cardSelect)
    .from(products)
    .innerJoin(shops, and(eq(shops.id, products.shopId), eq(shops.status, "ACTIVE")))
    .innerJoin(productVariants, eq(productVariants.productId, products.id))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(and(inArray(products.id, ids), publicGate))
    .groupBy(products.id, shops.id)
    .all() as CardRow[];
  const byId = new Map(toCards(db, rows).map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter((c): c is ProductCard => !!c);
}

export function getHomepageData(db: DB): HomepageData {
  const now = Date.now();

  const flashRows = db
    .select({
      productId: products.id,
      flashPriceVnd: sql<number>`min(${promotions.value})`.mapWith(Number),
      // Earliest expiry among the product's active FLASH_PRICE promos.
      flashEndsAt: sql<number>`min(${promotions.endsAt})`.mapWith(Number),
    })
    .from(promotions)
    .innerJoin(products, eq(products.id, promotions.productId))
    .where(
      and(
        eq(promotions.scope, "FLASH"),
        eq(promotions.kind, "FLASH_PRICE"),
        eq(promotions.status, "ACTIVE"),
        lte(promotions.startsAt, now),
        gt(promotions.endsAt, now),
        publicGate,
      ),
    )
    .groupBy(products.id)
    .orderBy(asc(products.id))
    .limit(8)
    .all();
  const flashCards = new Map(
    cardsForIds(
      db,
      flashRows.map((r) => r.productId),
    ).map((c) => [c.id, c]),
  );

  const featuredShops = db
    .select({
      id: shops.id,
      slug: shops.slug,
      name: shops.name,
      description: shops.description,
      productCount: sql<number>`count(${products.id})`.mapWith(Number),
    })
    .from(shops)
    .leftJoin(products, and(eq(products.shopId, shops.id), publicGate))
    .where(eq(shops.status, "ACTIVE"))
    .groupBy(shops.id)
    .orderBy(desc(sql`count(${products.id})`), asc(shops.name))
    .limit(6)
    .all();

  const trendingIds = db
    .select({
      id: orderItems.productId,
      ordered: sql<number>`count(*)`.mapWith(Number),
    })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(publicGate)
    .groupBy(orderItems.productId)
    .orderBy(desc(sql`count(*)`), asc(orderItems.productId))
    .limit(8)
    .all();

  return {
    categories: listCategories(db),
    flashSale: flashRows
      .map((r) => ({ ...r, card: flashCards.get(r.productId) }))
      .filter((r): r is HomepageData["flashSale"][number] => !!r.card),
    featuredShops,
    trending: cardsForIds(
      db,
      trendingIds.map((r) => r.id),
    ),
    newest: listProducts(db, { sort: "newest", limit: 8 }),
  };
}

// --- reviews ---------------------------------------------------------------

export type ReviewView = {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string;
  createdAt: number;
};

// Same cursor convention as listProducts: base64url {c: createdAt, i: id},
// ordered newest-first.
type ReviewCursor = { c: number; i: string };

function decodeReviewCursor(raw: string): ReviewCursor {
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof c?.c === "number" && typeof c?.i === "string" && c.i) return c;
  } catch {}
  throw new AuthError("INVALID_INPUT", 400, "malformed cursor");
}

/** PUBLISHED reviews for a product, newest first, keyset-paginated. */
export function listProductReviews(
  db: DB,
  productId: string,
  opts: { cursor?: string; limit?: number } = {},
): { items: ReviewView[]; nextCursor: string | null } {
  const limit = opts.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new AuthError("INVALID_INPUT", 400, "limit must be an integer in 1..50");
  }
  const where: SQL[] = [eq(reviews.productId, productId), eq(reviews.status, "PUBLISHED")];
  if (opts.cursor) {
    const c = decodeReviewCursor(opts.cursor);
    const pred = or(
      lt(reviews.createdAt, c.c),
      and(eq(reviews.createdAt, c.c), lt(reviews.id, c.i)),
    );
    if (pred) where.push(pred);
  }
  const rows = db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      authorName: users.name,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.userId))
    .where(and(...where))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(limit + 1)
    .all();
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor:
      rows.length > limit && last ? encodeCursor({ c: last.createdAt, i: last.id }) : null,
  };
}
