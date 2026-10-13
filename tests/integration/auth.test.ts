import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { checkRateLimit } from "@/server/auth/rate-limit";
import { createSession, resolveSession } from "@/server/auth/sessions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import {
  authenticate,
  createPasswordReset,
  register,
  resetPassword,
  sendVerification,
  verifyEmail,
} from "@/server/modules/identity/service";

const PATH = "./tests/.tmp/auth-test.db";
let db: DB;

/** Dev mailbox adapter drops one JSON file per message; read the token back. */
function mailToken(kind: "reset" | "verify", to: string): string {
  const file = readdirSync("mailbox")
    .filter((f) => f.endsWith(`-${to}.json`))
    .map(
      (f) =>
        JSON.parse(readFileSync(join("mailbox", f), "utf8")) as {
          kind: string;
          payload: { token: string };
        },
    )
    .filter((m) => m.kind === kind)
    .at(-1);
  if (!file) throw new Error(`no ${kind} mail for ${to}`);
  return file.payload.token;
}

beforeAll(() => {
  rmSync(PATH, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
});

describe("identity service", () => {
  it("registers and rejects duplicate email", async () => {
    const user = await register(db, { email: "a@b.dev", name: "A", password: "pw" });
    expect(user.email).toBe("a@b.dev");
    await expect(register(db, { email: "a@b.dev", name: "B", password: "x" })).rejects.toThrowError(
      /EMAIL_TAKEN/,
    );
  });

  it("authenticates only on correct password + active status", async () => {
    expect(await authenticate(db, { email: "a@b.dev", password: "bad" })).toBeNull();
    expect(await authenticate(db, { email: "nobody@x.dev", password: "pw" })).toBeNull();
    expect((await authenticate(db, { email: "a@b.dev", password: "pw" }))?.email).toBe("a@b.dev");

    db.update(users).set({ status: "SUSPENDED" }).where(eq(users.email, "a@b.dev")).run();
    expect(await authenticate(db, { email: "a@b.dev", password: "pw" })).toBeNull();
    db.update(users).set({ status: "ACTIVE" }).where(eq(users.email, "a@b.dev")).run();
  });

  it("normalizes email case and whitespace across boundaries", async () => {
    const user = await register(db, { email: "  Case@Test.Dev ", name: "C", password: "pw" });
    expect(user.email).toBe("case@test.dev");
    expect((await authenticate(db, { email: "case@test.dev", password: "pw" }))?.id).toBe(user.id);
    await expect(
      register(db, { email: "CASE@test.dev", name: "C2", password: "x" }),
    ).rejects.toThrowError(/EMAIL_TAKEN/);
  });

  it("creates and resolves a session into an actor", async () => {
    const user = await authenticate(db, { email: "a@b.dev", password: "pw" });
    if (!user) throw new Error("expected user");
    const { token, expiresAt } = await createSession(db, user.id);
    expect(expiresAt).toBeGreaterThan(Date.now() + 29 * 86400 * 1000);

    const actor = await resolveSession(db, token);
    expect(actor?.userId).toBe(user.id);
    expect(actor?.roles).toContain("CUSTOMER");
    expect(actor?.memberships).toEqual([]);

    expect(await resolveSession(db, "bogus.token")).toBeNull();
  });

  it("password reset: unknown email null, valid token resets + revokes sessions", async () => {
    expect(await createPasswordReset(db, "nobody@x.dev")).toBeNull();

    const user = await authenticate(db, { email: "a@b.dev", password: "pw" });
    if (!user) throw new Error("expected user");
    const { token } = await createSession(db, user.id);
    const reset = await createPasswordReset(db, "a@b.dev");
    expect(reset?.token.split(".")).toHaveLength(2);
    expect(mailToken("reset", "a@b.dev")).toBe(reset?.token);

    expect(await resetPassword(db, "bogus", "newpw")).toBe(false);
    if (!reset) throw new Error("expected reset");
    expect(await resetPassword(db, reset.token, "newpw")).toBe(true);
    // token consumed; sessions revoked; new password works
    expect(await resetPassword(db, reset.token, "another")).toBe(false);
    expect(await resolveSession(db, token)).toBeNull();
    expect(await authenticate(db, { email: "a@b.dev", password: "pw" })).toBeNull();
    expect(await authenticate(db, { email: "a@b.dev", password: "newpw" })).not.toBeNull();
  });

  it("email verification shares the token table via kind", async () => {
    const user = await authenticate(db, { email: "a@b.dev", password: "newpw" });
    if (!user) throw new Error("expected user");
    await sendVerification(db, user.id);

    expect(await verifyEmail(db, "bogus")).toBe(false);
    // a reset token must not satisfy kind="verify"
    await createPasswordReset(db, "a@b.dev");
    expect(await verifyEmail(db, mailToken("reset", "a@b.dev"))).toBe(false);
    expect(await verifyEmail(db, mailToken("verify", "a@b.dev"))).toBe(true);
    const refreshed = db.select().from(users).where(eq(users.id, user.id)).get();
    expect(refreshed?.emailVerifiedAt).not.toBeNull();
    // consumed
    expect(await verifyEmail(db, mailToken("verify", "a@b.dev"))).toBe(false);
  });
});

describe("rate limit", () => {
  it("blocks calls past the limit", () => {
    const key = `rl-${Date.now()}`;
    for (let i = 0; i < 5; i++) expect(checkRateLimit(key, 5, 60)).toBe(true);
    expect(checkRateLimit(key, 5, 60)).toBe(false);
  });
});
