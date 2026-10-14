import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import type { DB } from "@/server/db/client";
import { paymentAttempts, payments } from "@/server/db/schema";
import { persistPaymentOutcome } from "@/server/modules/orders/outcome";
import type { PaymentProvider, PaymentStatus } from "./providers";

const DEFAULT_BASE = "https://finix.sandbox-payments-api.com";
const FINIX_VERSION = "2022-02-01";
const TIMEOUT_MS = 15_000;

/** Thin REST client — Finix is plain JSON + HTTP Basic, no SDK needed.
 *  `fetchFn` is injectable so tests stub the network at the seam. */
export type Finix = {
  fetchFn: typeof fetch;
  base: string;
  auth: string;
  merchantId: string;
};

// process.env (not @/env) so tests can inject keys after env.ts parsed.
let client: Finix | null | undefined;

/** undefined resets to uncomputed (re-read env); null forces "unconfigured". */
export function setFinixForTests(stub: Finix | null | undefined): void {
  client = stub;
}

/** Lazy singleton; null when FINIX_USERNAME/PASSWORD/MERCHANT_ID aren't set. */
export function getFinix(): Finix | null {
  if (client === undefined) {
    const { FINIX_USERNAME, FINIX_PASSWORD, FINIX_MERCHANT_ID } = process.env;
    client =
      FINIX_USERNAME && FINIX_PASSWORD && FINIX_MERCHANT_ID
        ? {
            fetchFn: fetch,
            base: (process.env.FINIX_BASE_URL || DEFAULT_BASE).replace(/\/$/, ""),
            auth: `Basic ${Buffer.from(`${FINIX_USERNAME}:${FINIX_PASSWORD}`).toString("base64")}`,
            merchantId: FINIX_MERCHANT_ID,
          }
        : null;
  }
  return client;
}

/** Server-side gate for the FINIX method (checkout + API callers). */
export function finixConfigured(): boolean {
  return Boolean(
    process.env.FINIX_USERNAME && process.env.FINIX_PASSWORD && process.env.FINIX_MERCHANT_ID,
  );
}

async function finixRequest(
  finix: Finix,
  method: string,
  path: string,
  body?: unknown,
  // biome-ignore lint/suspicious/noExplicitAny: Finix payloads are loosely typed JSON
): Promise<any> {
  const res = await finix.fetchFn(`${finix.base}${path}`, {
    method,
    headers: {
      authorization: finix.auth,
      "finix-version": FINIX_VERSION,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      data?._embedded?.errors?.map((e: { message?: string }) => e.message).join("; ") ??
      `finix ${res.status}`;
    throw new Error(`Finix ${method} ${path} failed: ${detail}`);
  }
  return data;
}

export type AttemptOutcome = "PAID" | "FAILED" | "PENDING";

/** Finix transfer state → our coarse outcome. SUCCEEDED is the only capture;
 *  FAILED/CANCELED are terminal, everything else is still settling. */
export function transferOutcome(state: string | null | undefined): AttemptOutcome {
  if (state === "SUCCEEDED") return "PAID";
  if (state === "FAILED" || state === "CANCELED") return "FAILED";
  return "PENDING";
}

/** Loose transfer shape — Finix fields are strings; extras ignored. */
type FinixTransfer = {
  id?: string;
  state?: string;
  amount?: number;
  currency?: string;
  tags?: Record<string, string | undefined>;
  checkout_form_id?: string;
};

/** Finds the transfer produced by one checkout form. `entity_id` is the
 *  documented filter; `transferId` (from the success return URL) is verified
 *  against the attempt list so a stray TR id can't settle this order.
 *  Returns null until the buyer pays. The returned transfer always carries
 *  `checkout_form_id` so resolveAttempt's binding chain matches. */
export async function finixFormTransfer(
  finix: Finix,
  formId: string,
  transferId?: string,
): Promise<FinixTransfer | null> {
  const page = await finixRequest(
    finix,
    "GET",
    `/transfer_attempts?entity_id=${encodeURIComponent(formId)}`,
  );
  const attempts = page?._embedded?.transfer_attempts ?? [];
  const linked = attempts
    .map((ta: { transfer_id?: string }) => ta.transfer_id)
    .filter((id: string | undefined): id is string => Boolean(id));
  const tid = transferId ?? linked.at(-1);
  // An explicitly-named transfer must belong to this form — buyers could pass
  // any TR id on the return URL; only transfers this form produced bind.
  if (!tid || (transferId && !linked.includes(tid))) return null;
  const t = await finixRequest(finix, "GET", `/transfers/${encodeURIComponent(tid)}`);
  return t ? { ...t, checkout_form_id: t.checkout_form_id ?? formId } : null;
}

/** Resolves the attempt a transfer settles on — the dedupe key for the
 *  webhook AND the return page. Chain: transfer id already recorded on an
 *  attempt (replay) → checkout_form_id matches an attempt's providerRef →
 *  propagated tags.attemptId → tags.orderId latest live attempt. Amount must
 *  match the payment's VND total so stray transfers can't settle an order. */
function resolveAttempt(db: DB, transfer: FinixTransfer) {
  const attempt = transfer.id
    ? db.select().from(paymentAttempts).where(eq(paymentAttempts.externalRef, transfer.id)).get()
    : undefined;
  const found =
    attempt ??
    (transfer.checkout_form_id
      ? db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.providerRef, transfer.checkout_form_id))
          .get()
      : undefined) ??
    (transfer.tags?.attemptId
      ? db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, transfer.tags.attemptId))
          .get()
      : undefined) ??
    (transfer.tags?.orderId
      ? db
          .select({ a: paymentAttempts })
          .from(paymentAttempts)
          .innerJoin(payments, eq(paymentAttempts.paymentId, payments.id))
          .where(eq(payments.orderId, transfer.tags.orderId))
          .all()
          .map((r) => r.a)
          .find((a) => a.status === "PENDING")
      : undefined);
  if (!found) return null;
  const payment = db.select().from(payments).where(eq(payments.id, found.paymentId)).get();
  // Binding check: a transfer is only authoritative for its attempt if the
  // amounts agree — a mismatched/ref is acked, never applied.
  if (!payment || transfer.amount === undefined || transfer.amount !== payment.amountVnd) {
    return null;
  }
  return found;
}

/** Applies a Finix outcome to its attempt/payment/order — the shared
 *  idempotent core behind the webhook AND the return-page fallback.
 *  Attempt-level PAID is never downgraded; PENDING outcomes are no-ops. */
export function applyFinixTransferOutcome(
  db: DB,
  transfer: FinixTransfer,
  outcome: AttemptOutcome,
): { attemptId: string | null; applied: boolean } {
  const attempt = resolveAttempt(db, transfer);
  if (!attempt) return { attemptId: null, applied: false };
  // Record the transfer id so webhook replays resolve O(1) and audit trails
  // can link the attempt to Finix without an API round-trip.
  if (transfer.id && attempt.externalRef !== transfer.id) {
    db.update(paymentAttempts)
      .set({ externalRef: transfer.id })
      .where(eq(paymentAttempts.id, attempt.id))
      .run();
  }
  if (attempt.status === "PAID" || attempt.status === "FAILED" || outcome === "PENDING") {
    return { attemptId: attempt.id, applied: false };
  }
  persistPaymentOutcome(db, attempt.paymentId, outcome, attempt.id);
  return { attemptId: attempt.id, applied: true };
}

/**
 * Verifies the Finix-Signature header: `timestamp=<epoch>,sig=<hex>` where sig
 * is HMAC-SHA256("<ts>:<rawBody>", FINIX_WEBHOOK_SECRET).
 */
export function verifyFinixSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => kv.split("=", 2) as [string, string]),
  );
  const ts = parts.timestamp;
  const sig = parts.sig;
  if (!ts || !sig || !/^\d+$/.test(ts) || !/^[0-9a-f]{64}$/i.test(sig)) return false;
  const expected = createHmac("sha256", secret).update(`${ts}:${payload}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** One verified webhook event. Transfer create/update carrying a terminal
 *  state settles its attempt; everything else is acked, not retried. */
export function processFinixEvent(
  db: DB,
  event: {
    entity?: string;
    type?: string;
    data?: unknown;
  },
): AttemptOutcome | "IGNORED" {
  if (event.entity !== "transfer") return "IGNORED";
  const t = event.data as FinixTransfer | undefined;
  if (!t?.id) return "IGNORED";
  const outcome = transferOutcome(t.state);
  if (outcome === "PENDING") return "IGNORED";
  applyFinixTransferOutcome(db, t, outcome);
  return outcome;
}

/**
 * Verified webhook entrypoint shared by the route and tests. 404 without
 * `FINIX_WEBHOOK_SECRET`/creds (env-gated), 400 on bad signature, 200 ack for
 * handled/ignored/unknown events.
 */
export function handleFinixWebhook(
  db: DB,
  payload: string,
  signatureHeader: string | null,
): { status: number; eventType?: string } {
  const finix = getFinix();
  const secret = process.env.FINIX_WEBHOOK_SECRET;
  if (!finix || !secret) return { status: 404 };
  if (!verifyFinixSignature(payload, signatureHeader, secret)) return { status: 400 };
  let event: { entity?: string; type?: string; data?: unknown };
  try {
    event = JSON.parse(payload);
  } catch {
    return { status: 400 };
  }
  processFinixEvent(db, event);
  return { status: 200, eventType: `${event.entity ?? "?"}:${event.type ?? "?"}` };
}

/** Finix needs merchant-required branding on every hosted form. Logo/icon
 *  default to the app's own mark so sandbox works out of the box;
 *  FINIX_LOGO_URL/FINIX_ICON_URL override. */
function finixBranding(origin: string) {
  const logo = process.env.FINIX_LOGO_URL ?? `${origin}/file.svg`;
  const icon = process.env.FINIX_ICON_URL ?? `${origin}/file.svg`;
  return {
    name: "MarketFlow",
    brand_color: "#1A56DB",
    accent_color: "#111111",
    logo,
    icon,
  };
}

async function createCheckoutForm(
  finix: Finix,
  ctx: {
    amountVnd: number;
    orderId: string;
    attemptId: string;
    origin: string;
    locale: string;
  },
): Promise<{ ref: string; redirectUrl?: string }> {
  const returnPath = `${ctx.origin}/${ctx.locale}/checkout/pay-finix/${ctx.orderId}`;
  const form = await finixRequest(finix, "POST", "/checkout_forms", {
    merchant_id: finix.merchantId,
    payment_frequency: "ONE_TIME",
    is_multiple_use: false,
    allowed_payment_methods: ["PAYMENT_CARD"],
    nickname: `MarketFlow order ${ctx.orderId}`,
    amount_details: {
      amount_type: "FIXED",
      total_amount: ctx.amountVnd,
      currency: "VND",
    },
    branding: finixBranding(ctx.origin),
    additional_details: {
      terms_of_service_url: `${ctx.origin}/${ctx.locale}/terms`,
      success_return_url: `${returnPath}?orderId=${ctx.orderId}`,
      cart_return_url: `${ctx.origin}/${ctx.locale}/checkout?cart=${ctx.orderId}`,
      expired_session_url: `${ctx.origin}/${ctx.locale}/checkout?expired=${ctx.orderId}`,
      expiration_in_minutes: 30,
    },
    tags: { orderId: ctx.orderId, attemptId: ctx.attemptId },
  });
  return { ref: form.id, redirectUrl: form.link_url ?? form.checkout_link };
}

/** Fetches a form's hosted link — the idempotency-replay path re-issues it. */
export async function finixCheckoutLink(finix: Finix, formId: string): Promise<string | null> {
  const form = await finixRequest(
    finix,
    "GET",
    `/checkout_forms/${encodeURIComponent(formId)}`,
  ).catch(() => null);
  return form?.link_url ?? form?.checkout_link ?? null;
}

/** Finix card adapter: deferred confirm — attempts stay PENDING until the
 *  webhook or return-page apply path settles them. */
export const finixCard: PaymentProvider = {
  createAttempt: async ({ amountVnd, orderId, attemptId, origin, locale }) => {
    const finix = getFinix();
    if (!finix) throw new AuthError("INVALID_INPUT", 422, "finix is not configured");
    if (!orderId || !attemptId || !origin) {
      throw new AuthError("INVALID_INPUT", 422, "finix attempt requires order context");
    }
    return createCheckoutForm(finix, {
      amountVnd,
      orderId,
      attemptId,
      origin,
      locale: locale ?? "en",
    });
  },
  confirm: async ({ ref }) => {
    const finix = getFinix();
    if (!finix) throw new AuthError("INVALID_INPUT", 422, "finix is not configured");
    const t = await finixFormTransfer(finix, ref);
    return t ? transferOutcome(t.state) : "PENDING";
  },
  refund: async ({ ref, amountVnd }) => {
    const finix = getFinix();
    if (!finix) throw new AuthError("INVALID_INPUT", 422, "finix is not configured");
    const t = await finixFormTransfer(finix, ref);
    const transferId = t?.state === "SUCCEEDED" && t.id ? t.id : null;
    if (!transferId) return "REFUNDED"; // unpaid form — nothing captured to refund
    await finixRequest(finix, "POST", `/transfers/${encodeURIComponent(transferId)}/reversals`, {
      refund_amount: amountVnd,
      idempotency_id: `${transferId}:${amountVnd}:${ulid()}`,
    });
    return "REFUNDED";
  },
};
