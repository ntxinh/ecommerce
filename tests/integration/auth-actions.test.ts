import { describe, expect, it } from "vitest";
import {
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  ResetRequestInput,
} from "@/server/api/contracts/auth";
import { sessionCookieOptions } from "@/server/auth/cookies";

describe("auth contracts", () => {
  it("accepts a valid registration and rejects a short password", () => {
    expect(
      RegisterInput.safeParse({
        email: "a@b.dev",
        name: "Alice",
        password: "password123",
      }).success,
    ).toBe(true);
    expect(
      RegisterInput.safeParse({ email: "a@b.dev", name: "A", password: "short" }).success,
    ).toBe(false);
    expect(
      RegisterInput.safeParse({ email: "not-an-email", name: "A", password: "x".repeat(9) })
        .success,
    ).toBe(false);
  });

  it("accepts login + reset shapes", () => {
    expect(LoginInput.safeParse({ email: "a@b.dev", password: "x" }).success).toBe(true);
    expect(ResetRequestInput.safeParse({ email: "a@b.dev" }).success).toBe(true);
    expect(
      ResetPasswordInput.safeParse({ token: "x".repeat(10), password: "password123" }).success,
    ).toBe(true);
    expect(ResetPasswordInput.safeParse({ token: "short", password: "password123" }).success).toBe(
      false,
    );
  });
});

describe("session cookie options", () => {
  it("is HttpOnly, SameSite=Lax, root path, non-Secure outside prod", () => {
    const o = sessionCookieOptions();
    expect(o.name).toBe("marketflow_session");
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe("lax");
    expect(o.path).toBe("/");
    expect(o.secure).toBe(false); // APP_ENV=test
  });
});
