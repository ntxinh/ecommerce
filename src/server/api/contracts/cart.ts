import { z } from "zod";

// Empty/whitespace strings would coerce to 0 (silently deleting the line on
// update) — treat them as missing.
const qty = (min: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().int().min(min).max(999),
  );

// qty is coerced so the same contract accepts FormData strings (server actions)
// and JSON numbers (route handlers).
export const CartAddInput = z.object({
  variantId: z.string().min(1),
  qty: qty(1),
});

// qty 0 removes the line — one contract covers set + delete.
export const CartUpdateInput = z.object({
  cartItemId: z.string().min(1),
  qty: qty(0),
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
