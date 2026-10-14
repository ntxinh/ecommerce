# Implementation Plan

**Status: In progress** — phases 0–2, 3 and 5 complete. Phase numbers follow spec §26;
implementation order is risk-descending (0–2 → 5 → 6 → 7 → 3 → 4 → 8 → 9) per
the design spec §11.

- [x] **Phase 0 — Repository inspection and planning** — design spec written
  (`docs/superpowers/specs/2026-10-13-marketflow-design.md`); stack confirmed.
- [x] **Phase 1 — Project foundation** — Next.js 16 + React 19 + Tailwind v4 +
  shadcn/ui (radix-nova) + Biome; mise/Makefile/env validation; next-intl +
  next-themes; Drizzle + SQLite migrations/seed; Vitest + Playwright harness;
  pino logger + OTel hook; docs skeleton.
- [x] **Phase 2 — Identity and application shell** — register/login/logout,
  sessions, password reset, email verification; roles + shop memberships;
  storefront/seller/admin shells with guards; locale + theme switching; demo
  accounts.
- [x] **Phase 5 — Transactional checkout and orders** — minimal catalog
  schema, inventory reservations, multi-seller orders, idempotency, state
  machines, rollback/oversell tests, checkout/orders UI, e2e journey +
  OpenAPI coverage.
- [ ] **Phase 6 — Payments, shipping, fulfillment** — ~~mock payment
  adapters,~~ ~~simulated shipping providers,~~ tracking, seller fulfillment
  UI, cancellation + inventory release. *(Shipped: COD + MOCK_WALLET +
  MOCK_BANK + STRIPE (Checkout Session + webhook) adapters, flat-fee shipping
  quotes, seller fulfillment UI (confirm → pack → ship w/ tracking → deliver →
  complete), shipment + tracking-event timeline on customer/seller order
  pages, leg-cancel refunds, e2e coverage. Deferred: real carriers
  (Viettel/GHN adapter seam — `provider_ref` columns), auto-complete cron,
  admin refund UI → Phase 7.)*
- [ ] **Phase 7 — Returns and marketplace finance** — returns workflow,
  refunds, commission, ledger, settlements.
- [x] **Phase 3 — Catalog and discovery** — categories/brands/products/
  variants/images, search, filters, shop storefronts, product management,
  moderation. *(Shipped: homepage sections, category/shop/search pages,
  `/api/v1/products` + `/api/v1/search` (incl. `mode=suggest`), seller
  product CRUD + submit-for-review, admin moderation queue + category CRUD,
  e2e coverage. Deferred: `product_attributes` management UI, search-history
  UI, wishlists (Phase 4), reviews submission + moderation notifications
  (Phase 8).)*
- [ ] **Phase 4 — Cart, pricing, promotions** — ~~carts, server pricing
  engine, vouchers/promotions, checkout review screens.~~ *(Checkout-side
  done: server cart + guest merge + cart page, pricing engine, vouchers at
  checkout, review stepper. Remaining Phase 4 scope: promotions management
  UI, wishlists.)*
- [ ] **Phase 8 — Engagement and administration** — reviews, notifications,
  admin console, seller onboarding, analytics.
- [ ] **Phase 9 — Quality and operational hardening** — coverage thresholds,
  full E2E journeys, authz-boundary tests, perf indexes, a11y/locale audit,
  OpenAPI + Scalar, telemetry verification, Postgres-readiness review.

Detailed per-task tracking lives in `.superpowers/sdd/2026-10-13-marketflow-phase-0-2/`.
