import { AuthError, toErrorResponse } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getCart } from "@/server/modules/cart/service";

export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) throw new AuthError("UNAUTHORIZED", 401);
    return Response.json({ data: getCart(getDb(), actor.userId) });
  } catch (e) {
    return toErrorResponse(e);
  }
}
