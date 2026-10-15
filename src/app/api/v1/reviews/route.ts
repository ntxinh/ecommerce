import { ReviewCreateInput } from "@/server/api/contracts/reviews";
import { AuthError, toErrorResponse } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { createReview } from "@/server/modules/reviews/service";

/**
 * POST /api/v1/reviews — review one purchased order item. Requires a
 * fulfilled parent order; one review per item; sellers can't review their
 * own shop's products (ADMIN exempt).
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) throw new AuthError("UNAUTHORIZED", 401);
    const body = await req.json().catch(() => {
      throw new AuthError("INVALID_INPUT", 400, "malformed JSON");
    });
    const parsed = ReviewCreateInput.safeParse(body);
    if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
    const id = createReview(getDb(), actor, parsed.data);
    return Response.json({ data: { id } }, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
