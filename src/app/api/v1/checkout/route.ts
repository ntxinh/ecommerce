import { CheckoutInput } from "@/server/api/contracts/checkout";
import { AuthError, toErrorResponse } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { placeOrder } from "@/server/modules/orders/checkout";

/**
 * POST /api/v1/checkout — place an order. `Idempotency-Key` header wins over
 * `idempotencyKey` in the body; a completed replay returns the same order.
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) throw new AuthError("UNAUTHORIZED", 401);
    const body = await req.json().catch(() => {
      throw new AuthError("INVALID_INPUT", 400, "malformed JSON");
    });
    const parsed = CheckoutInput.safeParse(body);
    if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
    const idempotencyKey = req.headers.get("Idempotency-Key") ?? parsed.data.idempotencyKey ?? "";
    const result = await placeOrder(getDb(), actor, {
      ...parsed.data,
      idempotencyKey,
    });
    return Response.json({ data: result }, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
