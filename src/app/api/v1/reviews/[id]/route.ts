import { ReviewPatchInput } from "@/server/api/contracts/reviews";
import { AuthError, toErrorResponse } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { deleteReview, moderateReview, updateReview } from "@/server/modules/reviews/service";

/**
 * PATCH /api/v1/reviews/{id} — `{action:"HIDE"|"UNHIDE", note?}` moderates
 * (admin); otherwise {rating?,title?,body?} updates (author only).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor();
    if (!actor) throw new AuthError("UNAUTHORIZED", 401);
    const { id } = await ctx.params;
    const body = await req.json().catch(() => {
      throw new AuthError("INVALID_INPUT", 400, "malformed JSON");
    });
    const parsed = ReviewPatchInput.safeParse(body);
    if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
    const { action, note, rating, title, body: bodyText } = parsed.data;
    const db = getDb();
    if (action) {
      moderateReview(db, actor, id, action, note);
    } else {
      if (rating === undefined && title === undefined && bodyText === undefined) {
        throw new AuthError("INVALID_INPUT", 400, "nothing to update");
      }
      updateReview(db, actor, id, { rating, title, body: bodyText });
    }
    return Response.json({ data: { id } });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** DELETE /api/v1/reviews/{id} — author or admin; frees the order item. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor();
    if (!actor) throw new AuthError("UNAUTHORIZED", 401);
    const { id } = await ctx.params;
    deleteReview(getDb(), actor, id);
    return Response.json({ data: { deleted: true } });
  } catch (e) {
    return toErrorResponse(e);
  }
}
