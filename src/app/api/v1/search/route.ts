import { SearchBase, SearchQuery } from "@/server/api/contracts/search";
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
    const raw = Object.fromEntries(new URL(req.url).searchParams);
    const base = SearchBase.safeParse(raw);
    if (!base.success) throw new AuthError("INVALID_INPUT", 400);
    const { mode, q } = base.data;
    const db = getDb();
    // Suggest ignores search params — they must not 400 the autocomplete call.
    if (mode === "suggest") return Response.json({ data: { suggestions: suggest(db, q) } });
    const parsed = SearchQuery.safeParse(raw);
    if (!parsed.success) throw new AuthError("INVALID_INPUT", 400);
    const actor = await getActor();
    const { mode: _mode, ...params } = parsed.data;
    const result = search(db, params);
    if (actor) recordSearch(db, actor.userId, q);
    return Response.json({ data: result });
  } catch (e) {
    return toErrorResponse(e);
  }
}
