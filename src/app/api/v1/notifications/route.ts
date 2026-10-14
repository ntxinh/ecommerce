import { NotificationMarkInput } from "@/server/api/contracts/notifications";
import { AuthError, toErrorResponse } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { listNotifications, markAllRead, markRead } from "@/server/modules/notifications/service";

/** GET ?cursor&limit — actor's notifications (newest first) + unread count. */
export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) throw new AuthError("UNAUTHORIZED", 401);
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam === null ? undefined : Number(limitParam);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new AuthError("INVALID_INPUT", 400, "invalid limit");
    }
    return Response.json({
      data: listNotifications(getDb(), actor, {
        cursor: url.searchParams.get("cursor") ?? undefined,
        limit,
      }),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** PATCH {id} marks one read; PATCH {} marks all. Returns count marked. */
export async function PATCH(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) throw new AuthError("UNAUTHORIZED", 401);
    // req.json() throws SyntaxError on malformed bodies — map to a 400.
    const body = await req.json().catch(() => {
      throw new AuthError("INVALID_INPUT", 400, "malformed JSON");
    });
    const parsed = NotificationMarkInput.safeParse(body);
    if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
    const db = getDb();
    let marked = 0;
    if (parsed.data.id) {
      markRead(db, actor, parsed.data.id);
      marked = 1;
    } else {
      marked = markAllRead(db, actor);
    }
    return Response.json({ data: { marked } });
  } catch (e) {
    return toErrorResponse(e);
  }
}
