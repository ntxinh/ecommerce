"use server";

import { AuthError } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import type { Actor } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import {
  cancelSellerOrder,
  completeSellerOrder,
  confirmSellerOrder,
  deliverSellerOrder,
  packSellerOrder,
  shipSellerOrder,
} from "@/server/modules/orders/fulfillment";
import type { SellerActionResult } from "./actions";

function toResult(e: unknown): SellerActionResult {
  if (e instanceof AuthError) return { ok: false, error: e.code };
  throw e;
}

/** Shared preamble: session actor + sellerOrderId from the form. */
async function ctx(
  formData: FormData,
): Promise<{ error: string } | { actor: Actor; sellerOrderId: string }> {
  const actor = await getActor();
  if (!actor) return { error: "UNAUTHORIZED" as const };
  const sellerOrderId = String(formData.get("sellerOrderId") ?? "");
  if (!sellerOrderId) return { error: "INVALID_INPUT" as const };
  return { actor, sellerOrderId };
}

/** NEW → CONFIRMED. */
export async function confirmOrderAction(formData: FormData): Promise<SellerActionResult> {
  try {
    const c = await ctx(formData);
    if ("error" in c) return { ok: false, error: c.error };
    confirmSellerOrder(getDb(), c.actor, c.sellerOrderId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** CONFIRMED → PACKING. */
export async function packOrderAction(formData: FormData): Promise<SellerActionResult> {
  try {
    const c = await ctx(formData);
    if ("error" in c) return { ok: false, error: c.error };
    packSellerOrder(getDb(), c.actor, c.sellerOrderId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** PACKING|READY_TO_SHIP → SHIPPED: carrier + tracking number create the shipment. */
export async function shipOrderAction(formData: FormData): Promise<SellerActionResult> {
  try {
    const c = await ctx(formData);
    if ("error" in c) return { ok: false, error: c.error };
    const carrier = String(formData.get("carrier") ?? "").trim();
    const trackingNumber = String(formData.get("trackingNumber") ?? "").trim();
    if (!carrier || !trackingNumber) return { ok: false, error: "INVALID_INPUT" };
    shipSellerOrder(getDb(), c.actor, c.sellerOrderId, { carrier, trackingNumber });
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** SHIPPED → DELIVERED. */
export async function deliverOrderAction(formData: FormData): Promise<SellerActionResult> {
  try {
    const c = await ctx(formData);
    if ("error" in c) return { ok: false, error: c.error };
    deliverSellerOrder(getDb(), c.actor, c.sellerOrderId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** DELIVERED → COMPLETED. */
export async function completeOrderAction(formData: FormData): Promise<SellerActionResult> {
  try {
    const c = await ctx(formData);
    if ("error" in c) return { ok: false, error: c.error };
    completeSellerOrder(getDb(), c.actor, c.sellerOrderId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** NEW|CONFIRMED → CANCELLED (refunds the leg's share when the parent is PAID). */
export async function cancelOrderAction(formData: FormData): Promise<SellerActionResult> {
  try {
    const c = await ctx(formData);
    if ("error" in c) return { ok: false, error: c.error };
    await cancelSellerOrder(getDb(), c.actor, c.sellerOrderId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}
