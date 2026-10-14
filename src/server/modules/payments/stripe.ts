import "server-only";

import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { AuthError } from "@/server/api/errors";
import type { DB } from "@/server/db/client";
import { paymentAttempts } from "@/server/db/schema";
import { persistPaymentOutcome } from "@/server/modules/orders/outcome";
import type { PaymentProvider, PaymentStatus } from "./providers";

// process.env (not @/env) so tests can inject keys after env.ts parsed.
let client: Stripe | null | undefined;

/** undefined resets to uncomputed (re-read env); null forces "unconfigured". */
export function setStripeForTests(stub: Stripe | null | undefined): void {
  client = stub;
}

/** Lazy singleton; null when STRIPE_SECRET_KEY isn't configured. */
export function getStripe(): Stripe | null {
  if (client === undefined) {
    client = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  }
  return client;
}

export type AttemptOutcome = "PAID" | "FAILED" | "PENDING";

/** Stripe Checkout Session → our coarse outcome. `open`+`unpaid` is still
 *  pending; `expired` (or a completed session that never paid) is dead. */
export function sessionOutcome(s: {
  status: Stripe.Checkout.Session.Status | string | null;
  payment_status: string;
}): AttemptOutcome {
  if (s.payment_status === "paid") return "PAID";
  if (s.status === "expired" || s.status === "complete") return "FAILED";
  return "PENDING";
}

/** Provider-side PaymentStatus for a retrieved session (adapter `confirm`). */
export function sessionPaymentStatus(s: {
  status: Stripe.Checkout.Session.Status | string | null;
  payment_status: string;
}): PaymentStatus {
  const o = sessionOutcome(s);
  return o === "PENDING" ? "PENDING" : o;
}

/** Applies a session outcome to its attempt/payment/order — the shared
 *  idempotent core behind the webhook AND the return-page fallback.
 *  Attempt-level PAID is never downgraded; PENDING outcomes are no-ops. */
export function applyStripeSessionOutcome(
  db: DB,
  session: { id: string },
  outcome: AttemptOutcome,
): { attemptId: string | null; applied: boolean } {
  const attempt = db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.providerRef, session.id))
    .get();
  // Unknown session (other integration / stray test event) — ack, don't retry.
  if (!attempt) return { attemptId: null, applied: false };
  // Never downgrade: PAID attempt ignores late FAILED; FAILED attempt ignores
  // a stale PAID race (a FAILED attempt is dead — retry mints a fresh session).
  if (attempt.status === "PAID" || attempt.status === "FAILED" || outcome === "PENDING") {
    return { attemptId: attempt.id, applied: false };
  }
  db.update(paymentAttempts)
    .set({ status: outcome === "PAID" ? "PAID" : "FAILED" })
    .where(eq(paymentAttempts.id, attempt.id))
    .run();
  persistPaymentOutcome(db, attempt.paymentId, outcome);
  return { attemptId: attempt.id, applied: true };
}

/** Applies one verified Stripe event. Returns the ack status for logging. */
export function processStripeEvent(db: DB, event: Stripe.Event): AttemptOutcome | "IGNORED" {
  const type = event.type;
  if (
    type === "checkout.session.completed" ||
    type === "checkout.session.expired" ||
    type === "checkout.session.async_payment_succeeded" ||
    type === "checkout.session.async_payment_failed"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    const outcome =
      type === "checkout.session.async_payment_succeeded"
        ? "PAID"
        : type === "checkout.session.expired" || type === "checkout.session.async_payment_failed"
          ? "FAILED"
          : sessionOutcome(session);
    applyStripeSessionOutcome(db, session, outcome);
    return outcome;
  }
  if (type === "payment_intent.payment_failed") {
    // PI events don't carry the session id — sessions tag payment_intent_data
    // metadata with attemptId so failures land on the right attempt.
    const pi = event.data.object as Stripe.PaymentIntent;
    const attemptId = pi.metadata?.attemptId;
    if (!attemptId) return "IGNORED";
    const attempt = db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attemptId))
      .get();
    if (!attempt || attempt.status === "PAID" || attempt.status === "FAILED") return "IGNORED";
    db.update(paymentAttempts)
      .set({ status: "FAILED" })
      .where(eq(paymentAttempts.id, attempt.id))
      .run();
    persistPaymentOutcome(db, attempt.paymentId, "FAILED");
    return "FAILED";
  }
  return "IGNORED";
}

/**
 * Verified webhook entrypoint shared by the route and tests. 404 without
 * `STRIPE_WEBHOOK_SECRET`/keys (env-gated), 400 on bad signature, 200 ack for
 * handled/ignored/unknown events.
 */
export function handleStripeWebhook(
  db: DB,
  payload: string,
  signatureHeader: string | null,
): { status: number; eventType?: string } {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return { status: 404 };
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signatureHeader ?? "", secret);
  } catch {
    return { status: 400 };
  }
  processStripeEvent(db, event);
  return { status: 200, eventType: event.type };
}

async function createSession(
  stripe: Stripe,
  ctx: {
    amountVnd: number;
    orderId: string;
    attemptId: string;
    origin: string;
    locale: string;
  },
): Promise<{ ref: string; redirectUrl?: string }> {
  const returnPath = `${ctx.origin}/${ctx.locale}/checkout/pay/${ctx.orderId}`;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    // VND is zero-decimal in Stripe: amount is whole đồng, no ×100.
    line_items: [
      {
        price_data: {
          currency: "vnd",
          unit_amount: ctx.amountVnd,
          product_data: { name: `MarketFlow order ${ctx.orderId}` },
        },
        quantity: 1,
      },
    ],
    metadata: { orderId: ctx.orderId, attemptId: ctx.attemptId },
    payment_intent_data: { metadata: { orderId: ctx.orderId, attemptId: ctx.attemptId } },
    success_url: `${returnPath}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: returnPath,
  });
  return { ref: session.id, redirectUrl: session.url ?? undefined };
}

/** Stripe card adapter: deferred confirm — attempts stay PENDING until the
 *  webhook or return-page apply path settles them. */
export const stripeCard: PaymentProvider = {
  createAttempt: async ({ amountVnd, orderId, attemptId, origin, locale }) => {
    const stripe = getStripe();
    if (!stripe) throw new AuthError("INVALID_INPUT", 422, "stripe is not configured");
    if (!orderId || !attemptId || !origin) {
      throw new AuthError("INVALID_INPUT", 422, "stripe attempt requires order context");
    }
    return createSession(stripe, { amountVnd, orderId, attemptId, origin, locale: locale ?? "en" });
  },
  confirm: async ({ ref }) => {
    const stripe = getStripe();
    if (!stripe) throw new AuthError("INVALID_INPUT", 422, "stripe is not configured");
    const session = await stripe.checkout.sessions.retrieve(ref);
    return sessionPaymentStatus(session);
  },
  refund: async ({ ref, amountVnd }) => {
    const stripe = getStripe();
    if (!stripe) throw new AuthError("INVALID_INPUT", 422, "stripe is not configured");
    const session = await stripe.checkout.sessions.retrieve(ref);
    const pi = typeof session.payment_intent === "string" ? session.payment_intent : null;
    if (!pi) return "REFUNDED"; // unpaid session — nothing captured to refund
    await stripe.refunds.create({ payment_intent: pi, amount: amountVnd });
    return "REFUNDED";
  },
};
