import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/passwords";
import { type Actor, requirePermission } from "@/server/auth/permissions";
import { generateToken, hashToken } from "@/server/auth/tokens";

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("correct horse");
    expect(h).not.toBe("correct horse");
    expect(await verifyPassword(h, "correct horse")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
  });
});
describe("tokens", () => {
  it("generates id.secret tokens with sha256 hash", () => {
    const { token, tokenHash } = generateToken();
    expect(token.split(".")).toHaveLength(2);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).toBe(tokenHash);
  });
});
describe("permissions", () => {
  it("denies cross-shop access", () => {
    const staff: Actor = {
      userId: "u1",
      roles: ["SELLER"],
      memberships: [{ shopId: "s1", role: "STAFF", permissions: ["product:write"] }],
    };
    expect(() => requirePermission(staff, "product:write", { shopId: "s1" })).not.toThrow();
    expect(() => requirePermission(staff, "product:write", { shopId: "s2" })).toThrowError(
      /FORBIDDEN/,
    );
    expect(() => requirePermission(null, "product:write")).toThrowError(/UNAUTHORIZED/);
  });
});
