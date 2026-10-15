import { z } from "zod";

export const ReviewCreateInput = z.object({
  orderItemId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(200).optional(),
  body: z.string().trim().max(5000).optional(),
  images: z.array(z.string().url()).max(10).default([]),
});
export type ReviewCreateInputType = z.infer<typeof ReviewCreateInput>;

/**
 * PATCH body: author fields (rating/title/body) for `updateReview`, or
 * {action:"HIDE"|"UNHIDE", note?} for admin `moderateReview`.
 */
export const ReviewPatchInput = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  title: z.string().trim().max(200).nullish(),
  body: z.string().trim().max(5000).nullish(),
  action: z.enum(["HIDE", "UNHIDE"]).optional(),
  note: z.string().trim().max(500).optional(),
});
export type ReviewPatchInputType = z.infer<typeof ReviewPatchInput>;
