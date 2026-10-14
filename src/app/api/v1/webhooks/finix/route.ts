import { getDb } from "@/server/db/client";
import { handleFinixWebhook } from "@/server/modules/payments/finix";

/**
 * POST /api/v1/webhooks/finix — Finix event sink. Raw body is required for
 * signature verification; the route 404s unless FINIX_WEBHOOK_SECRET (the
 * webhook's secret_signing_key, minted via POST /webhooks) is set.
 */
export async function POST(req: Request) {
  const payload = await req.text();
  const signature = req.headers.get("finix-signature");
  const result = handleFinixWebhook(getDb(), payload, signature);
  if (result.status === 404) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (result.status === 400) {
    return Response.json({ error: "INVALID_SIGNATURE" }, { status: 400 });
  }
  return Response.json({ data: { received: true } }, { status: 200 });
}
