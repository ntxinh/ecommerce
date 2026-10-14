"use server";

import {
  CategoryInput,
  DeleteCategoryInput,
  ModerateProductInput,
  UpdateCategoryInput,
} from "@/server/api/contracts/catalog";
import { ReviewPatchInput } from "@/server/api/contracts/reviews";
import { AuthError } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import {
  createCategory,
  deleteCategory,
  moderateProduct,
  updateCategory,
} from "@/server/modules/catalog/moderation";
import { moderateReview } from "@/server/modules/reviews/service";

export type AdminActionResult = { ok: true } | { ok: false; error: string };

function toResult(e: unknown): AdminActionResult {
  if (e instanceof AuthError) return { ok: false, error: e.code };
  throw e;
}

/** Approve / reject / suspend a queued product; note required on reject+suspend. */
export async function moderateProductAction(formData: FormData): Promise<AdminActionResult> {
  try {
    const parsed = ModerateProductInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    moderateProduct(getDb(), actor, parsed.data);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Admin HIDE/UNHIDE on a review; optional note lands in the audit row. */
export async function moderateReviewAction(formData: FormData): Promise<AdminActionResult> {
  try {
    const parsed = ReviewPatchInput.safeParse({
      action: String(formData.get("action") ?? ""),
      note: String(formData.get("note") ?? "") || undefined,
    });
    if (!parsed.success || !parsed.data.action) return { ok: false, error: "INVALID_INPUT" };
    const reviewId = String(formData.get("reviewId") ?? "");
    if (!reviewId) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    moderateReview(getDb(), actor, reviewId, parsed.data.action, parsed.data.note);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function createCategoryAction(formData: FormData): Promise<AdminActionResult> {
  try {
    const parsed = CategoryInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    createCategory(getDb(), actor, parsed.data);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function updateCategoryAction(formData: FormData): Promise<AdminActionResult> {
  try {
    const parsed = UpdateCategoryInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    updateCategory(getDb(), actor, parsed.data);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function deleteCategoryAction(formData: FormData): Promise<AdminActionResult> {
  try {
    const parsed = DeleteCategoryInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    deleteCategory(getDb(), actor, parsed.data.id);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}
