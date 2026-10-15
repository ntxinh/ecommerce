"use server";

import { ReviewCreateInput, ReviewPatchInput } from "@/server/api/contracts/reviews";
import { AuthError } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { createReview, deleteReview, updateReview } from "@/server/modules/reviews/service";

export type ReviewActionResult = { ok: true; id?: string } | { ok: false; error: string };

function toResult(e: unknown): ReviewActionResult {
  if (e instanceof AuthError) return { ok: false, error: e.code };
  throw e;
}

/** Buyer reviews a purchased order item; `images` travels as comma-separated URLs. */
export async function createReviewAction(formData: FormData): Promise<ReviewActionResult> {
  try {
    const images = String(formData.get("images") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const parsed = ReviewCreateInput.safeParse({
      orderItemId: String(formData.get("orderItemId") ?? ""),
      rating: Number(formData.get("rating")),
      title: String(formData.get("title") ?? "") || undefined,
      body: String(formData.get("body") ?? "") || undefined,
      images,
    });
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    if (!actor) return { ok: false, error: "UNAUTHORIZED" };
    const id = createReview(getDb(), actor, parsed.data);
    return { ok: true, id };
  } catch (e) {
    return toResult(e);
  }
}

/** Author edits rating/title/body on their own review. */
export async function updateReviewAction(formData: FormData): Promise<ReviewActionResult> {
  try {
    const parsed = ReviewPatchInput.safeParse({
      rating: Number(formData.get("rating")),
      title: String(formData.get("title") ?? ""),
      body: String(formData.get("body") ?? ""),
    });
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    if (!actor) return { ok: false, error: "UNAUTHORIZED" };
    const id = String(formData.get("reviewId") ?? "");
    if (!id) return { ok: false, error: "INVALID_INPUT" };
    updateReview(getDb(), actor, id, {
      rating: parsed.data.rating,
      title: parsed.data.title,
      body: parsed.data.body,
    });
    return { ok: true, id };
  } catch (e) {
    return toResult(e);
  }
}

/** Author (or admin) deletes a review; the order item becomes reviewable again. */
export async function deleteReviewAction(formData: FormData): Promise<ReviewActionResult> {
  try {
    const actor = await getActor();
    if (!actor) return { ok: false, error: "UNAUTHORIZED" };
    const id = String(formData.get("reviewId") ?? "");
    if (!id) return { ok: false, error: "INVALID_INPUT" };
    deleteReview(getDb(), actor, id);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}
