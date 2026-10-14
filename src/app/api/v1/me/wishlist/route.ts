import { AuthError, toErrorResponse } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getWishlist } from "@/server/modules/cart/wishlist";

/** GET /api/v1/me/wishlist — product ids on the signed-in user's wishlist. */
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) throw new AuthError("UNAUTHORIZED", 401);
    return Response.json({ data: { productIds: getWishlist(getDb(), actor.userId) } });
  } catch (e) {
    return toErrorResponse(e);
  }
}
