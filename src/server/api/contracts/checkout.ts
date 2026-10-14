import { z } from "zod";

// Payment methods wired to a provider adapter today.
export const CheckoutInput = z.object({
  cartItemIds: z.array(z.string().min(1)).min(1).max(200),
  addressId: z.string().min(1),
  // shopId → method name; fee is priced server-side from settings.
  shippingByShop: z.record(z.string().min(1), z.string().min(1)).default({}),
  voucherCodes: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  paymentMethod: z.enum(["COD", "MOCK_WALLET", "MOCK_BANK"]),
  // Optional in body — the Idempotency-Key header is authoritative.
  idempotencyKey: z.string().min(8).max(128).optional(),
  simulate: z.enum(["success", "failure"]).optional(),
});

export type CheckoutInputType = z.infer<typeof CheckoutInput>;
