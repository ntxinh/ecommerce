import "server-only";
import { cookies } from "next/headers";
import { env } from "@/env";

/** Cookie attributes as sent on responses; exported for tests. */
export function sessionCookieOptions() {
  return {
    name: env.SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.APP_ENV === "production",
    path: "/",
  };
}

// Long fixed browser window (90d): server-side session expiry + sliding
// renewal are authoritative, so a short cookie expiry would log users out
// while their DB session is still being renewed.
const COOKIE_MAX_AGE_MS = 90 * 86400 * 1000;

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  const { name, ...options } = sessionCookieOptions();
  store.set(name, token, { ...options, expires: new Date(Date.now() + COOKIE_MAX_AGE_MS) });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(sessionCookieOptions().name);
}

export async function getSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(env.SESSION_COOKIE_NAME)?.value;
}
