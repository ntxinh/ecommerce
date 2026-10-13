import "server-only";
import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { getSessionToken } from "./cookies";
import { type Actor, requirePermission, sellerActor } from "./permissions";
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
  return sellerActor(await getActor());
}
