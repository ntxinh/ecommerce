"use server";

import {
  CartAddInput,
  CartMergeInput,
  CartRemoveInput,
  CartUpdateInput,
} from "@/server/api/contracts/cart";
import { AuthError } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import type { CartView } from "@/server/modules/cart/service";
import {
  addItem,
  clearCart,
  mergeGuestCart,
  removeItem,
  updateQty,
} from "@/server/modules/cart/service";

export type CartActionResult = { ok: true; cart: CartView } | { ok: false; error: string };

export type CartActionState = CartActionResult | null;

async function run(fn: (userId: string) => CartView): Promise<CartActionResult> {
  try {
    const actor = await getActor();
    if (!actor) return { ok: false, error: "UNAUTHORIZED" };
    return { ok: true, cart: fn(actor.userId) };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function addToCartAction(
  _prev: CartActionState,
  formData: FormData,
): Promise<CartActionResult> {
  const parsed = CartAddInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { variantId, qty } = parsed.data;
  return run((userId) => addItem(getDb(), userId, variantId, qty));
}

/** qty "0" removes the line. */
export async function updateCartItemAction(
  _prev: CartActionState,
  formData: FormData,
): Promise<CartActionResult> {
  const parsed = CartUpdateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { cartItemId, qty } = parsed.data;
  return run((userId) => updateQty(getDb(), userId, cartItemId, qty));
}

export async function removeCartItemAction(
  _prev: CartActionState,
  formData: FormData,
): Promise<CartActionResult> {
  const parsed = CartRemoveInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  return run((userId) => removeItem(getDb(), userId, parsed.data.cartItemId));
}

export async function clearCartAction(
  _prev: CartActionState,
  _formData: FormData,
): Promise<CartActionResult> {
  return run((userId) => clearCart(getDb(), userId));
}

/** items arrive as JSON (e.g. JSON.stringify(localStorage cart)) in `guestItems`. */
export async function mergeGuestCartAction(
  _prev: CartActionState,
  formData: FormData,
): Promise<CartActionResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("guestItems") ?? ""));
  } catch {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const parsed = CartMergeInput.safeParse({ items: raw });
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const items = parsed.data.items;
  return run((userId) => mergeGuestCart(getDb(), userId, items));
}
