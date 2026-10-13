# Product Requirements

**Status: Implemented (Phase 0–2 scope)** — the governing PRD is
[`docs/marketflow-marketplace-build-prompt.md`](../marketflow-marketplace-build-prompt.md).
This file records scope status, not a restatement.

## Product

MarketFlow — multi-vendor e-commerce marketplace demo. Three user-facing surfaces:
localized storefront (`/[locale]`), Seller Center (`/[locale]/seller`), Admin
Console (`/[locale]/admin`). Educational project; all payment/shipping providers
are deterministic in-process mocks.

## Feature status

| Area | Status |
|---|---|
| i18n routing (en, vi), light/dark/system theme | Implemented |
| Registration, login, logout, sessions, password reset, email verification | Implemented |
| Roles + shop-membership authorization | Implemented |
| Storefront / Seller / Admin shells (guarded) | Implemented |
| Health endpoint `/api/v1/health` | Implemented |
| Structured logging (pino) + OTel hook | Implemented |
| Catalog, search, cart, pricing, checkout, orders, payments, shipping, returns, reviews, notifications, finance, admin moderation, analytics | Planned |
| OpenAPI spec + Scalar UI | Planned |
| PostgreSQL deployment target | Planned (SQLite-first, portable by design) |

## Roles

- **CUSTOMER** — shops the storefront; may apply to become a seller.
- **SELLER** — role marker; actual shop access comes from `shop_memberships`
  (OWNER = all shop perms, STAFF = explicit permission grants).
- **ADMIN** — platform operator; bypasses all permission checks including
  shop-scoped ones (see [authorization.md](../security/authorization.md)).

Users may hold multiple roles simultaneously.
