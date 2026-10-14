# MarketFlow Slice 4 — Payments, Shipping & Fulfillment (Phase 6) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Phase 6 complete: sellers can progress orders through fulfillment (confirm → pack → ship w/ tracking → delivered → completed), customers see payment + shipment state, MOCK_BANK adapter lands, and STRIPE becomes a real payment method (test-mode keys in `.env`) via Stripe Checkout + webhook confirmation.

**Spec:** `docs/superpowers/specs/2026-10-13-marketflow-design.md` §5–§7, §9. Base branch `main` @ `1215529`.

## Global Constraints

- `_at` ms epochs; `_vnd` ints; ULIDs; `server-only`; i18n both locales.
- Payment provider interface `src/server/modules/payments/providers.ts` (`createAttempt`/`confirm`/`refund`) — extend, don't replace; keep `simulate` affordance for mocks.
- Stripe uses official `stripe` npm package. **Never commit keys**; `.env` already gitignored. `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY`/`STRIPE_WEBHOOK_SECRET` read via env (extend `src/server/env.ts` optional section or direct `process.env` per existing convention).
- Stripe absent keys → `STRIPE` method unavailable (INVALID_INPUT at checkout, hidden in UI). All provider calls outside the order transaction.
- `make check` + playwright green per task; commits per task.

---

### Task 1: Shipments schema + fulfillment service + MOCK_BANK

**Files:**
- Modify: `src/server/modules/payments/providers.ts` (+`mockBank`), `src/server/db/schema/orders.ts` (shipments/trackingEvents — check if already exist; add if missing)
- Create: `src/server/modules/orders/fulfillment.ts`, `tests/integration/fulfillment.test.ts`

**Interfaces:**
- Produces:
  - `mockBank` adapter: same contract as mockWallet (`mb_` refs, simulate flag) — quota of one pending attempt per order enforced by payment_attempts row; confirm = polling-style PAID/FAILED.
  - `shipments(id, sellerOrderId UNIQUE?, trackingNumber, carrier, status enum PREPARING|SHIPPED|IN_TRANSIT|DELIVERED, shippedAt?, deliveredAt?)` + `trackingEvents(id, shipmentId, status, description?, occurredAt)` — check schema first; `orders.ts` may already have them from slice 2 (verify; if present, just wire service).
  - `confirmSellerOrder(db, actor, sellerOrderId)` (NEW→CONFIRMED, parent-paid gate already in transitions), `packSellerOrder` (→PACKING), `shipSellerOrder(db, actor, id, {carrier, trackingNumber})` (→SHIPPED + shipment row + tracking event), `deliverSellerOrder` (→DELIVERED), `completeSellerOrder` (→COMPLETED), `cancelSellerOrder` (→CANCELLED + release that leg's reservation share — the slice-2 latent item: releasing leg stock).
  - All `requirePermission(actor, "order:write", {shopId})` + write audit_log rows via existing helper.
- Consumes: `transitions.ts`, `releaseReservation`, payments refund on cancel.

- [ ] **Step 1:** Schema check + migration if needed; mockBank + tests (confirm/refund/simulate).
- [ ] **Step 2:** Failing tests — full seller lifecycle CONFIRMED→PACKING→SHIPPED→DELIVERED→COMPLETED; illegal jumps rejected; leg-cancel releases stock + partial refund math correct (seller order's share of breakdown); non-member FORBIDDEN.
- [ ] **Step 3:** Implement service. `make check`; commit `feat: fulfillment service + mock_bank`.

---

### Task 2: Stripe payment provider + webhook

**Files:**
- Create: `src/server/modules/payments/stripe.ts`, `src/app/api/v1/webhooks/stripe/route.ts`, `src/app/[locale]/(storefront)/checkout/pay/[orderId]/page.tsx` (redirect surface), contract update
- Modify: `payments/providers.ts`, checkout (payment method enum + dispatch), `env.ts`, `package.json` (stripe dep), `src/server/db/schema/orders.ts` payment method enum if it's a CHECK'd enum (migration)

**Interfaces:**
- Produces:
  - `stripeCard` adapter implementing PaymentProvider: `createAttempt` creates a Stripe Checkout Session (`mode: "payment"`, VND zero-decimal — verify Stripe VND handling: VND is zero-decimal currency in Stripe, amounts in đồng directly), returns `{ref: session.id, redirectUrl}` — **interface extension**: `createAttempt` may return `{ref, redirectUrl?}`; checkout action stores ref, and when `redirectUrl` present returns it so the UI redirects.
  - Webhook `POST /api/v1/webhooks/stripe`: raw-body signature verify (`stripe.webhooks.constructEvent`, `STRIPE_WEBHOOK_SECRET`), handle `checkout.session.completed` → mark attempt SUCCEEDED + payment PAID + `transitionOrder` to CONFIRMED (idempotent: skip if already PAID — dedupe on `payment_attempts.providerRef`), `checkout.session.expired`/`payment_intent.payment_failed` → attempt FAILED + PAYMENT_FAILED path (reuse slice-2 dispatch wedge semantics).
  - Return/fallback: `/checkout/pay/[orderId]?session_id=` page → server component retrieves session → if paid, applies same transition (idempotent) → redirects to confirmation. Covers no-CLI local dev.
  - Env: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (client hint), `STRIPE_WEBHOOK_SECRET` optional (route 404s without it).
- Consumes: dispatch/payment state machinery from slice 2 (PAID never downgraded — reuse the CASE-guarded update).

- [ ] **Step 1:** `pnpm add stripe`; env wiring; payments.method enum extended with `STRIPE` (check drizzle enum → migration if CHECK).
- [ ] **Step 2:** Failing tests — adapter shape (mock the stripe client seam: keep `stripe.ts` thin, adapter functions take an injectable client or `getStripe()` singleton — test with stub), webhook idempotency (double-deliver completed → single PAID), fallback confirm page logic. Unit-test signature-verification failure path with bad sig.
- [ ] **Step 3:** Implement provider + webhook + pay page + checkout method wiring (`paymentMethods` list grows `STRIPE` only when key present). Smoke: `stripe listen`/manual curl of a `checkout.session.completed` fixture if creds permit; else stub-verify. `make check`; commit `feat: stripe payment provider`.

---

### Task 3: Seller fulfillment UI + customer shipment view

**Files:**
- Create: `src/app/[locale]/seller/orders/page.tsx` + `[id]/page.tsx`, `src/features/seller/order-*` components
- Modify: `src/app/[locale]/account/orders/[id]/page.tsx` (shipment/tracking timeline, per-seller-order status), checkout page payment methods (add MOCK_BANK; STRIPE when configured), messages, seller nav
- Test: none new (integration covered T1; e2e in T4)

**Interfaces:**
- Consumes: fulfillment service fns from T1 + `listSellerOrders`/detail for the shop-scoped seller actor, `getOrder` for customer (already exists).
- Produces: seller order list (per-shop scoped, status badges), detail page w/ action buttons per legal transition + shipment form (carrier+tracking), tracking timeline on customer order detail.

- [ ] **Step 1:** Seller orders pages wired to fulfillment actions; only legal transitions rendered (query transition table or try/catch INVALID_STATE → toast).
- [ ] **Step 2:** Customer order detail shows per-seller-order status + tracking events timeline; checkout payment method picker includes new methods.
- [ ] **Step 3:** `make check` + smoke seller@ confirm→pack→ship→deliver on a seeded/new order. Commit `feat: fulfillment ui`.

---

### Task 4: E2E + docs + OpenAPI

- [ ] e2e `fulfillment.spec.ts`: customer COD order → seller confirms/packs/ships w/ tracking → marks delivered → customer sees tracking timeline + status; MOCK_BANK simulate-failure path; (Stripe e2e gated on keys — test the *unavailable* path or stub; don't require network).
- [ ] openapi.yaml: webhook route documented (may be excluded — decide; webhooks aren't in coverage test unless under api/v1 route conventions — it IS under /api/v1, so document or adjust coverage for webhook exclusion), docs (fulfillment workflow, data-model, plan Phase 6 → done subset).
- [ ] `make verify` green; commit `feat: fulfillment e2e + docs`.

## Deferred
- Real carrier tracking providers (Viettel/GHN) — adapter seam only; auto-complete cron endpoint (`INTERNAL_CRON_TOKEN` exists — wire `POST /api/v1/cron/auto-complete` in this slice if trivial, else defer).
- Stripe refunds UI (refund() adapter exists; admin-side refund flow = Phase 7).
- Disputes/chargebacks, saved cards.
