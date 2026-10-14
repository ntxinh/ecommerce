import { z } from "zod";

// Query params arrive as strings; a bare `param=` is an empty string — absent,
// never 0/false (z.coerce would turn "" into 0). Same convention as cart's qty.
const opt = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    schema.optional(),
  );

/** Fields every search request needs — suggest mode validates only this. */
export const SearchBase = z.object({
  q: z.string().trim().min(1).max(200),
  mode: z.enum(["search", "suggest"]).default("search"),
});

// inStock is an explicit "true"/"false" enum — coerce.boolean would read "" as
// a real filter, and a missing param must mean "no stock filter".
export const SearchQuery = SearchBase.extend({
  sort: z
    .enum(["relevance", "price_asc", "price_desc", "rating", "newest", "popular"])
    .default("relevance"),
  categoryId: opt(z.string().min(1)),
  shopId: opt(z.string().min(1)),
  minPriceVnd: opt(z.coerce.number().int().min(0)),
  maxPriceVnd: opt(z.coerce.number().int().min(0)),
  minRating: opt(z.coerce.number().min(0).max(5)),
  inStock: opt(z.enum(["true", "false"]).transform((v) => v === "true")),
  cursor: opt(z.string()),
  limit: opt(z.coerce.number().int().min(1).max(50)),
});
