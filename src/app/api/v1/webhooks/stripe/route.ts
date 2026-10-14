import { getDb } from "@/server/db/client";
import { handleStripeWebhook } from "@/server/modules/payments/stripe";

/**
 * POST /api/v1/webhooks/stripe — Stripe event sink. Raw body is required for
 * signature verification; the route 404s unless STRIPE_WEBHOOK_SECRET is set.
 */
export async function POST(req: Request) {
  const payload = await req.text();
  const signature = req.headers.get("stripe-signature");
  const result = handleStripeWebhook(getDb(), payload, signature);
  if (result.status === 404) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (result.status === 400) {
    return Response.json({ error: "INVALID_SIGNATURE" }, { status: 400 });
  }
  return Response.json({ data: { received: true } }, { status: 200 });
}
