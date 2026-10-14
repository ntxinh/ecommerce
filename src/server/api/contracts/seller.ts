import { z } from "zod";

export const ApplyInput = z.object({
  shopName: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(""),
  businessInfo: z.record(z.string(), z.string()).default({}),
});

/** Admin decision on a seller application. */
export const DecideInput = z.object({
  applicationId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]),
  note: z.string().trim().max(500).optional(),
});

/** Admin shop suspension gate. */
export const ShopStatusInput = z.object({
  shopId: z.string().min(1),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});

/** Seller shop profile edit; absent keys leave the column untouched. */
export const ShopProfileInput = z.object({
  shopId: z.string().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
});
