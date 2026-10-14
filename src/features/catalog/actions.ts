"use server";

import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { clearSearchHistory } from "@/server/modules/search/service";

/** Clears the signed-in user's search_history; guests are a no-op error. */
export async function clearSearchHistoryAction(): Promise<{ ok: boolean }> {
  const actor = await getActor();
  if (!actor) return { ok: false };
  clearSearchHistory(getDb(), actor.userId);
  return { ok: true };
}
