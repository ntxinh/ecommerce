import { z } from "zod";

// qty is coerced so the same contract accepts FormData strings (server actions)
// and JSON numbers (route handlers).
export const CartAddInput = z.object({
  variantId: z.string().min(1),
  qty: z.coerce.number().int().min(1).max(999),
});

// qty 0 removes the line — one contract covers set + delete.
export const CartUpdateInput = z.object({
  cartItemId: z.string().min(1),
  qty: z.coerce.number().int().min(0).max(999),
});

export const CartRemoveInput = z.object({
  cartItemId: z.string().min(1),
});

export const CartMergeInput = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        qty: z.number().int().min(1).max(999),
      }),
    )
    .max(200),
});
