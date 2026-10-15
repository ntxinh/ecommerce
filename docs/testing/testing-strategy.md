# Testing Strategy

**Status: Implemented (harness); domain coverage lands with each phase**

## Layout and commands

| Suite | Path | Runner | Command |
|---|---|---|---|
| Unit | `tests/unit/` | Vitest (node env) | `make test-unit` |
| Integration | `tests/integration/` | Vitest + real SQLite | `make test-integration` |
| Coverage | `src/server/modules/**` | Vitest + `@vitest/coverage-v8` | `make test-coverage` |
| E2E | `tests/e2e/` | Playwright vs `pnpm dev` | `make test-e2e` |
`make check` = lint + typecheck + unit + integration; `make verify` adds the
production build and Playwright.

## Implemented coverage

- **Unit:** password hash/verify, token format, permission matrix
  (`auth.test.ts`), env schema defaults (`env.test.ts`), VND/date formatters
  (`format.test.ts`), en↔vi message key parity (`i18n-parity.test.ts`), pino
  redaction + request-id child (`logger.test.ts`).
- **Integration:** real-file SQLite (`tests/.tmp/*.db`, migrations applied):
  schema/FK integrity (`db.test.ts`), identity service + session lifecycle +
  rate limiter (`auth.test.ts`), contracts + session cookie options +
  server-action flows (`auth-actions.test.ts`).
- **E2E:** `auth.spec.ts` — login/logout/register/reset/verify journeys against
  a `pnpm dev` server (port 3100) with a dedicated seeded DB
  (`tests/.tmp/e2e.db`), plus shell guards for seller/admin areas.

## Harness details

- `server-only` resolves to an empty module under Vitest via the
  `tests/server-only.stub.ts` alias, and under `react-server` conditions for
  db scripts (`NODE_OPTIONS=--conditions=react-server` in the Makefile).
- Vitest env: `APP_ENV=test`, `DATABASE_URL=file:./tests/.tmp/test.db`.
- Playwright uses its own `DATABASE_URL` override and `global-setup.ts` seeding.

## Coverage thresholds

`make test-coverage` runs the whole Vitest suite under `@vitest/coverage-v8`
with `coverage.include: ["src/server/modules/**"]`. Thresholds pin lines +
functions per module at the measured phases-7-9 baseline (rounded down to
2dp), so any new uncovered code in a money/stock path fails the run. Measured
baseline (this commit):

| Module | Measured lines | Measured functions | Pinned lines | Pinned functions |
|---|---|---|---|---|
| pricing | 98.29 | 100 | 98.28 | 100 |
| orders | 92.20 | 90.28 | 92.20 | 90.27 |
| inventory | 100 | 100 | 100 | 100 |
| payments | 95.83 | 91.23 | 95.83 | 91.22 |
| finance | 100 | 100 | 100 | 100 |

Rationale: pin at `max(measured, 80)` — every module already measures ≥80, so
no known-limitations floor is needed. Known residual gaps: `orders/checkout.ts`
rollback/compensation branches (branch ~57.6%) and the `finix.ts`/`stripe.ts`
provider-call error paths that need a failing stub; both sit inside modules
whose thresholds already match reality.

## Authz-boundary matrix

`tests/integration/authz-boundaries.test.ts` cross-checks tenant boundaries:
SELLER_B (shop_2 owner) and CUSTOMER are FORBIDDEN on shop_1 resources across
`getSellerOrder`, `shipSellerOrder`, `deliverSellerOrder`, `decideReturn`,
`getSellerProduct`, `generateSettlement`, `markSettlementPaid`,
`listSettlements`; ADMIN and the shop_1 owner reach them.

## Planned

OpenAPI code↔spec contract test; concurrency tests (oversell,
voucher-limit races, rollback, refund uniqueness, cross-tenant denials); the
full Playwright journey set; a11y/locale audit.
