import { z } from "zod";

// Same convention as cart/search contracts: a bare `param=` is an empty string
// — absent, never a real value (z.coerce would turn "" into 0).
const opt = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    schema.optional(),
  );

const name = z.string().trim().min(1).max(200);
const sku = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[\w-]+$/, "SKU may only contain letters, digits, _ and -");

export const VariantInput = z
  .object({
    id: opt(z.string().min(1)),
    sku,
    nameEn: name,
    nameVi: name,
    attrs: z.record(z.string(), z.unknown()).default({}),
    basePriceVnd: z.coerce.number().int().min(0),
    // Sale price must not exceed the base price; an empty field clears it.
    salePriceVnd: opt(z.coerce.number().int().min(0)),
    // Desired on-hand. With `baseline` (the value the form loaded), the service
    // writes the delta — concurrent order/reservation changes survive a save.
    // Without a baseline it's an absolute set.
    stock: opt(z.coerce.number().int().min(0)),
    baseline: opt(z.coerce.number().int().min(0)),
  })
  .refine((v) => v.salePriceVnd == null || v.salePriceVnd <= v.basePriceVnd, {
    message: "salePriceVnd must not exceed basePriceVnd",
  });

/** Seller product fields. `shopId` selects which of the actor's shops owns it. */
export const ProductInput = z.object({
  shopId: z.string().min(1),
  nameEn: name,
  nameVi: name,
  categoryId: z.string().min(1),
  brandId: opt(z.string().min(1)),
  descriptionEn: z.string().trim().max(5000).default(""),
  descriptionVi: z.string().trim().max(5000).default(""),
  // Sellers toggle DRAFT↔ACTIVE directly; ARCHIVED only via SetProductStatus.
  status: z.enum(["DRAFT", "ACTIVE"]).default("DRAFT"),
});

/** Full save payload: `id` set = update, plus the variant repeater rows. */
export const ProductSaveInput = ProductInput.extend({
  id: opt(z.string().min(1)),
  variants: z.array(VariantInput).max(100).default([]),
});

export const SetProductStatusInput = z.object({
  productId: z.string().min(1),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
});

export const SetVariantStockInput = z.object({
  variantId: z.string().min(1),
  onHand: z.coerce.number().int().min(0),
  reason: z.string().trim().min(1).max(200).default("seller-adjust"),
});

/** Seller "submit for review" action. */
export const SubmitForReviewInput = z.object({
  productId: z.string().min(1),
});

/** Admin moderation decision; note is required on reject/suspend (service enforces). */
export const ModerateProductInput = z.object({
  productId: z.string().min(1),
  action: z.enum(["approve", "reject", "suspend"]),
  note: opt(z.string().trim().max(1000)),
});

export const CategoryInput = z.object({
  parentId: opt(z.string().min(1)),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "slug may only contain lowercase letters, digits and -"),
  nameEn: name,
  nameVi: name,
  sortOrder: z.coerce.number().int().default(0),
});
// Slug is immutable once created — public URLs are built from it.
export const UpdateCategoryInput = z.object({
  id: z.string().min(1),
  parentId: opt(z.string().min(1)),
  nameEn: name,
  nameVi: name,
  sortOrder: z.coerce.number().int().default(0),
});
export const DeleteCategoryInput = z.object({ id: z.string().min(1) });
