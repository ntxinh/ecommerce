import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { ulid } from "ulidx";

/** Token format: `${ulid}.${64-hex-secret}`; only the sha256 hash is stored. */
export function generateToken(): { token: string; tokenHash: string } {
  const token = `${ulid()}.${randomBytes(32).toString("hex")}`;
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
