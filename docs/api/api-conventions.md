# API Conventions

**Status: Implemented (conventions + cart/checkout/health routes); most
endpoints Planned**

## Surface

`/api/v1/*` route handlers. Implemented today:

| Route | Purpose |
|---|---|
| `GET /api/v1/health` | Liveness; returns `{data: {status: "ok"}}`, no dependency checks. |
| `GET /api/v1/cart` | Session user's cart view, grouped per shop. |
| `POST /api/v1/cart/items` | `{variantId, qty}` additive upsert → full cart view. |
| `DELETE /api/v1/cart/items` | `{cartItemId}` remove one line → full cart view. |
| `POST /api/v1/checkout` | Place an order (transactional; see `docs/workflows/checkout-and-inventory.md`). |
| `GET /api/v1/search` | `?q=&sort=&cursor&limit` product search (`mode=suggest` → autocomplete names); search-mode calls record `search_history` for authed users. |
| `GET /api/v1/products` | Public product cards: `?categoryId=&shopId=&q=&minPriceVnd=&maxPriceVnd=&minRating=&inStock=&sort=&cursor=&limit` listing, or `?ids=a,b,c` for caller-ordered cards (recently-viewed rail). |
| `POST /api/v1/webhooks/stripe` | Stripe event sink — unauthenticated, `Stripe-Signature` header verified against `STRIPE_WEBHOOK_SECRET`; 404 when not configured, 400 on bad signature, dedupes on `payment_attempts.provider_ref`. |

Full request/response schemas: `docs/api/openapi.yaml`, kept honest by
`tests/integration/openapi-coverage.test.ts` (every `route.ts` method must be
documented and every spec path must exist).

Planned (design spec §7): auth, profile/addresses, orders, seller/*, admin/*,
reviews, notifications, internal cron (auto-complete), `/api/v1/ready` (DB
ping returning only `{status}`).

## Conventions (as implemented)

- **Envelope:** success → `{data: …}`; errors → `{error: {code, message}}` +
  HTTP status via `toErrorResponse()` in `src/server/api/errors.ts`. Unknown
  errors serialize to `INTERNAL`/`500` — internals never leak.
- **Validation:** Zod contracts in `src/server/api/contracts/` — one schema
  shared by route handlers (JSON) and server actions (FormData coercion).
  Failures → `INVALID_INPUT` 400.
- **Auth:** `getActor()` from the session cookie; missing actor →
  `UNAUTHORIZED` 401. Route handlers are hand-rolled today; the `defineRoute`
  helper is still Planned. The interactive flows use server actions in
  `src/features/**` (`ActionResult` envelope, not HTTP).
- **Error codes in use:** `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404,
  `INVALID_INPUT` 400/422, `INSUFFICIENT_STOCK` 409, `VOUCHER_INVALID` 422,
  `IDEMPOTENCY_CONFLICT` 409. Auth-action-only codes: `EMAIL_TAKEN`,
  `INVALID_CREDENTIALS`, `INVALID_TOKEN`, `RATE_LIMITED`.
- **Idempotency:** `POST /api/v1/checkout` requires an `Idempotency-Key`
  header (body `idempotencyKey` as fallback); records in
  `idempotency_records`, replays return the same `{orderId, sellerOrderIds}`.
- **Pagination:** `?cursor&limit` cursor pagination, max limit 50 —
  implemented on `/api/v1/search` and `/api/v1/products` (`nextCursor` null
  ends the list).
- **Admin:** `/api/v1/admin/*` will require the `ADMIN` role. *(Planned.)*
- **Internal:** `/api/v1/internal/*` guarded by `INTERNAL_CRON_TOKEN`.
- **OpenAPI:** hand-maintained `docs/api/openapi.yaml` + the coverage test
  above. Served at `/api/v1/openapi.yaml`; Scalar UI at `/api/docs` behind
  `API_DOCS_ENABLED=true`.
