"use server";

import { ProductSaveInput, SetProductStatusInput } from "@/server/api/contracts/catalog";
import { AuthError } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import {
  createProduct,
  duplicateProduct,
  setProductStatus,
  updateProduct,
} from "@/server/modules/catalog/manage";

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
    const raw = formData.get("variants");
    if (typeof raw === "string" && raw !== "") {
      try {
        variants = JSON.parse(raw);
      } catch {
        return { ok: false, error: "INVALID_INPUT" };
      }
    }
    const parsed = ProductSaveInput.safeParse({ ...Object.fromEntries(formData), variants });
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
