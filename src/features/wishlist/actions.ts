"use server";

import { WishlistToggleInput } from "@/server/api/contracts/wishlist";
import { AuthError } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getWishlist, toggleWishlistItem } from "@/server/modules/cart/wishlist";

export type WishlistActionResult =
  | { ok: true; productIds: string[]; wished: boolean }
  | { ok: false; error: string };

/** Toggles a product on the signed-in user's wishlist; guests get UNAUTHORIZED. */
export async function toggleWishlistAction(
  _prev: null,
  formData: FormData,
): Promise<WishlistActionResult> {
  const parsed = WishlistToggleInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  try {
    const actor = await getActor();
    if (!actor) return { ok: false, error: "UNAUTHORIZED" };
    const db = getDb();
    const wished = toggleWishlistItem(db, actor.userId, parsed.data.productId);
    return { ok: true, productIds: getWishlist(db, actor.userId), wished };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.code };
    throw e;
  }
}
