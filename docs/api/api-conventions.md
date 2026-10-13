# API Conventions

**Status: Implemented (conventions + health); most endpoints Planned**

## Surface

`/api/v1/*` route handlers. Implemented today:

| Route | Purpose |
|---|---|
| `GET /api/v1/health` | Liveness; returns `{data: {status: "ok"}}`, no dependency checks. |

Planned (design spec §7): auth, profile/addresses, catalog, search, cart,
checkout, orders, seller/*, admin/*, reviews, notifications, internal cron
(auto-complete), `/api/v1/ready` (DB ping returning only `{status}`).

## Conventions (as designed, enforced as routes land)

- **Helper:** `defineRoute({schemas, permission, handler})` in `src/server/api`
  — Zod validation → actor resolution → permission check → handler →
  `{data}` envelope. Request-id logging included. *(Planned; the auth flows
  currently use server actions in `src/features/auth/actions.ts` rather than
  REST routes.)*
- **Errors:** `{error: {code, message}}` + HTTP status, produced by
  `toErrorResponse()` in `src/server/api/errors.ts`. Unknown errors serialize
  to `INTERNAL`/`500` — internals never leak. Implemented codes:
  `UNAUTHORIZED`(401), `FORBIDDEN`(403), `EMAIL_TAKEN`, `INVALID_CREDENTIALS`,
  `INVALID_INPUT`, `INVALID_TOKEN`, `RATE_LIMITED`(429).
- **Pagination:** `?cursor&limit` cursor pagination, max limit 50. *(Planned.)*
- **Idempotency:** mutating routes accept an idempotency-key header; records in
  `idempotency_records`. *(Planned.)*
- **Admin:** `/api/v1/admin/*` additionally requires the `ADMIN` role.
- **Internal:** `/api/v1/internal/*` guarded by `INTERNAL_CRON_TOKEN`.
- **OpenAPI:** hand-maintained `docs/api/openapi.yaml` + a coverage test
  asserting code↔spec agreement; Scalar UI at `/api/docs` behind
  `API_DOCS_ENABLED=true`. *(Planned.)*
