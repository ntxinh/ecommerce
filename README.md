# MarketFlow

A multi-vendor e-commerce marketplace built as a modular monolith: Next.js 16
(App Router) + React 19, SQLite via Drizzle, localized storefront (en/vi),
Seller Center, and Admin Console. Educational project — payments, shipping,
and email are deterministic in-process mocks/adapters.

> ⚠️ **Demo credentials below are for local development only. Never deploy
> this seed data (or these passwords) to production.**

## Current features

- Localized storefront shell (`/en`, `/vi`) with Light/Dark/System theme
- Registration, login, logout — opaque `ulid.secret` sessions (sha256 stored,
  HttpOnly/SameSite=Lax cookie, 30d sliding TTL)
- Password reset + email verification via dev mailbox (`mailbox/*.json`)
- Role + shop-membership authorization (`CUSTOMER`/`SELLER`/`ADMIN`,
  OWNER/STAFF memberships — ADMIN bypasses all checks, see
  [authorization](docs/security/authorization.md))
- Guarded Seller Center and Admin Console shells
- `GET /api/v1/health`; structured pino logging with secret redaction;
  env-gated OTel tracing
- Seeded demo shop, seller application, and application settings

Planned: catalog, cart, checkout, orders, payments, shipping, returns, reviews,
notifications, finance — see [implementation plan](docs/roadmap/implementation-plan.md).

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui (radix-nova)
· Drizzle ORM + better-sqlite3 (WAL) · next-intl · next-themes · Zod ·
argon2id (`@node-rs/argon2`) · pino + `@vercel/otel` · Biome · Vitest ·
Playwright · pnpm 9 · Node 22 (see `mise.toml`)

## Quick start

```bash
mise install            # or: Node 22 + pnpm 9
cp .env.example .env    # safe defaults
make setup              # pnpm install + next typegen
make db-reset           # create + migrate + seed data/marketflow.db
make dev                # http://localhost:3000 → /en
```

## Commands

| Command | What it does |
|---|---|
| `make dev` / `make build` | dev server / production build |
| `make lint` / `make format` | Biome check / write fixes |
| `make typecheck` | `next typegen` + `tsc --noEmit` |
| `make test` | unit + integration (Vitest) |
| `make test-e2e` | Playwright against `next start` |
| `make check` | lint + typecheck + test |
| `make verify` | `check` + build + e2e (full gate) |
| `make db-generate` / `db-migrate` / `db-seed` / `db-reset` | Drizzle pipeline (db scripts need `NODE_OPTIONS=--conditions=react-server` — already in the Makefile) |

## Environment

All server vars are Zod-validated in `src/env.ts`. `.env.example`:

| Var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `file:./data/marketflow.db` | SQLite file path |
| `APP_ENV` | `development` | `development`/`test`/`production`; Secure cookies in production |
| `SESSION_COOKIE_NAME` | `marketflow_session` | |
| `API_DOCS_ENABLED` | `false` | Planned: enables Scalar UI at `/api/docs` |
| `INTERNAL_CRON_TOKEN` | `dev-cron-token` | Guards planned `/api/v1/internal/*` |
| `LOG_LEVEL` | `info` | pino level — read from `process.env` directly, not schema-validated |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | set to enable OTel export — read from `process.env` directly, not schema-validated |

## Demo accounts

| Email | Password | Roles / access |
|---|---|---|
| `admin@marketflow.dev` | `Marketflow123!` | ADMIN + CUSTOMER — admin console, everything |
| `seller@marketflow.dev` | `Marketflow123!` | SELLER + CUSTOMER — OWNER of shop "Saigon Crafts" |
| `seller2@marketflow.dev` | `Marketflow123!` | CUSTOMER — has a PENDING seller application |
| `customer@marketflow.dev` | `Marketflow123!` | CUSTOMER |

Password reset/verify "emails" appear in `mailbox/` as JSON files.

## Architecture

Dependency direction: `app → features → server/modules → server/db`; every
`src/server/**` file opens with `import "server-only"`. See
[system architecture](docs/architecture/system-architecture.md),
[module boundaries](docs/architecture/module-boundaries.md), and the
[docs tree](docs/) for data model, security, workflows, and ops.

## OpenAPI / Scalar

Planned — `docs/api/openapi.yaml` + Scalar at `/api/docs` behind
`API_DOCS_ENABLED=true` (see [api conventions](docs/api/api-conventions.md)).

## Troubleshooting

- `server-only` errors when running db scripts → use the Makefile targets
  (they set `--conditions=react-server`).
- Stale route types → `pnpm next typegen`.
- Broken/locked dev DB → `make db-reset` (destructive, dev only).

## Current limitations

Single-instance in-memory rate limiting, dev-mailbox email delivery, URL-only
image "uploads", and more —
see [known-limitations](docs/roadmap/known-limitations.md).

## PostgreSQL migration

SQLite-first by design; port path documented in
[sqlite-postgresql-portability](docs/database/sqlite-postgresql-portability.md).
