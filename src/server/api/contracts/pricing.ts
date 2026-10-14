import { z } from "zod";

/** Shared by checkout input and any quote endpoint: what priceOrder consumes. */
export const PriceQuoteInput = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        qty: z.coerce.number().int().min(1).max(999),
      }),
    )
    .min(1)
    .max(200),
  voucherCodes: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  shippingByShop: z.record(
    z.string().min(1),
    z.object({
      method: z.string().min(1),
      feeVnd: z.coerce.number().int().min(0),
    }),
  ),
});
