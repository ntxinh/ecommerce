"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ulid } from "ulidx";
import { z } from "zod";
import { AuthError } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import type { DB } from "@/server/db/client";
import { getDb } from "@/server/db/client";
import { addresses } from "@/server/db/schema";
import { clearCart, getCart } from "@/server/modules/cart/service";
import { placeOrder, requestOrigin } from "@/server/modules/orders/checkout";
import { retryPayment } from "@/server/modules/orders/service";

export type CheckoutActionResult = { ok: true; orderId: string } | { ok: false; error: string };

export type CheckoutActionState = CheckoutActionResult | null;

const AddressFields = z.object({
  recipientName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(32),
  line1: z.string().trim().min(1).max(300),
  ward: z.string().trim().min(1).max(100),
  district: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100),
});

function insertAddress(db: DB, userId: string, formData: FormData): string {
  const parsed = AddressFields.safeParse({
    recipientName: formData.get("recipientName"),
    phone: formData.get("phone"),
    line1: formData.get("line1"),
    ward: formData.get("ward"),
    district: formData.get("district"),
    city: formData.get("city"),
  });
  if (!parsed.success) throw new AuthError("INVALID_INPUT", 400, "incomplete address");
  const id = `addr_${ulid()}`;
  db.insert(addresses)
    .values({ id, userId, ...parsed.data, isDefault: false, createdAt: Date.now() })
    .run();
  return id;
}

/**
 * Server checkout: buys the whole server cart (every line), prices shipping +
 * vouchers server-side via placeOrder, then clears the purchased lines (the
 * cart service deliberately does not remove them).
 */
export async function placeOrderAction(
  _prev: CheckoutActionState,
  formData: FormData,
): Promise<CheckoutActionResult> {
  try {
    const actor = await getActor();
    if (!actor) return { ok: false, error: "UNAUTHORIZED" };
    const db = getDb();

    const cart = getCart(db, actor.userId);
    if (cart.items.length === 0) return { ok: false, error: "INVALID_INPUT" };

    const addressChoice = String(formData.get("addressId") ?? "");
    const addressId =
      addressChoice === "new" ? insertAddress(db, actor.userId, formData) : addressChoice;
    if (!addressId) return { ok: false, error: "INVALID_INPUT" };

    const shippingByShop: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("shipping_") && typeof value === "string" && value) {
        shippingByShop[key.slice("shipping_".length)] = value;
      }
    }

    const voucherCodes = String(formData.get("voucherCodes") ?? "")
      .split(/[\s,]+/)
      .filter(Boolean);

    const paymentMethod = formData.get("paymentMethod");
    const stripeOn = Boolean(process.env.STRIPE_PUBLISHABLE_KEY);
    if (
      paymentMethod !== "COD" &&
      paymentMethod !== "MOCK_WALLET" &&
      paymentMethod !== "MOCK_BANK" &&
      !(paymentMethod === "STRIPE" && stripeOn)
    ) {
      return { ok: false, error: "INVALID_INPUT" };
    }
    const simulate = formData.get("simulate");

    const result = await placeOrder(
      db,
      actor,
      {
        cartItemIds: cart.items.map((i) => i.cartItemId),
        addressId,
        shippingByShop,
        voucherCodes,
        paymentMethod,
        idempotencyKey: String(formData.get("idempotencyKey") ?? `ui_${ulid()}`),
        simulate: simulate === "success" || simulate === "failure" ? simulate : undefined,
      },
      {
        origin: requestOrigin(await headers()),
        locale: String(formData.get("locale") ?? "en"),
      },
    );

    clearCart(db, actor.userId);
    // STRIPE: the order is placed but unpaid — hand the browser to Stripe's
    // hosted Checkout. redirect() throws; the client never sees a result.
    if (result.redirectUrl) redirect(result.redirectUrl);
    return { ok: true, orderId: result.orderId };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.code };
    throw e;
  }
}

/**
 * Pay-page retry for a wedged Stripe order: mints a fresh Checkout Session
 * and sends the browser back to Stripe.
 */
export async function retryStripePayment(
  orderId: string,
  locale: string,
  _formData: FormData,
): Promise<void> {
  const actor = await getActor();
  if (!actor) redirect(`/${locale}/login`);
  const result = await retryPayment(getDb(), actor, orderId, undefined, {
    origin: requestOrigin(await headers()),
    locale,
  });
  if (result.redirectUrl) redirect(result.redirectUrl);
  redirect(`/${locale}/checkout/pay/${orderId}`);
}
