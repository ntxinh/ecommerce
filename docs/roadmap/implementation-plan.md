# Implementation Plan

**Status: In progress** — phases 0–2 complete. Phase numbers follow spec §26;
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
  UI, cancellation + inventory release. *(In progress: COD + MOCK_WALLET
  adapters and flat-fee shipping quotes done; MOCK_BANK, tracking UI, seller
  fulfillment UI deferred to slice 3.)*
- [ ] **Phase 7 — Returns and marketplace finance** — returns workflow,
  refunds, commission, ledger, settlements.
- [ ] **Phase 3 — Catalog and discovery** — categories/brands/products/
  variants/images, search, filters, shop storefronts, product management,
  moderation. *(In progress: product images + reviews schema, seeded media/
  reviews/orders, catalog read service (list/detail/shop/homepage) done.)*
- [ ] **Phase 4 — Cart, pricing, promotions** — ~~carts, server pricing
  engine, vouchers/promotions, checkout review screens.~~ *(Checkout-side
  done: server cart + guest merge, pricing engine, vouchers at checkout,
  review stepper. Standalone cart discovery/management UI remains with
  Phase 3.)*
- [ ] **Phase 8 — Engagement and administration** — reviews, notifications,
  admin console, seller onboarding, analytics.
- [ ] **Phase 9 — Quality and operational hardening** — coverage thresholds,
  full E2E journeys, authz-boundary tests, perf indexes, a11y/locale audit,
  OpenAPI + Scalar, telemetry verification, Postgres-readiness review.

Detailed per-task tracking lives in `.superpowers/sdd/2026-10-13-marketflow-phase-0-2/`.
