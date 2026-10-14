import { z } from "zod";
import { AuthError, toErrorResponse } from "@/server/api/errors";
import { getDb } from "@/server/db/client";
import { cardsForIds, listProducts } from "@/server/modules/catalog/service";

// Same ""-means-absent convention as the search contract (z.coerce would turn
// "" into 0). Kept local — the catalog contract file belongs to the seller task.
const opt = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    schema.optional(),
  );

const ProductsQuery = z.object({
  // ids mode: comma-separated product ids, order preserved (recently-viewed).
  ids: opt(z.string().max(2000)),
  categoryId: opt(z.string().min(1)),
  shopId: opt(z.string().min(1)),
  q: opt(z.string().trim().max(200)),
  minPriceVnd: opt(z.coerce.number().int().min(0)),
  maxPriceVnd: opt(z.coerce.number().int().min(0)),
  minRating: opt(z.coerce.number().min(0).max(5)),
  inStock: opt(z.enum(["true", "false"]).transform((v) => v === "true")),
  sort: z.enum(["newest", "price_asc", "price_desc", "rating"]).default("newest"),
  cursor: opt(z.string()),
  limit: opt(z.coerce.number().int().min(1).max(50)),
});

/**
 * GET /api/v1/products — public ACTIVE-product card listings.
 * `?ids=a,b,c` → cards for exactly those ids (caller order); otherwise the
 * list params mirror listProducts for client-side "load more" pagination.
 */
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const raw = Object.fromEntries(sp);
    const parsed = ProductsQuery.safeParse(raw);
    if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
    const { ids: _ids, ...params } = parsed.data;
    const db = getDb();
    // ids presence (not non-empty value) selects the mode: `?ids=` → empty list.
    if (sp.has("ids")) {
      const list = (raw.ids ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 50);
      return Response.json({ data: { items: cardsForIds(db, list), nextCursor: null } });
    }
    return Response.json({ data: listProducts(db, params) });
  } catch (e) {
    return toErrorResponse(e);
  }
}
