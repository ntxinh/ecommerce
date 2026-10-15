"use server";

import { ApplyInput, ShopProfileInput } from "@/server/api/contracts/seller";
import { AuthError } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { applyToSell, updateShopProfile } from "@/server/modules/sellers/service";

export type SellActionResult = { ok: true } | { ok: false; error: string };
export type SellActionState = SellActionResult | null;

function toResult(e: unknown): SellActionResult {
  if (e instanceof AuthError) return { ok: false, error: e.code };
  throw e;
}

/** Submit (or resubmit) a seller application. `registration` packs into businessInfo. */
export async function applyToSellAction(
  _prev: SellActionState,
  formData: FormData,
): Promise<SellActionResult> {
  try {
    const registration = String(formData.get("registration") ?? "").trim();
    const parsed = ApplyInput.safeParse({
      shopName: formData.get("shopName"),
      description: formData.get("description") ?? "",
      businessInfo: registration ? { registration } : {},
    });
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    applyToSell(getDb(), actor, parsed.data);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Seller shop profile save (name + description). */
export async function updateShopProfileAction(
  _prev: SellActionState,
  formData: FormData,
): Promise<SellActionResult> {
  try {
    const parsed = ShopProfileInput.safeParse({
      shopId: formData.get("shopId"),
      name: formData.get("name") ?? undefined,
      description: formData.get("description") ?? undefined,
    });
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const { shopId, ...patch } = parsed.data;
    const actor = await getActor();
    updateShopProfile(getDb(), actor, shopId, patch);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}
