import { z } from "zod";

export const WishlistToggleInput = z.object({
  productId: z.string().min(1),
});

/** Guest wishlist snapshot merged at login — product ids only. */
export const WishlistMergeInput = z.object({
  productIds: z.array(z.string().min(1)).max(500),
});
