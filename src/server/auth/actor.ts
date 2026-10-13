import "server-only";
import { connection } from "next/server";
import { AuthError } from "@/server/api/errors";
import { getDb } from "@/server/db/client";
import { getSessionToken } from "./cookies";
import { type Actor, requirePermission } from "./permissions";
import { resolveSession } from "./sessions";

/** Resolves the request's session cookie to an Actor; null when logged out/expired. */
export async function getActor(): Promise<Actor | null> {
  await connection(); // session cookie read must happen at request time, not prerender
  const token = await getSessionToken();
  return token ? resolveSession(getDb(), token) : null;
}

/** Admin shell guard: throws AuthError(401) logged-out, AuthError(403) non-admin. */
export async function requireAdmin(): Promise<Actor> {
  return requirePermission(await getActor(), "admin:*");
}

/**
 * Seller shell guard: authenticated + owns/staffs at least one shop.
 * ADMIN bypasses via requirePermission's global rule.
 */
export async function requireSeller(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AuthError("UNAUTHORIZED", 401);
  if (actor.roles.includes("ADMIN")) return actor;
  const shopId = actor.memberships[0]?.shopId;
  if (!shopId) throw new AuthError("FORBIDDEN", 403);
  return requirePermission(actor, "shop:manage", { shopId });
}
