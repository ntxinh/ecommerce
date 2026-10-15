"use server";

import { RequestReturnInput } from "@/server/api/contracts/returns";
import { AuthError } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { decideReturn, disputeReturn, requestReturn } from "@/server/modules/orders/returns";

export type ReturnActionResult = { ok: true; id?: string } | { ok: false; error: string };

function toResult(e: unknown): ReturnActionResult {
  if (e instanceof AuthError) return { ok: false, error: e.code };
  throw e;
}

/** Customer files a return against one DELIVERED/COMPLETED seller order.
 *  `items` travels as JSON from the form's controlled per-item rows. */
export async function requestReturnAction(formData: FormData): Promise<ReturnActionResult> {
  try {
    let items: unknown;
    try {
      items = JSON.parse(String(formData.get("items") ?? "[]"));
    } catch {
      return { ok: false, error: "INVALID_INPUT" };
    }
    const evidence = String(formData.get("evidence") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const parsed = RequestReturnInput.safeParse({
      sellerOrderId: String(formData.get("sellerOrderId") ?? ""),
      items,
      reason: String(formData.get("reason") ?? ""),
      evidence,
    });
    if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
    const actor = await getActor();
    if (!actor) return { ok: false, error: "UNAUTHORIZED" };
    const id = requestReturn(getDb(), actor, parsed.data);
    return { ok: true, id };
  } catch (e) {
    return toResult(e);
  }
}

/** Seller decides a PENDING request; ADMIN may also decide a DISPUTED one. */
export async function decideReturnAction(formData: FormData): Promise<ReturnActionResult> {
  try {
    const actor = await getActor();
    if (!actor) return { ok: false, error: "UNAUTHORIZED" };
    const id = String(formData.get("returnRequestId") ?? "");
    const decision = String(formData.get("decision") ?? "");
    if (!id || (decision !== "APPROVED" && decision !== "REJECTED")) {
      return { ok: false, error: "INVALID_INPUT" };
    }
    const note = String(formData.get("note") ?? "").trim();
    await decideReturn(getDb(), actor, id, decision, note || undefined);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Buyer escalates a REJECTED request to DISPUTED for admin adjudication. */
export async function disputeReturnAction(formData: FormData): Promise<ReturnActionResult> {
  try {
    const actor = await getActor();
    if (!actor) return { ok: false, error: "UNAUTHORIZED" };
    const id = String(formData.get("returnRequestId") ?? "");
    if (!id) return { ok: false, error: "INVALID_INPUT" };
    disputeReturn(getDb(), actor, id);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}
