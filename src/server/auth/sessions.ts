import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/server/db/client";
import { sessions, shopMemberships, userRoles, users } from "@/server/db/schema";
import type { Actor } from "./permissions";
import { generateToken, hashToken } from "./tokens";

const SESSION_TTL_MS = 30 * 86400 * 1000;
const SESSION_RENEW_MS = 15 * 86400 * 1000;
const now = () => Date.now();

export async function createSession(
  db: DB,
  userId: string,
): Promise<{ token: string; expiresAt: number }> {
  const { token, tokenHash } = generateToken();
  const expiresAt = now() + SESSION_TTL_MS;
  db.insert(sessions)
    .values({ id: token.split(".")[0], userId, tokenHash, expiresAt, createdAt: now() })
    .run();
  return { token, expiresAt };
}

export async function resolveSession(db: DB, token: string): Promise<Actor | null> {
  const session = db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .get();
  if (!session || session.expiresAt <= now()) return null;

  const user = db.select().from(users).where(eq(users.id, session.userId)).get();
  if (user?.status !== "ACTIVE") return null;

  // Sliding renewal: under 15d remaining → extend to a fresh 30d.
  if (session.expiresAt - now() < SESSION_RENEW_MS) {
    const expiresAt = now() + SESSION_TTL_MS;
    db.update(sessions).set({ expiresAt }).where(eq(sessions.id, session.id)).run();
    session.expiresAt = expiresAt;
  }

  const roles = db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, user.id))
    .all()
    .map((r) => r.role);
  const memberships = db
    .select()
    .from(shopMemberships)
    .where(eq(shopMemberships.userId, user.id))
    .all()
    .map((m) => ({
      shopId: m.shopId,
      role: m.role,
      permissions: z.array(z.string()).parse(JSON.parse(m.permissions)),
    }));

  return { userId: user.id, roles, memberships };
}

export async function revokeSession(db: DB, tokenHash: string): Promise<void> {
  db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
}

export async function revokeAllSessions(db: DB, userId: string): Promise<void> {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}
