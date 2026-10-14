"use server";

import {
  ProductSaveInput,
  SetProductStatusInput,
  SubmitForReviewInput,
} from "@/server/api/contracts/catalog";
import { AuthError } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import {
  createProduct,
  duplicateProduct,
  setProductStatus,
  updateProduct,
} from "@/server/modules/catalog/manage";
import { submitForReview } from "@/server/modules/catalog/moderation";

export type SellerActionResult = { ok: true; productId?: string } | { ok: false; error: string };
export type SellerActionState = SellerActionResult | null;

function toResult(e: unknown): SellerActionResult {
  if (e instanceof AuthError) return { ok: false, error: e.code };
  throw e;
}

/**
 * Create or update a product plus its variants. `variants` arrives as a JSON
 * string (the form serializes the repeater); `id` set = update.
 */
export async function saveProductAction(
  _prev: SellerActionState,
  formData: FormData,
): Promise<SellerActionResult> {
  try {
    const actor = await getActor();
    if (!actor) return { ok: false, error: "UNAUTHORIZED" };
    let variants: unknown = [];
    let attributes: unknown;
    for (const [key, ref] of [
      ["variants", (v: unknown) => (variants = v)],
      ["attributes", (v: unknown) => (attributes = v)],
    ] as const) {
      const raw = formData.get(key);
      if (typeof raw === "string" && raw !== "") {
        try {
          ref(JSON.parse(raw));
        } catch {
          return { ok: false, error: "INVALID_INPUT" };
        }
      }
    }
    const parsed = ProductSaveInput.safeParse({
      ...Object.fromEntries(formData),
      variants,
      attributes,
    });
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const input = parsed.data;
    const db = getDb();
    let productId: string;
    if (input.id) {
      updateProduct(db, actor, input.id, input);
      productId = input.id;
    } else {
      productId = createProduct(db, actor, input);
    }
    return { ok: true, productId };
  } catch (e) {
    return toResult(e);
  }
}

/** Publish / unpublish / archive from the products table; errors surface as toasts. */
export async function setProductStatusAction(formData: FormData): Promise<SellerActionResult> {
  try {
    const parsed = SetProductStatusInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    setProductStatus(getDb(), actor, parsed.data.productId, parsed.data.status);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function duplicateProductAction(formData: FormData): Promise<SellerActionResult> {
  try {
    const productId = String(formData.get("productId") ?? "");
    if (!productId) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    duplicateProduct(getDb(), actor, productId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** DRAFT → moderation queue; errors surface as toasts. */
export async function submitForReviewAction(formData: FormData): Promise<SellerActionResult> {
  try {
    const parsed = SubmitForReviewInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    submitForReview(getDb(), actor, parsed.data.productId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}
