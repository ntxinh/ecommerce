import { z } from "zod";

export const RequestReturnInput = z.object({
  sellerOrderId: z.string().min(1),
  items: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        qty: z.number().int().min(1),
        restock: z.boolean().default(false),
      }),
    )
    .min(1),
  reason: z.string().trim().min(3).max(500),
  evidence: z.array(z.string().url()).max(5).default([]),
});
export type RequestReturnInputType = z.infer<typeof RequestReturnInput>;
