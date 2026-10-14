import { z } from "zod";

// Query params arrive as strings; coerce numerics. inStock is an explicit
// "true"/"false" enum — empty/absent means no stock filter (coerce.boolean
// would turn "" into false and silently filter).
export const SearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  mode: z.enum(["search", "suggest"]).default("search"),
  sort: z
    .enum(["relevance", "price_asc", "price_desc", "rating", "newest", "popular"])
    .default("relevance"),
  categoryId: z.string().min(1).optional(),
  shopId: z.string().min(1).optional(),
  minPriceVnd: z.coerce.number().int().min(0).optional(),
  maxPriceVnd: z.coerce.number().int().min(0).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  inStock: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
