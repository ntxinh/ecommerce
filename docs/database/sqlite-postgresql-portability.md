# SQLite → PostgreSQL Portability

**Status: Designed; migration Planned**

SQLite (better-sqlite3, WAL) is the dev/test store. The schema and services are
written to port to PostgreSQL without redesign.

## Rules in force

- No `strftime`, no `AUTOINCREMENT` semantics, no SQLite-isms in service code.
- Timestamps are integer unixepoch — portable to PG `bigint`.
- Money is integer minor units — portable to PG `bigint`.
- IDs are text ULIDs — portable to `text`/`varchar(26)` PKs.
- JSON columns (`shop_memberships.permissions`, `application_settings.value`)
  stored as `text` today → `jsonb` on PG.
- `better-sqlite3` transactions are synchronous and serialize writers — the
  same `transaction()` call shape maps to `drizzle-orm/node-postgres` async
  transactions, but isolation semantics must be re-checked (e.g. conditional
  `UPDATE ... WHERE` guards remain correct under READ COMMITTED).

## Port checklist (when migrating)

1. Swap dialect in `drizzle.config.ts` (`sqlite` → `postgresql`), regenerate
   migrations.
2. Replace `better-sqlite3` client in `src/server/db/client.ts` with a PG pool
   (`pg` or `postgres.js`); drop the file-path `mkdirSync` handling.
3. `text` JSON columns → `jsonb`; audit `z.parse(JSON.parse(...))` call sites
   (sessions → memberships loader) since `jsonb` returns parsed objects.
4. Service-level `.run()`/`.get()`/`.all()` synchronous calls become awaited
   queries — the largest mechanical change.
5. Keep the integer unixepoch-milliseconds convention; do not adopt
   `timestamptz` columns without a decision.
6. Update `DATABASE_URL` handling in `src/env.ts` (strip `file:` prefix logic).
7. Rate limiter: in-memory Map is single-instance — move to Redis/DB-backed
   limiter if running >1 replica (see known-limitations).
8. Search: `ulower()` registered in `src/server/db/client.ts` is a JS
   `toLowerCase` fold (SQLite `lower()` is ASCII-only, Vietnamese queries need
   real folding) — on PG drop the registration and use `lower()` or `ILIKE`.
   The LIKE tier heuristic in `modules/search` (name > sku/brand > description)
   is the upgrade seam for real FTS: `tsvector` over weighted fields +
   `ts_rank` ordering, same API shape.

## Phase 9 additions

- `sessions_expires_idx` (`sessions.expires_at`, migration 0011) — plain B-tree,
  portable verbatim.
- `refunds.return_item_id` is a nullable UNIQUE column — both SQLite and
  Postgres treat NULLs as distinct, so multiple cancellation refunds per
  payment stay allowed; no semantic change on port.
- Branch grep: no `strftime`/`AUTOINCREMENT`/`julianday`/`unixepoch()` SQL in
  new code; timestamps remain integer unixepoch ms.
