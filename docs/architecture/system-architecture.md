# System Architecture

**Status: Implemented (foundation)**

Modular monolith: one Next.js 16 (App Router) deployable, one SQLite database via
Drizzle, designed to port to PostgreSQL (see
[sqlite-postgresql-portability.md](../database/sqlite-postgresql-portability.md)).

```mermaid
flowchart LR
  Browser -->|HTTP| Next["Next.js App Router"]
  Next --> MW["middleware.ts (next-intl locale routing)"]
  Next --> App["src/app — routes, layouts, route handlers"]
  App --> Features["src/features — client feature code"]
  App --> Modules["src/server/modules — business services"]
  Features --> Modules
  Modules --> DB["src/server/db — drizzle schema/client"]
  Modules --> Auth["src/server/auth — sessions, permissions, rate limit"]
  DB --> SQLite[("SQLite (better-sqlite3, WAL)")]
  App --> Obs["src/server/observability — pino logger"]
  Next -.->|register()| OTel["instrumentation.ts → @vercel/otel (env-gated)"]
```

## Layers and dependency direction

`app → features → server/modules → server/db`

- Route handlers and server actions parse input, authorize, delegate to services,
  serialize. Business rules live in `src/server/modules/<domain>`.
- Every file under `src/server/` starts with `import "server-only";` (stubbed in
  Vitest via `tests/server-only.stub.ts`).
- Modules never cross-import another module's internals; they call exported
  service functions.
- Zod contracts under `src/server/api/contracts` stay pure so client code can
  share them.

## Request resolution

- `getActor()` resolves the session cookie to an `Actor` (roles + shop
  memberships) at request time; `requireAdmin()` / `requireSeller()` guard the
  app shells, `requirePermission(actor, perm, {shopId})` guards services.
- Locales: `[locale]` segment with `en` | `vi` via next-intl middleware.
- Theme: `next-themes` class strategy, no-flash init script.

## Environments

Server env is Zod-validated at import in `src/env.ts`. `APP_ENV` ∈
`development|test|production`; `secure` cookies only in production.
