// Mint a session row + token for an e2e user without the login form.
// Usage: node tests/e2e/mint-session.mjs <dbPath> <email>
// Prints the session token (cookie value) on stdout.
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const [dbPath, email] = process.argv.slice(2);
const db = new DatabaseSync(dbPath);
const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
if (!user) {
  console.error(`no user ${email}`);
  process.exit(1);
}
const ulid = () => {
  const C = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; // ULID time+rand layout; only uniqueness matters
  let out = "";
  for (let i = 0; i < 26; i++) out += C[b[Math.floor(i / 8) * 5 + (i % 5)] & 0x1f];
  return out;
};
const id = ulid();
const token = `${id}.${randomBytes(32).toString("hex")}`;
const tokenHash = createHash("sha256").update(token).digest("hex");
db.prepare(
  "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
).run(id, user.id, tokenHash, Date.now() + 30 * 86400 * 1000, Date.now());
console.log(token);
