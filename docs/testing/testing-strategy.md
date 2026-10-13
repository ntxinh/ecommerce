# Testing Strategy

**Status: Implemented (harness); domain coverage lands with each phase**

## Layout and commands

| Suite | Path | Runner | Command |
|---|---|---|---|
| Unit | `tests/unit/` | Vitest (node env) | `make test-unit` |
| Integration | `tests/integration/` | Vitest + real SQLite | `make test-integration` |
| E2E | `tests/e2e/` | Playwright vs `next start` | `make test-e2e` |

`make check` = lint + typecheck + unit + integration; `make verify` adds the
production build and Playwright.

## Implemented coverage

- **Unit:** token hashing/generation, session cookie options, rate limiter
  (`auth.test.ts`), env schema defaults (`env.test.ts`), VND/date formatters
  (`format.test.ts`), en↔vi message key parity (`i18n-parity.test.ts`), pino
  redaction + request-id child (`logger.test.ts`).
- **Integration:** real-file SQLite (`tests/.tmp/*.db`, migrations applied):
  schema/FK integrity (`db.test.ts`), session lifecycle + permission matrix
  (`auth.test.ts`), server-action auth flows incl. rate limits
  (`auth-actions.test.ts`).
- **E2E:** `auth.spec.ts` — login/logout/register/reset/verify journeys against
  `next start` with a dedicated seeded DB (`tests/.tmp/e2e.db`), plus shell
  guards for seller/admin areas.

## Harness details

- `server-only` resolves to an empty module under Vitest via the
  `tests/server-only.stub.ts` alias, and under `react-server` conditions for
  db scripts (`NODE_OPTIONS=--conditions=react-server` in the Makefile).
- Vitest env: `APP_ENV=test`, `DATABASE_URL=file:./tests/.tmp/test.db`.
- Playwright uses its own `DATABASE_URL` override and `global-setup.ts` seeding.

## Planned

Coverage thresholds on `src/server/modules/{pricing,orders,inventory,payments}`
after Phase 5; OpenAPI code↔spec contract test; concurrency tests (oversell,
voucher-limit races, rollback, refund uniqueness, cross-tenant denials); the
full Playwright journey set; a11y/locale audit.
