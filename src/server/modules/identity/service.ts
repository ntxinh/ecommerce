import "server-only";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import { deliverMail } from "@/server/auth/dev-mailbox";
import { hashPassword, verifyPassword } from "@/server/auth/passwords";
import { revokeAllSessions } from "@/server/auth/sessions";
import { generateToken, hashToken } from "@/server/auth/tokens";
import type { DB } from "@/server/db/client";
import { passwordResetTokens, userRoles, users } from "@/server/db/schema";

export type User = typeof users.$inferSelect;

const TOKEN_TTL_MS = 30 * 60 * 1000; // password-reset / email-verify tokens live 30min

export async function register(
  db: DB,
  input: { email: string; name: string; password: string },
): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const taken = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  if (taken) throw new AuthError("EMAIL_TAKEN", 409);

  const passwordHash = await hashPassword(input.password);
  return db.transaction((tx) => {
    const now = Date.now();
    const user = tx
      .insert(users)
      .values({
        id: `usr_${ulid()}`,
        email,
        name: input.name,
        passwordHash,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    tx.insert(userRoles).values({ userId: user.id, role: "CUSTOMER" }).run();
    return user;
  });
}

// Argon2 hash of "dummy-password": keeps authenticate's timing constant for
// unknown/suspended users, so responses can't probe email existence.
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$+1Q669kD8UlaZbLEQzGNEg$h4hT7ObJy7d0Lq6Cy9zpsztT/PTLJpkWELCRB3SE0KY";

export async function authenticate(
  db: DB,
  input: { email: string; password: string },
): Promise<User | null> {
  const user = db
    .select()
    .from(users)
    .where(eq(users.email, input.email.trim().toLowerCase()))
    .get();
  // Always run the argon2 verify so non-ACTIVE/unknown users take the same path.
  const ok = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, input.password);
  if (!ok || !user || user.status !== "ACTIVE") return null;
  return user;
}

function issueToken(db: DB, userId: string, kind: "reset" | "verify"): string {
  const { token, tokenHash } = generateToken();
  db.insert(passwordResetTokens)
    .values({ id: `prt_${ulid()}`, userId, tokenHash, kind, expiresAt: Date.now() + TOKEN_TTL_MS })
    .run();
  return token;
}

function consumeToken(db: DB, token: string, kind: "reset" | "verify") {
  const row = db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, hashToken(token)))
    .get();
  if (!row || row.kind !== kind || row.usedAt !== null || row.expiresAt <= Date.now()) return null;
  db.update(passwordResetTokens)
    .set({ usedAt: Date.now() })
    .where(eq(passwordResetTokens.id, row.id))
    .run();
  return row;
}

export async function createPasswordReset(
  db: DB,
  email: string,
): Promise<{ token: string; user: User } | null> {
  const user = db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();
  if (!user) return null; // never leak whether the email exists
  const token = issueToken(db, user.id, "reset");
  deliverMail("reset", user.email, { token });
  return { token, user };
}

export async function resetPassword(db: DB, token: string, newPassword: string): Promise<boolean> {
  const passwordHash = await hashPassword(newPassword);
  return db.transaction((tx) => {
    const row = consumeToken(tx, token, "reset");
    if (!row) return false;
    tx.update(users)
      .set({ passwordHash, updatedAt: Date.now() })
      .where(eq(users.id, row.userId))
      .run();
    revokeAllSessions(tx, row.userId);
    return true;
  });
}

export async function sendVerification(db: DB, userId: string): Promise<void> {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return;
  const token = issueToken(db, user.id, "verify");
  deliverMail("verify", user.email, { token });
}

export async function verifyEmail(db: DB, token: string): Promise<boolean> {
  return db.transaction((tx) => {
    const row = consumeToken(tx, token, "verify");
    if (!row) return false;
    const now = Date.now();
    tx.update(users)
      .set({ emailVerifiedAt: now, updatedAt: now })
      .where(eq(users.id, row.userId))
      .run();
    return true;
  });
}

/** A consumed verify-token whose user ended up verified — lets the page render success on repeat visits. */
export function isConsumedVerifyToken(db: DB, token: string): boolean {
  const row = db
    .select({ usedAt: passwordResetTokens.usedAt, verified: users.emailVerifiedAt })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashToken(token)),
        eq(passwordResetTokens.kind, "verify"),
      ),
    )
    .get();
  return Boolean(row && row.usedAt !== null && row.verified !== null);
}
