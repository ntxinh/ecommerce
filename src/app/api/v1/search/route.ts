import { SearchQuery } from "@/server/api/contracts/search";
import { AuthError, toErrorResponse } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { recordSearch, search, suggest } from "@/server/modules/search/service";

/**
 * GET /api/v1/search?q=&sort=&cursor= — public product search.
 * `mode=suggest` returns autocomplete names instead of cards; filters and
 * pagination apply to search mode only. Authenticated searches are recorded
 * in search_history; guests write nothing.
 */
export async function GET(req: Request) {
  try {
    const parsed = SearchQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
    const { mode, q, ...params } = parsed.data;
    const db = getDb();
    if (mode === "suggest") return Response.json({ data: { suggestions: suggest(db, q) } });
    const actor = await getActor();
    const result = search(db, { q, ...params });
    if (actor) recordSearch(db, actor.userId, q);
    return Response.json({ data: result });
  } catch (e) {
    return toErrorResponse(e);
  }
}
