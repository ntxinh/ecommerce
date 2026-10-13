<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — MarketFlow

Multi-vendor marketplace; modular monolith in one Next.js 16 deployable, SQLite
via Drizzle (Postgres-portable). Educational — payment/shipping/email adapters
are in-process mocks.

## Architecture boundaries

- Dependency direction: `app → features → server/modules → server/db`.
- Every `src/server/**` file starts with `import "server-only";`.
- Business rules live in `src/server/modules/<domain>` services; route
  handlers and server actions only parse → authorize → delegate → serialize.
- Modules call other modules via exported service functions only — never
  cross-import repos/schema internals.
- Zod contracts in `src/server/api/contracts` must stay pure (client-safe).

## Conventions

- IDs: text ULIDs. Money: integer whole đồng, `_vnd` suffix. Timestamps:
  integer unixepoch **milliseconds** `_at` (`Date.now()`-native).
- Authorization: `requirePermission(actor, perm, {shopId})`;
  `requireAdmin()`/`requireSeller()` for shells. ADMIN bypasses all checks
  including shop-scoped (ADR-0001).
- Errors: throw `AuthError`-family codes; serialize via `toErrorResponse()`.
  Never leak internals.
- i18n: no hardcoded user-facing strings; add keys to `messages/en.json` AND
  `messages/vi.json` (parity test enforces).
- Logging: `logger`/`getRequestLogger` from `src/server/observability/logger.ts`.
  Never log secrets — redact paths already cover password/token/secret/
  session/cookie/authorization; extend them for new fields.

## Commands

- Setup: `make setup` then `make db-reset` (destructive recreate + seed).
- Run: `make dev`. Gates: `make check` (lint+typecheck+unit+integration),
  `make verify` (+ build + Playwright). Run `make verify` before considering a
  task done.
- DB: `make db-generate|db-migrate|db-seed|db-reset`. db scripts require
  `NODE_OPTIONS=--conditions=react-server` (Makefile handles it).

## Database safety

- Migrations via drizzle-kit only; never hand-edit applied SQL. Seed must stay
  deterministic and idempotent (`onConflictDoNothing`).
- FKs always explicit; `foreign_keys=ON` and WAL are set in `db/client.ts`.
- No SQLite-isms in services (`strftime`, AUTOINCREMENT reliance) — Postgres
  is the planned prod target.

## Security

- `.env.example` placeholders only; never commit real credentials or
  `data/*.db`, `mailbox/`.
- Parameterized Drizzle queries only. Validate all input with Zod.
- Session tokens and reset tokens are sha256'd at rest; raw values never
  stored or logged.
- Demo password `Marketflow123!` is dev-only.

## Testing

- New logic needs a test: unit for pure rules, integration (real SQLite under
  `tests/.tmp`) for transactional/permissions behavior, Playwright for user
  journeys. i18n key parity and log redaction are guarded by unit tests.

## Docs

- Update the relevant `docs/**` file when a feature lands; mark unbuilt
  sections **Planned**, never describe them as implemented.
- `lsp.json` is deliberately absent (no consumer schema) — see
  `docs/operations/local-development.md`.

## Working style

- Implement incrementally per the roadmap's vertical slices; keep diffs small;
  reuse existing helpers before writing new ones.
