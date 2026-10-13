import "server-only";
import { eq } from "drizzle-orm";
import { ulid } from "ulidx";
import { deliverMail } from "@/server/auth/dev-mailbox";
import { hashPassword, verifyPassword } from "@/server/auth/passwords";
import { AuthError } from "@/server/auth/permissions";
import { revokeAllSessions } from "@/server/auth/sessions";
import { generateToken, hashToken } from "@/server/auth/tokens";
import type { DB } from "@/server/db/client";
import { passwordResetTokens, userRoles, users } from "@/server/db/schema";

export type User = typeof users.$inferSelect;

const TOKEN_TTL_MS = 60 * 60 * 1000; // password-reset / email-verify tokens live 1h

export async function register(
  db: DB,
  input: { email: string; name: string; password: string },
): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const taken = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  if (taken) throw new AuthError("EMAIL_TAKEN");

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

export async function authenticate(
  db: DB,
  input: { email: string; password: string },
): Promise<User | null> {
  const user = db
    .select()
    .from(users)
    .where(eq(users.email, input.email.trim().toLowerCase()))
    .get();
  if (user?.status !== "ACTIVE") return null;
  return (await verifyPassword(user.passwordHash, input.password)) ? user : null;
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
  const row = consumeToken(db, token, "reset");
  if (!row) return false;
  db.update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: Date.now() })
    .where(eq(users.id, row.userId))
    .run();
  revokeAllSessions(db, row.userId);
  return true;
}

export async function sendVerification(db: DB, userId: string): Promise<void> {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return;
  const token = issueToken(db, user.id, "verify");
  deliverMail("verify", user.email, { token });
}

export async function verifyEmail(db: DB, token: string): Promise<boolean> {
  const row = consumeToken(db, token, "verify");
  if (!row) return false;
  db.update(users).set({ emailVerifiedAt: Date.now() }).where(eq(users.id, row.userId)).run();
  return true;
}
