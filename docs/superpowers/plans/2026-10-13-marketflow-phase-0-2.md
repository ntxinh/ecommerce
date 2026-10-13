# MarketFlow Phase 0–2 (Foundation + Identity + Shells) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Next.js 16 app with the full dev toolchain, Drizzle/SQLite identity schema + seed infra, session auth with role/shop permissions, and locale-aware storefront / Seller Center / Admin shells — the foundation every later slice builds on.

**Architecture:** Modular monolith. `src/app` routes → `src/server/modules/*` services → `src/server/db` repos. Business rules never in components. Server-only code guarded by `server-only` package.

**Tech Stack:** Next.js 16 (App Router), React 19, TS strict, Tailwind v4, shadcn/ui, pnpm, Drizzle + better-sqlite3, Vitest 3, Playwright, Biome, next-intl, next-themes, zod, @node-rs/argon2, pino, @vercel/otel, ulidx.

**Spec:** `docs/superpowers/specs/2026-10-13-marketflow-design.md` (decisions) + `docs/marketflow-marketplace-build-prompt.md` (requirements).

## Global Constraints

- Money: `integer` minor units, `_vnd` suffix, whole đồng. Timestamps: `integer` unixepoch UTC, `_at` suffix. IDs: `text` ULID via `ulidx`.
- Locales: `en` (default) + `vi`; all user-facing strings via `next-intl` dictionaries. Currency VND via `src/lib/format.ts`.
- Never import `src/server/*` into client components; every `src/server/**` module's first line: `import "server-only";`.
- Env validated by Zod in `src/env.ts` (server vars only — no `NEXT_PUBLIC_` for security policy).
- All mutating form posts via Server Actions; shared request shapes via Ky + route handlers under `/api/v1` only when needed by tests/third parties.
- pnpm for all installs. `make` targets must do exactly what they say.
- Every task commits. `make check` must pass at each task boundary.

---

### Task 1: Scaffold + toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/*` (via create-next-app), `biome.json`, `mise.toml`, `Makefile`, `.editorconfig`, `.env.example`, `src/env.ts`, `vitest.config.ts`
- Test: `tests/unit/env.test.ts`

**Interfaces:**
- Produces: `src/env.ts` exports `env` (typed, Zod-parsed). Later tasks import `env` — never `process.env` — for config.
- `env` schema (used verbatim later): `DATABASE_URL` (default `file:./data/marketflow.db`), `APP_ENV` (`development|test|production`), `SESSION_COOKIE_NAME` (default `marketflow_session`), `API_DOCS_ENABLED` (`"true"|"false"`, default `"false"`), `INTERNAL_CRON_TOKEN` (default `"dev-cron-token"`).

- [ ] **Step 1: Scaffold**

```bash
pnpm dlx create-next-app@latest . --ts --tailwind --eslint=false --app --src-dir --import-alias "@/*" --use-pnpm --turbopack
# if prompted about Biome/linter: choose none (we add Biome ourselves)
rm -rf .eslintrc* eslint.config.* 
pnpm add -D @biomejs/biome vitest @vitejs/plugin-react jsdom
pnpm add zod
```

- [ ] **Step 2: Biome, mise, editorconfig, env example**

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.2.0/schema.json",
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "double", "semicolons": "always" } },
  "files": { "includes": ["src/**", "tests/**", "scripts/**", "*.ts", "*.json"] }
}
```

`mise.toml`:
```toml
[tools]
node = "22"
pnpm = "9"
```

`.env.example`:
```bash
DATABASE_URL="file:./data/marketflow.db"
APP_ENV="development"
SESSION_COOKIE_NAME="marketflow_session"
API_DOCS_ENABLED="false"
INTERNAL_CRON_TOKEN="dev-cron-token"
```

- [ ] **Step 3: `src/env.ts`**

```ts
import "server-only";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().default("file:./data/marketflow.db"),
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  SESSION_COOKIE_NAME: z.string().default("marketflow_session"),
  API_DOCS_ENABLED: z.enum(["true", "false"]).default("false"),
  INTERNAL_CRON_TOKEN: z.string().default("dev-cron-token"),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
```

Note: `server-only` package added in Task 3; until then this file omits that import — add `"server-only"` to deps in Task 3 and uncomment. To keep Task 1 self-contained, write the file WITHOUT `import "server-only"` and let Task 3 add it.

- [ ] **Step 4: Failing test** `tests/unit/env.test.ts`

```ts
import { describe, expect, it } from "vitest";

describe("env", () => {
  it("parses defaults", async () => {
    const { env } = await import("@/env");
    expect(env.DATABASE_URL).toContain("file:");
    expect(env.APP_ENV).toBe("development");
  });
});
```

`vitest.config.ts`:
```ts
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts?(x)", "tests/integration/**/*.test.ts?(x)"],
    env: { APP_ENV: "test", DATABASE_URL: "file:./tests/.tmp/test.db" },
  },
});
```
(add `vite-tsconfig-paths` to devDeps)

- [ ] **Step 5: Makefile + verify**

```make
.PHONY: setup dev build lint format typecheck test test-unit test-integration test-e2e \
        db-generate db-migrate db-seed db-reset check verify

setup: ; pnpm install
dev: ; pnpm dev
build: ; pnpm build
lint: ; pnpm biome check .
format: ; pnpm biome check --write .
typecheck: ; pnpm tsc --noEmit
test: test-unit test-integration
test-unit: ; pnpm vitest run tests/unit
test-integration: ; pnpm vitest run tests/integration
test-e2e: ; pnpm playwright test
db-generate: ; pnpm drizzle-kit generate
db-migrate: ; pnpm tsx scripts/db-migrate.ts
db-seed: ; pnpm tsx scripts/db-seed.ts
db-reset: ; rm -f data/marketflow.db && $(MAKE) db-migrate db-seed
check: lint typecheck test
verify: check build test-e2e
```

Run: `pnpm vitest run tests/unit` → PASS. `pnpm tsc --noEmit` → PASS. `pnpm biome check .` → fix/ignore generated `components.json` noise. Commit: `chore: scaffold + toolchain`.

---

### Task 2: i18n + theming + root layout

**Files:**
- Create: `src/i18n/routing.ts`, `src/i18n/request.ts`, `src/middleware.ts`, `messages/en.json`, `messages/vi.json`, `src/app/[locale]/layout.tsx`, `src/app/[locale]/page.tsx`, `src/app/layout.tsx` (minimal passthrough), `src/lib/format.ts`
- Modify: `next.config.ts`
- Test: `tests/unit/i18n-parity.test.ts`, `tests/unit/format.test.ts`

**Interfaces:**
- Produces: `LOCALES = ["en","vi"]`, `formatVnd(minorUnits: number): string`, `formatDate(epoch: number, locale): string` in `src/lib/format.ts`; `routing`/`getRequestConfig` wired so every page lives under `[locale]`.
- Consumes: `env` from Task 1 (indirect — no env needed here).

- [ ] **Step 1: Install + wire next-intl, next-themes**

```bash
pnpm add next-intl next-themes
```

`next.config.ts`:
```ts
import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    }];
  },
};
export default withNextIntl(config);
```

`src/i18n/routing.ts`:
```ts
import { defineRouting } from "next-intl/routing";
export const LOCALES = ["en", "vi"] as const;
export type Locale = (typeof LOCALES)[number];
export const routing = defineRouting({ locales: LOCALES, defaultLocale: "en" });
export { Link, redirect, usePathname, useRouter } from "@/i18n/navigation";
```

`src/i18n/navigation.ts`:
```ts
import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
```

`src/i18n/request.ts`:
```ts
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale as never)) locale = routing.defaultLocale;
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
```

`src/middleware.ts`:
```ts
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
export default createMiddleware(routing);
export const config = { matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"] };
```

- [ ] **Step 2: Messages + format**

`messages/en.json` (minimal — grows with features):
```json
{
  "common": { "appName": "MarketFlow", "signIn": "Sign in", "signOut": "Sign out", "register": "Create account" },
  "auth": { "email": "Email", "password": "Password", "loginTitle": "Sign in to MarketFlow", "registerTitle": "Create your account", "invalidCredentials": "Invalid email or password", "resetTitle": "Reset password", "resetSent": "If that email exists, a reset link was created" },
  "nav": { "storefront": "Shop", "sellerCenter": "Seller Center", "admin": "Admin", "cart": "Cart", "account": "Account" },
  "theme": { "light": "Light", "dark": "Dark", "system": "System" }
}
```
`messages/vi.json`: same keys, Vietnamese values.

`src/lib/format.ts` (no server-only — used client-side too):
```ts
export function formatVnd(minorUnits: number, locale = "vi-VN"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(minorUnits);
}
export function formatDate(epochSeconds: number, locale = "en"): string {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium" }).format(epochSeconds * 1000);
}
```

- [ ] **Step 3: Failing tests**

`tests/unit/i18n-parity.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import vi from "../../messages/vi.json";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
}
describe("i18n parity", () => {
  it("en and vi have identical key sets", () => {
    expect(keys(vi).sort()).toEqual(keys(en).sort());
  });
});
```

`tests/unit/format.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatVnd } from "@/lib/format";
describe("formatVnd", () => {
  it("formats whole dong with no decimals", () => {
    expect(formatVnd(150000, "en-US")).toMatch(/150,000/);
    expect(formatVnd(150000, "en-US")).not.toContain(".00");
  });
});
```
- [ ] **Step 4: Root layout + themed shell**


`src/app/[locale]/layout.tsx`:
```tsx
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { ThemeProvider } from "next-themes";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

`src/app/[locale]/page.tsx`: minimal placeholder calling `useTranslations`/`getTranslations` for `common.appName` (replaced by storefront in a later slice). `src/app/layout.tsx` returns `children` (html/body live in locale layout).

- [ ] **Step 5: Verify + commit**

Run: `pnpm vitest run tests/unit` → PASS; `pnpm dev` + curl `localhost:3000/en` renders "MarketFlow", `/vi` renders Vietnamese, `/` redirects to `/en`. Commit `feat: i18n routing + theming`.

---

### Task 3: Drizzle + identity schema + seed infra

**Files:**
- Create: `drizzle.config.ts`, `src/server/db/client.ts`, `src/server/db/schema.ts` (split per domain as files under `src/server/db/schema/`, re-exported), `scripts/db-migrate.ts`, `scripts/db-seed.ts`, `src/server/db/seed/identity.ts`
- Modify: `src/env.ts` (add `import "server-only";` + dep)
- Test: `tests/integration/db.test.ts`

**Interfaces:**
- Produces:
  - `getDb(path?: string): BetterSQLite3Database<Schema>` in `src/server/db/client.ts` — `path` defaults to `env.DATABASE_URL` minus `file:`; PRAGMAs `foreign_keys=ON`, `journal_mode=WAL`.
  - `migrateDb(db)` applies `drizzle/` migrations; `seedIdentity(db)` inserts demo users/roles/shops idempotently (`ON CONFLICT DO NOTHING`).
  - Table exports: `users, userRoles, sessions, passwordResetTokens, shops, shopMemberships, sellerApplications, applicationSettings`.
- Consumes: `env`.

- [ ] **Step 1: Install**

```bash
pnpm add drizzle-orm better-sqlite3 server-only ulidx @node-rs/argon2 pino
pnpm add -D drizzle-kit tsx @types/better-sqlite3
```

`drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL?.replace("file:", "") ?? "./data/marketflow.db" },
});
```

- [ ] **Step 2: Schema** `src/server/db/schema/identity.ts` (re-export from `src/server/db/schema/index.ts`)

```ts
import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  status: text("status", { enum: ["ACTIVE", "SUSPENDED"] }).notNull().default("ACTIVE"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [uniqueIndex("users_email_unique").on(t.email)]);

export const userRoles = sqliteTable("user_roles", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["CUSTOMER", "SELLER", "ADMIN"] }).notNull(),
}, (t) => [uniqueIndex("user_roles_unique").on(t.userId, t.role)]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("sessions_token_hash_unique").on(t.tokenHash), index("sessions_user_idx").on(t.userId)]);

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  kind: text("kind", { enum: ["reset", "verify"] }).notNull().default("reset"),
}, (t) => [uniqueIndex("prt_token_hash_unique").on(t.tokenHash)]);
```

`src/server/db/schema/sellers.ts`:
```ts
import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { users } from "./identity";

export const shops = sqliteTable("shops", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status", { enum: ["ACTIVE", "SUSPENDED"] }).notNull().default("ACTIVE"),
  createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("shops_slug_unique").on(t.slug)]);

export const shopMemberships = sqliteTable("shop_memberships", {
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["OWNER", "STAFF"] }).notNull(),
  permissions: text("permissions").notNull().default("[]"), // JSON array of permission keys
}, (t) => [uniqueIndex("shop_memberships_unique").on(t.shopId, t.userId)]);

export const sellerApplications = sqliteTable("seller_applications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  shopName: text("shop_name").notNull(),
  businessInfo: text("business_info").notNull().default("{}"),
  status: text("status", { enum: ["PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED"] }).notNull().default("PENDING"),
  decidedBy: text("decided_by"),
  decidedAt: integer("decided_at"),
  decisionNote: text("decision_note"),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("seller_apps_status_idx").on(t.status)]);
```

`src/server/db/schema/settings.ts`:
```ts
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
export const applicationSettings = sqliteTable("application_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
});
```

- [ ] **Step 3: Client + migrate + seed scripts**

`src/server/db/client.ts`:
```ts
import "server-only";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "@/env";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;
const cache = new Map<string, DB>();

export function getDb(path = env.DATABASE_URL.replace("file:", "")): DB {
  const cached = cache.get(path);
  if (cached) return cached;
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  cache.set(path, db);
  return db;
}

export function migrateDb(db: DB) {
  migrate(db, { migrationsFolder: "./drizzle" });
}
```

`scripts/db-migrate.ts`: `getDb()` + `migrateDb()`. `scripts/db-seed.ts`: migrate then `seedIdentity(db)`.

`src/server/db/seed/identity.ts` — deterministic ULID-free fixed ids (`usr_admin`, `usr_seller`, `usr_customer`, `shop_1`, ...) so seeds are idempotent on PK conflict; uses argon2 `hash("Marketflow123!")`; inserts admin (ADMIN+CUSTOMER), seller (SELLER+CUSTOMER, OWNER of shop_1 "Saigon Crafts"), seller2 (PENDING application), customer (CUSTOMER); settings: `commission_rate_bps=500`, `return_window_days=7`, `auto_complete_days=3`, `currency=VND`, `reservation_ttl_minutes=15`.

- [ ] **Step 4: Integration test** `tests/integration/db.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { getDb, migrateDb } from "@/server/db/client";
import { seedIdentity } from "@/server/db/seed/identity";
import { users } from "@/server/db/schema";

const PATH = "./tests/.tmp/db-test.db";

describe("db", () => {
  it("migrates and seeds idempotently", () => {
    rmSync(PATH, { force: true });
    const db = getDb(PATH);
    migrateDb(db);
    seedIdentity(db);
    seedIdentity(db); // second run must not throw or duplicate
    const rows = db.select().from(users).all();
    expect(rows.filter((u) => u.email === "admin@marketflow.dev")).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Generate migration, run, commit**

```bash
pnpm drizzle-kit generate && pnpm tsx scripts/db-migrate.ts && pnpm tsx scripts/db-seed.ts
pnpm vitest run tests/integration
```
Expected: PASS, `data/marketflow.db` exists, 4 users seeded. Commit `feat: drizzle schema + identity seed`.

---

### Task 4: Auth service + sessions + permissions

**Files:**
- Create: `src/server/auth/passwords.ts`, `src/server/auth/tokens.ts`, `src/server/auth/sessions.ts`, `src/server/auth/permissions.ts`, `src/server/auth/rate-limit.ts`, `src/server/auth/dev-mailbox.ts`, `src/server/modules/identity/service.ts`
- Test: `tests/unit/auth.test.ts`, `tests/integration/auth.test.ts`

**Interfaces:**
- Produces (later tasks/routes consume exactly these):
  - `hashPassword(pw: string): Promise<string>`, `verifyPassword(hash, pw): Promise<boolean>`
  - `generateToken(): { token: string; tokenHash: string }`, `hashToken(token): string`
  - `createSession(db, userId): Promise<{ token, expiresAt }>` — token = `${sessionId}.${secret}`; stores `sha256(token)`
  - `resolveSession(db, token): Promise<Actor | null>` — validates expiry, slides expiry forward when < 15d remain, rotates nothing else
  - `revokeSession(db, tokenHash)`, `revokeAllSessions(db, userId)`
  - `type Actor = { userId: string; roles: Role[]; memberships: { shopId: string; role: "OWNER"|"STAFF"; permissions: string[] }[] }`
  - `requirePermission(actor: Actor | null, perm: Permission, ctx?: { shopId?: string }): Actor` — throws `AuthError("UNAUTHORIZED"|"FORBIDDEN")`
  - `register(db, {email,name,password}): Promise<User>`, `authenticate(db, {email,password}): Promise<User | null>`, `createPasswordReset(db, email): Promise<{token, user} | null>` (null on unknown email — never leak), `resetPassword(db, token, newPw): Promise<boolean>`, `sendVerification(db, userId): Promise<void>` + `verifyEmail(db, token): Promise<boolean>` (dev adapter; shares `password_reset_tokens` via `kind` column `"reset"|"verify"` — add `kind: text("kind").notNull().default("reset")` to that table in Task 3's schema)
  - `checkRateLimit(key: string, limit: number, windowSec: number): boolean` (in-memory)
  - `deliverMail(kind: "reset"|"verify", to: string, payload: object): void` — writes `mailbox/<ts>-<to>.json` + pino log
- Consumes: `getDb`, schema tables, `env.SESSION_COOKIE_NAME` (cookie set in Task 5).

- [ ] **Step 1: Failing unit test** `tests/unit/auth.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/passwords";
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
  it("denies cross-shop access", async () => {
    const { requirePermission } = await import("@/server/auth/permissions");
    const staff = { userId: "u1", roles: ["SELLER"], memberships: [{ shopId: "s1", role: "STAFF", permissions: ["product:write"] }] };
    expect(() => requirePermission(staff as never, "product:write", { shopId: "s1" })).not.toThrow();
    expect(() => requirePermission(staff as never, "product:write", { shopId: "s2" })).toThrowError(/FORBIDDEN/);
    expect(() => requirePermission(null, "product:write")).toThrowError(/UNAUTHORIZED/);
  });
});
```

- [ ] **Step 2: Implement**

`passwords.ts`: argon2id `hash`/`verify` wrappers.
`tokens.ts`: `crypto.randomBytes(32).toString("hex")` secret + `ulid()` id; `hashToken = sha256 hex`.
`sessions.ts`: create/resolve/revoke; `SESSION_TTL = 30*86400`, `SESSION_RENEW = 15*86400`; `resolveSession` loads session by `tokenHash`, joins user, loads roles + memberships into `Actor`.
`permissions.ts`: `Permission` union (`"product:read"|"product:write"|"order:read"|"order:write"|"admin:*"|"shop:manage"|...` — start with `product:*`, `order:*`, `admin:*`, `shop:manage`, `seller:apply`); matrix: ADMIN → all global perms; OWNER → all shop-scoped perms for own shops; STAFF → their `permissions` array; CUSTOMER → `seller:apply`, own-resource perms. Shop-scoped check requires `ctx.shopId` ∈ memberships.
`rate-limit.ts`: `Map<key, number[]>` sliding window.
`dev-mailbox.ts`: `fs.mkdirSync("mailbox",{recursive:true})` + write JSON + `logger.info({kind,to},"dev mail")`.
`identity/service.ts`: `register` (email unique → `EMAIL_TAKEN` AuthError), `authenticate` (verify + status check → null), `createPasswordReset` (token row + `deliverMail`), `resetPassword` (token valid+unused+unexpired → update hash, mark used, revoke all sessions).

- [ ] **Step 3: Integration test** `tests/integration/auth.test.ts` — fresh DB per file: register → duplicate email → `EMAIL_TAKEN`; authenticate wrong pw → null; createSession → resolveSession → actor with roles; resetPassword flow via token hash lookup; `checkRateLimit` blocks 6th call.

- [ ] **Step 4: Verify + commit** `pnpm vitest run` → PASS. Commit `feat: auth services + permissions`.

---

### Task 5: Auth routes, server actions, login/register/reset pages

**Files:**
- Create: `src/server/api/errors.ts`, `src/server/api/contracts/auth.ts`, `src/server/auth/cookies.ts`, `src/app/[locale]/(auth)/login/page.tsx`, `.../register/page.tsx`, `.../reset/page.tsx`, `.../reset/[token]/page.tsx`, `.../verify/[token]/page.tsx`, `src/features/auth/actions.ts`, `src/app/api/v1/health/route.ts`
- Test: `tests/integration/auth-actions.test.ts` (call actions with temp DB via `vitest` node env + `next/headers` mock is painful → instead test the service layer already covered; here test Zod contracts + cookie helper pure parts)

**Interfaces:**
- Consumes: everything from Task 4; `env.SESSION_COOKIE_NAME`.
- Produces: `setSessionCookie(token, expiresAt)`, `clearSessionCookie()`; server actions `loginAction`, `registerAction`, `logoutAction`, `requestResetAction`, `resetPasswordAction`, `sendVerificationAction` — each returns `{ ok: true, redirect?: string } | { ok: false; error: string; fieldErrors?: Record<string,string> }`; `AuthError { code: ErrorCode; status: number }` + `toErrorResponse(err)` in `src/server/api/errors.ts` for route handlers.

- [ ] **Step 1: Contracts + errors**

`src/server/api/contracts/auth.ts`:
```ts
import { z } from "zod";
export const RegisterInput = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(128),
});
export const LoginInput = z.object({ email: z.string().email(), password: z.string().min(1).max(128) });
export const ResetRequestInput = z.object({ email: z.string().email() });
export const ResetPasswordInput = z.object({ token: z.string().min(10), password: z.string().min(8).max(128) });
```

`src/server/api/errors.ts`: `class AuthError extends Error { constructor(public code: string, public status = 400) }`; `toErrorResponse(e)` → `{ error: { code, message } }` + status.

- [ ] **Step 2: Cookies + actions**

`src/server/auth/cookies.ts`: `cookies()` from `next/headers`; `setSessionCookie` (HttpOnly, SameSite=Lax, Secure in prod, `expires`, path `/`); `clearSessionCookie`; `getSessionToken()`.

`src/features/auth/actions.ts` (`"use server"`): each action → `formData` → Zod safeParse → service call → `checkRateLimit(ipOrEmail)` → cookie set → localized-friendly error codes returned (page maps code → `useTranslations` message). `loginAction`: rate-limit key `login:${email}` 5/60s; on success `resolveSession` cookie set and return `{ok:true}`. `requestResetAction`: always `{ok:true}` (no enumeration). `logoutAction`: revoke + clear cookie.

- [ ] **Step 3: Pages** — Server Components rendering client forms (`features/auth/login-form.tsx` etc. using `useActionState`-style or plain form + `useTransition`). Redirect logged-in users away via `resolveSession` check in page. `/reset/[token]` reads mailbox-delivered token from URL. `/verify/[token]` calls `verifyEmail` and renders success/failure; `sendVerificationAction` (logged-in, rate-limited `verify:${userId}` 3/hr) is reachable from the account page — the optional email-verification path from spec §5 via the dev mailbox.

- [ ] **Step 4: Health route** `src/app/api/v1/health/route.ts`:
```ts
export function GET() {
  return Response.json({ data: { status: "ok" } });
}
```

- [ ] **Step 5: Verify** — dev server: register → lands on `/en` with session cookie; login/logout; wrong password shows error; reset produces `mailbox/*.json` whose `token` completes reset at `/en/reset/<token>`; suspended user login rejected. `make check` PASS. Commit `feat: auth flows + health endpoint`.

---

### Task 6: App shells (storefront / seller / admin) + guards

**Files:**
- Create: `src/components/shared/site-header.tsx`, `site-footer.tsx`, `locale-switcher.tsx`, `theme-switcher.tsx`, `src/components/shared/guards.ts` (`getActor()`, `requireRole()`), `src/app/[locale]/(storefront)/layout.tsx` + home placeholder, `src/app/[locale]/seller/layout.tsx` + `page.tsx`, `src/app/[locale]/admin/layout.tsx` + `page.tsx`, `src/app/[locale]/account/page.tsx`
- Modify: `src/app/[locale]/page.tsx` (move under `(storefront)` group)
- Test: `tests/e2e/auth.spec.ts` (Playwright smoke, installed here)

**Interfaces:**
- Produces: `getActor(): Promise<Actor | null>` (cookie → `resolveSession`), `requireSeller()`, `requireAdmin()` (throw → redirect login or 403 page); `LocaleSwitcher`, `ThemeSwitcher` components used by header.
- Consumes: Tasks 2 (i18n/theme), 4–5 (actor, cookies).

- [ ] **Step 1: `src/server/auth/actor.ts` + guards** — `getActor()` reads `getSessionToken()` → `resolveSession(getDb(), token)`; `requireAdmin`/`requireSeller` wrap `requirePermission`.

- [ ] **Step 2: Shells** — storefront layout: header (logo, nav, search placeholder labeled "Planned", `LocaleSwitcher`, `ThemeSwitcher`, account/cart links) + footer. `seller/layout.tsx` + `admin/layout.tsx`: sidebar shells gated server-side — no actor or wrong role → `redirect("/login")` (admin) / seller-home redirect for non-sellers. Admin page = placeholder counters skeleton labeled "Planned: dashboard metrics". Seller page = shop name + "Planned" sections.

- [ ] **Step 3: shadcn/ui init** — `pnpm dlx shadcn@latest init` (Slate/neutral base, CSS vars), add `button`, `dropdown-menu`, `input`, `label`, `card`, `badge`, `avatar`, `separator`, `sheet`, `skeleton`, `sonner`, `table`. Use `button/dropdown/input/label/card` in header + auth forms (refactor Task 5 forms to shadcn inputs).

- [ ] **Step 4: Playwright** — `pnpm add -D @playwright/test && pnpm playwright install chromium`; `playwright.config.ts` webServer `pnpm dev` port 3100 with `DATABASE_URL=file:./tests/.tmp/e2e.db`; `global-setup.ts` migrates+seeds that DB. `tests/e2e/auth.spec.ts`:
```ts
test("register → login → seller guard", async ({ page }) => {
  await page.goto("/en/register");
  // fill form, submit → redirected, sees account link
  await page.goto("/en/admin"); // → redirected to login (customer lacks ADMIN)
});
```

- [ ] **Step 5: Verify + commit** — `make check` PASS; `pnpm playwright test` PASS; manual: theme toggle persists, `/vi/seller` renders Vietnamese shell. Commit `feat: app shells + e2e harness`.

---

### Task 7: Observability + docs skeleton + repo files

**Files:**
- Create: `src/server/observability/logger.ts`, `instrumentation.ts`, `docs/{requirements,architecture,database,api,security,workflows,testing,operations,roadmap}/*.md` skeletons, `README.md`, `AGENTS.md`, `DESIGN.md`, `lsp.json` or documented decision
- Test: `tests/unit/logger.test.ts`

**Interfaces:**
- Produces: `logger` (pino, redact `password|token|secret|cookie|authorization`), `getRequestLogger(req)`; OTel `register()` — no-op without `OTEL_EXPORTER_OTLP_ENDPOINT`.

- [ ] **Step 1: Logger + test**

```ts
// src/server/observability/logger.ts
import "server-only";
import pino from "pino";
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: ["password", "*.password", "passwordHash", "*.token", "token", "*.secret", "cookie", "headers.cookie", "headers.authorization"], censor: "[redacted]" },
  base: { service: "marketflow" },
});
export function getRequestLogger(requestId: string) {
  return logger.child({ requestId });
}
```

Test asserts `logger.info({ password: "x" })` output contains `[redacted]` via a child with `pino.destination` stream capture or `pino-test` — simplest: assert `logger.levels` config + use `logger` with a `stream` that captures (write test against `redact` via `pino({...}, stream)` instance exported as `createLogger(stream)` for testability).

- [ ] **Step 2: instrumentation.ts**
```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const { registerOTel } = await import("@vercel/otel");
    registerOTel({ serviceName: "marketflow" });
  }
}
```
(pnpm add @vercel/otel)

- [ ] **Step 3: Docs skeletons + repo files** — write each required doc file from spec §25 with `Status: Planned` sections matching current reality (authorization matrix doc gets the Task-4 matrix table; order-lifecycle marked Planned). `README.md` full setup + demo accounts + warning. `AGENTS.md` per spec §24. `DESIGN.md` design tokens (Tailwind theme + shadcn conventions + breakpoints + a11y rules). `lsp.json`: **decision** — no documented consumer schema exists for this filename in the selected toolchain; document that in `docs/operations/local-development.md` and omit the file rather than inventing a schema (spec §24 explicitly permits this). `.editorconfig`. `docs/roadmap/implementation-plan.md` checklist mirroring spec §26 phases with slice-1 boxes checked; `known-limitations.md` seeds with in-memory rate limit, dev mailbox, uploads=URL-only, ledger simplification.

- [ ] **Step 4: Verify + commit** — `make verify` (lint+typecheck+unit+integration+build+e2e) all green. Commit `docs: project docs + observability`.

---

## Post-plan: risks watch-list
- `create-next-app` version drift → if Next.js 16 flags differ, adapt flags, record in known-limitations.
- `@node-rs/argon2` prebuilt binary on this platform → if missing, swap to node `crypto.scrypt` (documented swap, no API change to `hashPassword`/`verifyPassword`).
- `next-intl` middleware matcher vs `[locale]` catch-all — verify `/` redirect in Task 2 smoke.
