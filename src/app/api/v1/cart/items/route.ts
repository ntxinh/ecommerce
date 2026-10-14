import { CartAddInput, CartRemoveInput } from "@/server/api/contracts/cart";
import { AuthError, toErrorResponse } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { addItem, removeItem } from "@/server/modules/cart/service";

/** req.json() throws SyntaxError on malformed bodies — map to a 400. */
async function bodyJson(req: Request): Promise<unknown> {
  return req.json().catch(() => {
    throw new AuthError("INVALID_INPUT", 400, "malformed JSON");
  });
}

/** POST {variantId, qty} — additive upsert, returns the full cart view. */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) throw new AuthError("UNAUTHORIZED", 401);
    const parsed = CartAddInput.safeParse(await bodyJson(req));
    if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
    return Response.json({
      data: addItem(getDb(), actor.userId, parsed.data.variantId, parsed.data.qty),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** DELETE {cartItemId} — removes one line, returns the full cart view. */
export async function DELETE(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) throw new AuthError("UNAUTHORIZED", 401);
    const parsed = CartRemoveInput.safeParse(await bodyJson(req));
    if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
    return Response.json({
      data: removeItem(getDb(), actor.userId, parsed.data.cartItemId),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
