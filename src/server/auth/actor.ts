import "server-only";
import { getDb } from "@/server/db/client";
import { getSessionToken } from "./cookies";
import type { Actor } from "./permissions";
import { resolveSession } from "./sessions";

/** Resolves the request's session cookie to an Actor; null when logged out/expired. */
export async function currentActor(): Promise<Actor | null> {
  const token = await getSessionToken();
  return token ? resolveSession(getDb(), token) : null;
}
