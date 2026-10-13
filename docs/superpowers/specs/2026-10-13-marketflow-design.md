# MarketFlow — Design Spec

Date: 2026-10-13
Source requirements: `docs/marketflow-marketplace-build-prompt.md` (the governing PRD; this spec records the *decisions* made within it, not a restatement of every requirement).
Approach: **B — risk-descending build order**. Spec phase numbers (0–9) are kept for docs/roadmap; implementation order is 0–2 → 5 → 6 → 7 → 3 → 4 → 8 → 9.
Confirmed choices: pnpm 9; hand-rolled DB sessions; full roadmap attempted, vertical-slice discipline per spec §28.

## 1. Architecture

Modular monolith in one Next.js 16 (App Router) deployable, one SQLite database via Drizzle, PostgreSQL-portable by design.

Directory layout (spec §4, verbatim):

```
src/app/                 routes, layouts, route handlers (locale segment: [locale])
src/components/ui/       shadcn/ui generated components
src/components/shared/   app-level reusable components
src/features/<domain>/   client-side feature code per domain
src/server/modules/<m>/  business services, one folder per domain module
src/server/db/           drizzle schema, client, migrations, seeds, repositories
src/server/auth/         sessions, permissions, rate limiting
src/server/api/          route helpers, contracts (Zod), error format, OpenAPI
src/lib/                 cross-cutting utilities only
src/i18n/                next-intl config, request handling
messages/en.json, vi.json
tests/unit | tests/integration | tests/e2e
drizzle/                 generated migrations
scripts/  docs/  mailbox/ (dev reset-token delivery)
```

Rules:

- Dependency direction: `app → features → server/modules → server/db`. Modules call other modules only via exported service functions — never cross-import another module's repository.
- `server-only` package guards every module under `src/server`.
- Business rules live in services. Route handlers parse, authorize, delegate, serialize.
- Zod contracts in `src/server/api/contracts` are pure (no server-only imports) so clients may share them.

Domain modules: `identity`, `profiles`, `sellers` (applications/shops/memberships), `catalog`, `inventory`, `search`, `cart`, `pricing`, `orders`, `payments`, `shipping`, `reviews`, `notifications`, `finance`, `admin`, `audit`.

## 2. Auth & authorization

- Passwords: argon2id via `@node-rs/argon2`.
- Sessions: opaque token = `id.secret` (128-bit each); only `sha256(token)` stored in `sessions`. Cookie `marketflow_session`: HttpOnly, SameSite=Lax, Secure (non-dev), `path=/`. Absolute expiry 30d, sliding renewal past half-life; revocation = row delete. `sessions.user_id` indexed; admin can revoke all sessions for a user.
- Password reset: `password_reset_tokens` (sha256'd token, single-use, 30min expiry). Delivery = dev adapter writing JSON to `mailbox/` plus a Pino log line. Same adapter for optional email verification.
- Rate limiting: in-memory sliding-window Map keyed `login:{email}` (5/60s), `reset:{email}` (3/hr), `verify:{userId}` (3/hr); register is not rate-limited. **Known limitations:** single-instance only, lazy key pruning; documented in `docs/roadmap/known-limitations.md`.
- Roles: `CUSTOMER`, `SELLER`, `ADMIN` via `user_roles` join (users may hold multiple). Shop access via `shop_memberships(role: owner|staff, permissions jsonb-as-text)`.
- Authorization: `requirePermission(actor, permission, ctx)` in `src/server/auth/permissions.ts` backed by a declarative permission matrix; enforced at service entry and via `shop_id`/`user_id` predicates in repos. Matrix documented in `docs/security/authorization.md`.
- Seed users: `admin@marketflow.dev`, `seller@marketflow.dev`, `customer@marketflow.dev` (+ a second seller for cross-tenant tests). Demo password documented; warning banner in README.

## 3. Data model

IDs: `text` ULIDs. Money: `integer` minor units, `_vnd` suffix, whole đồng. Timestamps: `integer` unixepoch **milliseconds** UTC (`_at` suffix), `Date.now()`-native. All FKs explicit; `PRAGMA foreign_keys=ON` enforced at connection init.

Entity groups (full schema to `docs/database/data-model.md` at build time; decisions recorded here):

- **Identity:** `users`, `user_roles`, `sessions`, `password_reset_tokens`.
- **Profiles:** `customer_profiles`, `addresses`.
- **Sellers:** `shops`, `shop_memberships`, `seller_applications` (status: PENDING/APPROVED/REJECTED/CHANGES_REQUESTED, decision audit columns).
- **Catalog:** `categories` (self-FK hierarchy), `brands`, `product_attributes`, `products`, `product_variants` (SKU UNIQUE on variant; every product has ≥1 default variant), `product_images` (`variant_id NULL` = product-level image), `product_moderations`.
- **Inventory:** `inventory(variant_id PK, on_hand, reserved)` — `available = on_hand - reserved`, always derived; `inventory_movements` append-only (delta, reason, actor); `stock_reservations` (qty, `expires_at`, `idempotency_key`, status).
- **Cart:** `carts`, `cart_items` (UNIQUE cart+variant), `wishlists`/`wishlist_items`.
- **Pricing:** `promotions` (product/shop/flash-sale types), `vouchers` (platform|shop scope, percent|fixed|shipping kind, min_spend, max_discount, window, total+per-customer limits), `voucher_redemptions` (UNIQUE voucher+order for consume-once).
- **Orders:** `orders` (parent: buyer, totals, status) → `seller_orders` (shop-scoped, own fulfillment status, commission rate snapshot) → `order_items` (immutable snapshot: name, sku, variant attrs JSON, unit price, qty, discounts, totals) + `order_pricing_breakdowns` (one row per discount line + JSON detail).
- **Payments:** `payments`, `payment_attempts` (provider, status, idempotency, simulated-failure flag), `refunds`.
- **Shipping:** `shipments` (per seller_order), `shipment_items`, `tracking_events`.
- **Returns:** `return_requests`, `return_items` (reason, evidence refs, decision, restock flag).
- **Engagement:** `reviews` (UNIQUE order_item_id — one review per purchased item), `notifications`, `notification_preferences`.
- **Finance:** `financial_ledger_entries` — append-only **signed entries on named accounts** (account enum: CUSTOMER_PAYABLE, PLATFORM_REVENUE, SELLER_PAYABLE, REFUNDS_PAYABLE; amount, direction, ref type+id). Deliberate simplification of full double-entry; balance = SUM per account, invariants checked in tests. `seller_settlements` + `settlement_items` for simulated payouts.
- **Platform:** `audit_logs` (actor, action, target, metadata — never secrets), `idempotency_records(key UNIQUE, user_id, request_hash, status, response_json)`, `application_settings` (keyed JSON: commission rates, shipping fees, return window).

Indexes: listing/filter/report paths — `products(category_id,status)`, `products(shop_id,status)`, `order_items(product_id)`, `orders(user_id,created_at)`, `seller_orders(shop_id,status)`, `notifications(user_id,read_at)`, `reviews(product_id)`, `vouchers(code)`, `stock_reservations(expires_at,status)` and `sessions(expires_at)` for sweeps.

Portability: no `strftime`, no `AUTOINCREMENT` semantics relied on, no SQLite-isms in services; dialect notes + migration plan in `docs/database/sqlite-postgresql-portability.md`.

## 4. Pricing engine

`server/modules/pricing/price-order.ts` — pure function:

```
priceOrder(items, promotions, vouchers, shippingCtx) →
  { lines: [{variantId, baseUnitPrice, unitPrice, qty, itemDiscount, lineTotal}],
    perShop: [{shopId, subtotal, shopDiscount, shippingFee, shippingDiscount}],
    platformDiscount, grandTotal, breakdown, rejectedVouchers: [{code, reason}] }
```

Deterministic order of application:

1. Variant price: flash-sale price if active window, else sale price, else base price.
2. Non-voucher promotions (product discount, shop promotion) — best single eligible per item.
3. Shop voucher — at most one per shop.
4. Platform voucher — at most one per order.
5. Shipping discount vouchers last, against the computed shipping fee.

Rules: integer math only; percentage = `floor(amount * pct / 100)` per line; fixed discounts clamped to remaining subtotal; allocation to items = proportional floor, remainder to last line. Ineligible vouchers return a typed `VoucherRejection` (expired, min-spend, not-yours, limit-reached, wrong-shop) — never silently dropped. Precedence/stacking table documented in `docs/workflows/pricing.md`. Redemption limits consumed inside the checkout transaction via conditional update (`used < total_limit`).

## 5. Checkout, inventory, order lifecycle

`orders.service.placeOrder({userId, cartItemIds, addressId, perShopShipping, voucherCodes, paymentMethod, idempotencyKey})`:

1. `idempotency_records` lookup on `(key)` — hit → return stored response.
2. Single SQLite transaction (better-sqlite3 `transaction()` — synchronous, serializes writers):
   a. Load cart items, lock by ownership; recalc authoritative prices (§4).
   b. Validate address + per-shop shipping methods against settings.
   c. Validate vouchers; consume redemption counts (conditional UPDATE).
   d. Per item: `UPDATE inventory SET reserved = reserved + ? WHERE variant_id = ? AND on_hand - reserved >= ?` — zero rows affected → throw `INSUFFICIENT_STOCK` → rollback.
   e. Insert `orders`, `seller_orders` (one per shop), `order_items` snapshots, `order_pricing_breakdowns`, `stock_reservations` (15-min expiry for online payment; consumed on payment, released on cancel/expire), `payment` + `payment_attempt`, idempotency record with response.
   f. Commit. No external calls inside the transaction.
3. Post-commit: payment adapter dispatch (in-process mock), notification inserts, audit rows.

Reservation lifecycle: `ACTIVE → CONSUMED|RELEASED|EXPIRED`. Online-payment reservations expire after 15 minutes; COD reservations are consumed at order creation (stock converts reserved→committed immediately, released on cancellation). Expiry checks: on-read (`expires_at < now`) inside checkout/cart reads + admin-triggered sweep; deterministic, no background timers.

State machines (`src/server/modules/orders/transitions.ts` — lookup tables, enforced by `transitionOrder`/`transitionSellerOrder`, every transition writes `audit_logs` row):

- Order: `PENDING_PAYMENT → PAID → PROCESSING → SHIPPED → DELIVERED → COMPLETED`; `PENDING_PAYMENT → PAYMENT_FAILED → PENDING_PAYMENT` (retry) and `→ CANCELLED`; `PAID|PROCESSING → CANCELLED` (policy); `DELIVERED → PARTIALLY_REFUNDED|REFUNDED` via returns.
- Seller order fulfillment: `NEW → CONFIRMED → PACKING → READY_TO_SHIP → SHIPPED → DELIVERED → COMPLETED`; `NEW|CONFIRMED → CANCELLED`; `DELIVERED → RETURN_REQUESTED → RETURNED|COMPLETED`.
- Auto-complete: delivered orders auto-complete after `settings.auto_complete_days` via `POST /api/v1/internal/auto-complete` (env-token guarded) + dev UI trigger. Documented in `docs/workflows/order-lifecycle.md`.

## 6. Payments, shipping, returns

- `PaymentProvider` interface: `{ createAttempt, confirm, refund }`. Adapters: `cod` (pending until collected), `mock-wallet`, `mock-bank`. Mock adapters accept `simulate: "success"|"failure"` on the attempt for tests/E2E. Confirm is idempotent on attempt id.
- `ShippingProvider` interface: `{ quote, createShipment, advance }`. Providers `mock-standard`, `mock-express` with fee tables in `application_settings` (per-kg tiers, deterministic). Tracking numbers `MF{seq}`; `tracking_events` appended on each transition.
- Returns: `return_requests` allowed when seller order ∈ {DELIVERED, COMPLETED} ∧ `now - delivered_at <= settings.return_window_days`. Seller/admin approve|reject → refund via adapter (partial supported at item granularity) → restock only when `return_items.restock = true`. Duplicate refund prevented by `refunds(return_item_id UNIQUE)` + idempotent adapter.

## 7. API & OpenAPI

`/api/v1/*` route handlers (auth, profile/addresses, catalog, search, cart, checkout, orders, seller/*, admin/*, reviews, notifications, internal/auto-complete, health, ready). Helper `defineRoute({schemas, permission, handler})` in `src/server/api` gives: Zod param/query/body validation, actor resolution, permission check, standardized `{data}` / `{error:{code,message,details}}`, request-id logging, idempotency-key header support. Cursor pagination `?cursor&limit` (max 50). Admin routes under `/api/v1/admin/*` additionally require ADMIN.

OpenAPI 3.1: hand-maintained `docs/api/openapi.yaml` + `tests/integration/openapi-coverage.test.ts` asserting every `route.ts` file/method is documented (direction: code → spec) and every spec path exists on disk (spec → code). Scalar UI at `/api/docs` behind `API_DOCS_ENABLED=1` (server-only env; dev default on, prod explicit off).

## 8. Frontend

- Server Components fetch via services directly — no self-HTTP. Client islands only where interactive.
- Zustand: guest cart (`localStorage`, merged into server cart on login via `cart_service.merge`), selected variant, compare list, checkout stepper state, UI prefs. Server remains price/stock authority.
- TanStack Query: notifications, address book, seller tables, admin queues — client-fetched collections with cache/invalidation. Query keys `["<domain>", ...params]`; mutations invalidate narrowly; no retries on non-idempotent mutations.
- `ky` client `src/lib/api-client.ts`: `prefixUrl /api/v1`, error normalized to `ApiError {code,message}`.
- i18n: `next-intl`, `[locale]` segment, `en`+`vi` dictionaries, locale-aware number/date/currency (`Intl` + VND formatter in `src/lib/format.ts`). Language switch preserves route. `tests/unit/i18n.test.ts` asserts key parity en↔vi and no missing keys used in source (grep-based check).
- Theme: `next-themes` class strategy + inline init script — no flash. Light/Dark/System.
- shadcn/ui into `components/ui`; Lucide icons; Recharts for analytics; placehold.co/Pexels/DiceBear/unDraw/Simple Icons/BGJar for demo assets (local copies of seeded images in `public/seed/` to keep E2E deterministic).

## 9. Testing

- Vitest unit: pricing matrix, voucher eligibility, rounding, transitions, auth (hash/verify, token gen/expiry), rate limiter, i18n parity, formatters.
- Vitest integration: real SQLite (`better-sqlite3`, file per test run under `tests/.tmp`, migrations applied, per-test fixture builders). Covers: oversell attempt via concurrent reservations, voucher limit race, rollback on mid-checkout failure, idempotent order retry, refund uniqueness, cross-shop authz denials, FK constraints.
- Playwright: the 20 journeys in spec §23 against `next start` + dedicated seeded DB (`playwright.config.ts` webServer with `DATABASE_URL` override). Deterministic fixtures; no real network deps (seed images local).
- Gates: `make check` = biome ci + tsc + vitest; `make verify` = + build + playwright. CI fails on any gate. Coverage baseline recorded after Phase 5; thresholds on `src/server/modules/{pricing,orders,inventory,payments}`.

## 10. Observability & ops

- Pino: `src/server/observability/logger.ts`; per-request child logger with `requestId` (crypto UUID) + OTel trace ids when present. Redact paths: `password|passwordHash|token|secret|cookie|authorization|session`. Dev: pino-pretty.
- OTel: `@vercel/otel` `registerOTel` in `instrumentation.ts`; `OTEL_EXPORTER_*` env-driven, no-op without env. Custom spans on checkout, payment confirm, reservation sweep.
- `/api/v1/health` (liveness, no deps) + `/api/v1/ready` (DB ping, returns only `{status}` — no internals).
- Security headers via `next.config.ts` headers(): CSP (dev-relaxed documented), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, HSTS behind env flag.
- Env: `src/env.ts` Zod-validated at boot (server vars); `.env.example` placeholders only.

## 11. Documentation & build order

Docs tree per spec §25 written incrementally as features land — each doc marked Implemented/Planned. Repo files: `mise.toml` (node 22, pnpm 9), `Makefile` (spec §24 target list), `AGENTS.md`, `README.md`, `DESIGN.md`, `.editorconfig`, `lsp.json` (verdict: write for omp's documented schema if present, else document the limitation in README instead of inventing a schema).

Commit order (risk-descending, phase numbers retained):

1. Phase 0–1: scaffold, tooling, docs skeleton, Drizzle + first migration (identity+settings), seed infra, Vitest/Playwright boots, CI-ready Makefile.
2. Phase 2: auth, sessions, permissions, app shells (storefront/seller/admin layouts), locale+theme, demo accounts.
3. Phase 5: catalog-minimal schema needed by checkout → inventory, checkout, orders, idempotency, state machines. *(Pulled ahead of 3/4 per approach B.)*
4. Phase 6: payments, shipping, fulfillment UI minimum.
5. Phase 7: returns, refunds, ledger, settlements.
6. Phase 3–4: full catalog/search/filters, homepage sections, product management UI, cart polish, promotions/voucher UI.
7. Phase 8: reviews, notifications, admin console, seller onboarding, analytics.
8. Phase 9: coverage, E2E completion, OpenAPI/Scalar, a11y/locale audit, perf indexes, Postgres-readiness review.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Next.js 16 + library compat (next-intl, @vercel/otel) | Pin exact majors; verify in Phase 1 smoke build before domain work. |
| SQLite write contention during checkout tests | better-sqlite3 synchronous transactions serialize writers; WAL mode; concurrency tests prove the guard. |
| Scope creep inside phases | Vertical slices only; per-slice DoD = spec §27. |
| Spec↔code drift | Contract test for OpenAPI; docs written when feature lands, not after. |
| ULID/int64 edge cases | All timestamps unixepoch milliseconds (53-bit safe); ULID text sort verified in test. |

## 13. Deliberate simplifications

- Ledger: signed entries on named accounts, not full double-entry (upgrade path: journal+lines tables if real accounting needed).
- Rate limiting: in-memory, single instance.
- File uploads: validated URL/local-path references only; no storage service.
- Recommendation engine: deterministic seeded sections, labeled as such.
- Email: dev adapter to `mailbox/` only.
