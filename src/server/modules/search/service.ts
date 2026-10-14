import "server-only";

import { and, asc, desc, eq, gt, gte, inArray, lt, lte, or, type SQL, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import type { DB } from "@/server/db/client";
import {
  brands,
  inventory,
  orderItems,
  products,
  productVariants,
  searchHistory,
  shops,
} from "@/server/db/schema";
import {
  availSql,
  type CardRow,
  cardSelect,
  categoryDescendants,
  encodeCursor,
  escapeLike,
  minPrice,
  type ProductCard,
  publicGate,
  ratingAvg,
  toCards,
} from "@/server/modules/catalog/service";

export type SearchSort = "relevance" | "price_asc" | "price_desc" | "rating" | "newest" | "popular";

export type SearchParams = {
  q: string;
  categoryId?: string;
  shopId?: string;
  minPriceVnd?: number;
  maxPriceVnd?: number;
  minRating?: number;
  inStock?: boolean;
  sort?: SearchSort;
  cursor?: string;
  /** 1..50, default 20. */
  limit?: number;
};

// --- cursors ---------------------------------------------------------------

// Same format as catalog's: base64url JSON of the sort-key tuple for the last
// row. Keys: r relevance rank, v numeric key (price/sold/rating), c createdAt.
type Cursor = { s: SearchSort; r?: number; v?: number; c?: number; i: string };

function decodeCursor(raw: string, sort: SearchSort): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
    const ok =
      c.s === sort &&
      typeof c.i === "string" &&
      c.i.length > 0 &&
      (sort === "relevance"
        ? num(c.r) && num(c.c)
        : sort === "newest"
          ? num(c.c)
          : sort === "rating" || sort === "popular"
            ? num(c.v) && num(c.c)
            : num(c.v));
    if (!ok) throw new Error("bad cursor");
    return c;
  } catch {
    throw new AuthError("INVALID_INPUT", 400, "invalid cursor");
  }
}

// --- match expressions -----------------------------------------------------

// Relevance heuristic (SQLite LIKE tier): case-insensitive substring match via
// ulower() (registered in db/client.ts — SQLite lower() is ASCII-only);
// tier = name en/vi (0) > brand name or variant sku (1) > description
// en/vi (2). Ties fall to newest. Documented upgrade path: Postgres FTS
// (tsvector + ts_rank per-field weights) — see docs/database/
// sqlite-postgresql-portability.md.
type Match = { name: SQL; tier2: SQL; desc: SQL; hit: SQL; rank: SQL };

function match(q: string): Match {
  const pat = `%${escapeLike(q.toLowerCase())}%`;
  const name = or(
    sql`ulower(${products.nameEn}) like ${pat} escape '\\'`,
    sql`ulower(${products.nameVi}) like ${pat} escape '\\'`,
  )!;
  const brand = sql`ulower(${brands.name}) like ${pat} escape '\\'`;
  const sku = sql`exists (
    select 1 from ${productVariants} pv
    where pv.product_id = ${products.id}
      and ulower(pv.sku) like ${pat} escape '\\')`;
  const tier2 = or(brand, sku)!;
  const descM = or(
    sql`ulower(${products.descriptionEn}) like ${pat} escape '\\'`,
    sql`ulower(${products.descriptionVi}) like ${pat} escape '\\'`,
  )!;
  const rank = sql<number>`case when ${name} then 0 when ${tier2} then 1 else 2 end`;
  return { name, tier2, desc: descM, hit: or(name, tier2, descM)!, rank };
}

/** Units ordered across all order_items — the "popular" signal (same as trending). */
const soldCount = sql<number>`coalesce((
  select sum(oi.qty) from ${orderItems} oi
  where oi.product_id = ${products.id}), 0)`;

type Row = CardRow & { rank: number; sold: number };

// (key op, tie → next key …, id > lastId), same convention as catalog.
function afterPredicate(sort: SearchSort, c: Cursor, m: Match): { where?: SQL; having?: SQL } {
  const idGt = gt(products.id, c.i);
  const newerTail = or(lt(products.createdAt, c.c!), and(eq(products.createdAt, c.c!), idGt));
  switch (sort) {
    case "relevance":
      return { where: or(gt(m.rank, c.r!), and(eq(m.rank, c.r!), newerTail)) };
    case "newest":
      return { where: newerTail };
    case "rating": {
      const key = sql`coalesce(${ratingAvg}, 0)`;
      return { where: or(lt(key, c.v!), and(eq(key, c.v!), newerTail)) };
    }
    case "popular":
      return { where: or(lt(soldCount, c.v!), and(eq(soldCount, c.v!), newerTail)) };
    case "price_asc":
      return { having: or(gt(minPrice, c.v!), and(eq(minPrice, c.v!), idGt)) };
    case "price_desc":
      return { having: or(lt(minPrice, c.v!), and(eq(minPrice, c.v!), idGt)) };
  }
}

function orderFor(sort: SearchSort, m: Match): SQL[] {
  switch (sort) {
    case "relevance":
      return [asc(m.rank), desc(products.createdAt), asc(products.id)];
    case "newest":
      return [desc(products.createdAt), asc(products.id)];
    case "popular":
      return [desc(soldCount), desc(products.createdAt), asc(products.id)];
    case "rating":
      return [desc(sql`coalesce(${ratingAvg}, 0)`), desc(products.createdAt), asc(products.id)];
    case "price_asc":
      return [asc(minPrice), asc(products.id)];
    case "price_desc":
      return [desc(minPrice), asc(products.id)];
  }
}

function cursorFor(sort: SearchSort, row: Row): Cursor {
  switch (sort) {
    case "relevance":
      return { s: sort, r: row.rank, c: row.createdAt, i: row.id };
    case "newest":
      return { s: sort, c: row.createdAt, i: row.id };
    case "rating":
      return { s: sort, v: row.ratingAvg ?? 0, c: row.createdAt, i: row.id };
    case "popular":
      return { s: sort, v: row.sold, c: row.createdAt, i: row.id };
    case "price_asc":
    case "price_desc":
      return { s: sort, v: row.priceVnd, i: row.id };
  }
}

// --- public API ------------------------------------------------------------

/**
 * Public product search: ACTIVE only, `q` matched across name/sku/brand/
 * description with the documented relevance heuristic. Filters compose with
 * the same semantics as catalog's listProducts.
 */
export function search(
  db: DB,
  params: SearchParams,
): { items: ProductCard[]; total: number; nextCursor: string | null } {
  const q = params.q.trim();
  if (!q) throw new AuthError("INVALID_INPUT", 400, "q must be non-empty");
  const sort = params.sort ?? "relevance";
  const limit = params.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new AuthError("INVALID_INPUT", 400, "limit must be an integer in 1..50");
  }
  const m = match(q);

  const where: SQL[] = [publicGate, m.hit];
  const having: SQL[] = [];
  if (params.categoryId) {
    where.push(inArray(products.categoryId, categoryDescendants(db, params.categoryId)));
  }
  if (params.shopId) where.push(eq(products.shopId, params.shopId));
  if (params.minRating != null) where.push(gte(ratingAvg, params.minRating));
  if (params.minPriceVnd != null) having.push(gte(minPrice, params.minPriceVnd));
  if (params.maxPriceVnd != null) having.push(lte(minPrice, params.maxPriceVnd));
  if (params.inStock != null) {
    having.push(params.inStock ? gt(availSql, 0) : lte(availSql, 0));
  }
  // total counts the full match set — cursor predicates apply to the page
  // only, never to the count.
  const countWhere = and(...where);
  const countHaving = having.length ? and(...having) : undefined;
  if (params.cursor) {
    const p = afterPredicate(sort, decodeCursor(params.cursor, sort), m);
    if (p.where) where.push(p.where);
    if (p.having) having.push(p.having);
  }
  const whereSql = and(...where);
  const havingSql = having.length ? and(...having) : undefined;

  // Inner join on variants mirrors listProducts: a variantless product is
  // malformed and never lists. brands is a left join (brandId nullable).
  // ponytail: total = grouped-id count — one extra scan of the same
  // predicates; a COUNT(*) subquery form is equivalent once size justifies it.
  const total = db
    .select({ id: products.id })
    .from(products)
    .innerJoin(shops, and(eq(shops.id, products.shopId), eq(shops.status, "ACTIVE")))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(productVariants, eq(productVariants.productId, products.id))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(countWhere)
    .groupBy(products.id, shops.id)
    .having(countHaving)
    .all().length;

  const rows = db
    .select({
      ...cardSelect,
      rank: m.rank.mapWith(Number),
      sold: soldCount.mapWith(Number),
    })
    .from(products)
    .innerJoin(shops, and(eq(shops.id, products.shopId), eq(shops.status, "ACTIVE")))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(productVariants, eq(productVariants.productId, products.id))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(whereSql)
    .groupBy(products.id, shops.id)
    .having(havingSql)
    .orderBy(...orderFor(sort, m))
    .limit(limit + 1)
    .all() as Row[];

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: toCards(db, page),
    total,
    nextCursor: rows.length > limit && last ? encodeCursor(cursorFor(sort, last)) : null,
  };
}

/**
 * Autocomplete: display names of ACTIVE products whose en/vi name starts with
 * `q` (case-insensitive). English name wins when both match.
 */
export function suggest(db: DB, q: string, limit = 8): string[] {
  const query = q.trim().toLowerCase();
  if (!query) throw new AuthError("INVALID_INPUT", 400, "q must be non-empty");
  const pat = `${escapeLike(query)}%`;
  const rows = db
    .select({ nameEn: products.nameEn, nameVi: products.nameVi })
    .from(products)
    .innerJoin(shops, and(eq(shops.id, products.shopId), eq(shops.status, "ACTIVE")))
    .where(
      and(
        publicGate,
        or(
          sql`ulower(${products.nameEn}) like ${pat} escape '\\'`,
          sql`ulower(${products.nameVi}) like ${pat} escape '\\'`,
        ),
      ),
    )
    .orderBy(asc(products.nameEn), asc(products.id))
    .limit(limit)
    .all();
  return rows.map((r) => (r.nameEn.toLowerCase().startsWith(query) ? r.nameEn : r.nameVi));
}

/** Writes one search_history row; routes call only for authenticated users. */
export function recordSearch(db: DB, userId: string, q: string) {
  db.insert(searchHistory)
    .values({ id: `sh_${ulid()}`, userId, query: q.trim(), createdAt: Date.now() })
    .run();
}
