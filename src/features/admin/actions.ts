"use server";

import { z } from "zod";
import {
  CategoryInput,
  DeleteCategoryInput,
  ModerateProductInput,
  UpdateCategoryInput,
} from "@/server/api/contracts/catalog";
import { ReviewPatchInput } from "@/server/api/contracts/reviews";
import { DecideInput, ShopStatusInput } from "@/server/api/contracts/seller";
import { AuthError } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { createPlatformVoucher, setSetting } from "@/server/modules/admin/ops";
import { revokeUserSessions, setUserStatus } from "@/server/modules/admin/service";
import {
  createCategory,
  deleteCategory,
  moderateProduct,
  updateCategory,
} from "@/server/modules/catalog/moderation";
import { moderateReview } from "@/server/modules/reviews/service";
import { decideApplication, setShopStatus } from "@/server/modules/sellers/service";

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

/** Admin decision on a seller application (approve provisions the shop). */
export async function decideApplicationAction(formData: FormData): Promise<AdminActionResult> {
  try {
    const parsed = DecideInput.safeParse({
      applicationId: formData.get("applicationId"),
      decision: formData.get("decision"),
      note: String(formData.get("note") ?? "") || undefined,
    });
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const { applicationId, decision, note } = parsed.data;
    const actor = await getActor();
    decideApplication(getDb(), actor, applicationId, { decision, note });
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Admin suspend/reactivate for a shop (from an approved application's row). */
export async function setShopStatusAction(formData: FormData): Promise<AdminActionResult> {
  try {
    const parsed = ShopStatusInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    setShopStatus(getDb(), actor, parsed.data.shopId, parsed.data.status);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

const UserStatusInput = z.object({
  userId: z.string().min(1),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});

/** Admin suspend/reactivate for a user; suspend revokes all sessions. */
export async function setUserStatusAction(formData: FormData): Promise<AdminActionResult> {
  try {
    const parsed = UserStatusInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    setUserStatus(getDb(), actor, parsed.data.userId, parsed.data.status);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Admin force sign-out: revoke every session for a user. */
export async function revokeUserSessionsAction(formData: FormData): Promise<AdminActionResult> {
  try {
    const userId = String(formData.get("userId") ?? "");
    if (!userId) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    revokeUserSessions(getDb(), actor, userId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

const SettingInput = z.object({ key: z.string().min(1), value: z.string() });

/** Save one whitelisted setting; `value` arrives as a JSON string from the form. */
export async function setSettingAction(formData: FormData): Promise<AdminActionResult> {
  try {
    const parsed = SettingInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    let value: unknown;
    try {
      value = JSON.parse(parsed.data.value);
    } catch {
      return { ok: false, error: "INVALID_INPUT" };
    }
    const actor = await getActor();
    setSetting(getDb(), actor, parsed.data.key, value);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

// Empty optional fields arrive as ""; coerce to undefined before validating.
const optInt = (schema: z.ZodType<number>) =>
  z.preprocess((v) => (v === "" || v == null ? undefined : v), schema.optional());
const epochMs = z.preprocess((v) => new Date(String(v)).getTime(), z.number().int().positive());

const PlatformVoucherForm = z.object({
  code: z.string().min(1).max(64),
  kind: z.enum(["PERCENT", "FIXED", "SHIPPING"]),
  value: z.coerce.number().int().positive(),
  minSpendVnd: optInt(z.number().int().min(0)),
  maxDiscountVnd: optInt(z.number().int().positive()),
  startsAt: epochMs,
  endsAt: epochMs,
  totalLimit: optInt(z.number().int().positive()),
  perUserLimit: optInt(z.number().int().positive()),
});

/** Create a PLATFORM voucher from the admin form. */
export async function createPlatformVoucherAction(formData: FormData): Promise<AdminActionResult> {
  try {
    const parsed = PlatformVoucherForm.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    createPlatformVoucher(getDb(), actor, parsed.data);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}
