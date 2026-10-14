# Data Model

**Status: Partially implemented** — identity, sellers, settings, addresses,
catalog (+ images/attributes/moderation), reviews, search history, inventory,
pricing, cart, orders/payments/shipments, returns/refunds, financial ledger,
seller settlements, notifications, wishlists, idempotency and audit tables
exist (`drizzle/0000_*.sql` … `0009_*.sql`). Search indexes remain Planned
per the roadmap.

## Conventions

- **IDs:** `text` ULIDs with a type prefix (`ord_`, `so_`, `pay_`…); seed uses
  fixed readable ids like `usr_admin` for determinism.
- **Timestamps:** `integer` unixepoch **milliseconds** UTC, `_at` suffix
  (`Date.now()`-native throughout, seed included).
- **Money:** `integer` whole đồng, `_vnd` suffix.
- **Snapshots:** denormalized `*_snapshot`/`attrs_json` columns freeze
  address/product/variant data onto order rows at purchase time.
- FKs are explicit; `PRAGMA foreign_keys=ON` and `journal_mode=WAL` set in
  `src/server/db/client.ts`.

## Identity, sellers, settings

```mermaid
erDiagram
  users ||--o{ user_roles : has
  users ||--o{ sessions : owns
  users ||--o{ password_reset_tokens : owns
  users ||--o{ addresses : owns
  users ||--o{ shop_memberships : joins
  shops ||--o{ shop_memberships : has
  users ||--o{ seller_applications : files

  users {
    text id PK
    text email UK
    text name
    text password_hash
    text status "ACTIVE|SUSPENDED"
    integer email_verified_at
    integer created_at
    integer updated_at
  }
  user_roles {
    text user_id FK
    text role "CUSTOMER|SELLER|ADMIN — unique(user_id, role)"
  }
  sessions {
    text id PK
    text user_id FK
    text token_hash UK "sha256 of token; raw never stored"
    integer expires_at
    integer created_at "sessions_user_idx on user_id"
  }
  password_reset_tokens {
    text id PK
    text user_id FK
    text token_hash UK
    integer expires_at
    integer used_at "single-use"
    text kind "reset|verify"
  }
  addresses {
    text id PK
    text user_id FK
    text recipient_name
    text phone
    text line1
    text ward
    text district
    text city
    integer is_default
    integer created_at
  }
  shops {
    text id PK
    text slug UK
    text status "ACTIVE|SUSPENDED"
    text name
    text description
    integer created_at
  }
  shop_memberships {
    text shop_id FK
    text user_id FK
    text role "OWNER|STAFF"
    text permissions "JSON array of permission keys"
  }
  seller_applications {
    text id PK
    text user_id FK
    text status "PENDING|APPROVED|REJECTED|CHANGES_REQUESTED"
    text shop_name
    text business_info "JSON"
    text decided_by
    integer decided_at
    text decision_note
    integer created_at
  }
```

`application_settings` is a keyed JSON table (seeded: `commission_rate_bps`,
`return_window_days`, `auto_complete_days`, `currency`,
`reservation_ttl_minutes`, `shipping_fees`).

## Catalog

```mermaid
erDiagram
  categories ||--o{ categories : "parent_id"
  shops ||--o{ products : sells
  categories ||--o{ products : classifies
  brands ||--o{ products : brands
  products ||--o{ product_variants : has
  products ||--o{ product_images : has
  product_variants ||--o{ product_images : "variant_id (nullable)"
  products ||--o{ product_attributes : has
  products ||--o{ product_moderations : audited
  products ||--o{ reviews : rated
  order_items |o--o| reviews : "order_item_id UK (nullable)"
  users ||--o{ reviews : writes

  categories {
    text id PK
    text parent_id "self-FK, nullable"
    text slug UK
    text name_en
    text name_vi
    integer sort_order
  }
  brands {
    text id PK
    text name UK
  }
  products {
    text id PK
    text shop_id FK
    text category_id FK
    text brand_id FK "nullable"
    text slug UK
    text name_en
    text name_vi
    text description_en
    text description_vi
    text status "DRAFT|ACTIVE|ARCHIVED — seller-facing lifecycle"
    text moderation_status "NONE|SUBMITTED|APPROVED|REJECTED|SUSPENDED — admin gate, default NONE"
    integer created_at
  }
  product_variants {
    text id PK
    text product_id FK "cascade"
    text sku UK
    text name_en
    text name_vi
    text attributes_json
    integer base_price_vnd
    integer sale_price_vnd "nullable"
    integer created_at
  }
  product_images {
    text id PK
    text product_id FK "cascade"
    text variant_id FK "nullable, cascade"
    text url
    text alt
    integer sort_order
  }
  product_attributes {
    text id PK
    text product_id FK "cascade"
    text name
    text value
    integer sort_order
  }
  reviews {
    text id PK
    text order_item_id FK "UK, nullable — seed rows may predate purchases"
    text product_id FK "cascade"
    text user_id FK "cascade"
    integer rating "1-5"
    text title "nullable"
    text body "nullable"
    text status "PUBLISHED|HIDDEN"
    integer created_at
  }
```
`product_moderations(id, product_id→products cascade, actor_id, action
"SUBMIT|APPROVE|REJECT|SUSPEND", note, created_at)` is an append-only audit
trail — every seller submission and admin decision lands a row. Public reads
require `products.status='ACTIVE'` AND `moderation_status IN (NONE,APPROVED)`
(`publicGate` in `catalog/service.ts`): seeded/legacy products never entered
review and stay publishable, while everything that touched the pipeline is
gated on a decision.

## Search history

```mermaid
erDiagram
  users ||--o{ search_history : queries

  search_history {
    text id PK
    text user_id FK "cascade"
    text query
    integer created_at "indexed (user_id, created_at)"
  }
```

Written by search-mode `GET /api/v1/search` calls for authenticated users
only — `mode=suggest` returns before recording, and guests never write.
Powers future "recent searches" UI (deferred).


## Inventory

```mermaid
erDiagram
  product_variants ||--|| inventory : tracked
  product_variants ||--o{ inventory_movements : ledger
  product_variants ||--o{ stock_reservations : reserved

  inventory {
    text variant_id PK "FK, cascade"
    integer on_hand
    integer reserved
    integer updated_at
  }
  inventory_movements {
    text id PK
    text variant_id FK
    integer delta
    text reason
    text actor_id FK "nullable"
    integer created_at "append-only; never UPDATE/DELETE"
  }
  stock_reservations {
    text id PK
    text variant_id FK
    integer qty
    text status "ACTIVE|CONSUMED|RELEASED|EXPIRED"
    text idempotency_key "per-line key: <order-key>:<variant-id>"
    integer expires_at
    integer created_at
  }
```

## Pricing

```mermaid
erDiagram
  shops ||--o{ vouchers : scopes
  users ||--o{ voucher_redemptions : consumes
  vouchers ||--o{ voucher_redemptions : "unique(voucher_id, order_id)"
  orders ||--o{ voucher_redemptions : on

  vouchers {
    text id PK
    text code UK
    text scope "PLATFORM|SHOP"
    text shop_id FK "nullable"
    text kind "PERCENT|FIXED|SHIPPING"
    integer value "PERCENT: bps; FIXED/SHIPPING: VND"
    integer min_spend_vnd
    integer max_discount_vnd "nullable"
    integer starts_at
    integer ends_at
    integer total_limit "nullable"
    integer per_user_limit "nullable"
    integer used_count
    text status "ACTIVE|DISABLED"
  }
  promotions {
    text id PK
    text scope "PRODUCT|SHOP|FLASH"
    text product_id FK "nullable"
    text shop_id FK "nullable"
    text kind "PERCENT|FIXED|FLASH_PRICE"
    integer value "PERCENT: bps; FIXED/FLASH_PRICE: VND"
    integer starts_at
    integer ends_at
    text status "ACTIVE|SCHEDULED|ENDED|DISABLED"
  }
  voucher_redemptions {
    text id PK
    text voucher_id FK
    text user_id FK
    text order_id FK "nullable"
    integer created_at
  }
```

## Cart

```mermaid
erDiagram
  users ||--|| carts : "unique(user_id)"
  carts ||--o{ cart_items : holds
  product_variants ||--o{ cart_items : "unique(cart_id, variant_id)"

  carts {
    text id PK
    text user_id FK
    integer created_at
    integer updated_at
  }
  cart_items {
    text id PK
    text cart_id FK "cascade"
    text variant_id FK
    integer qty
  }
```

## Orders, payments, shipments

```mermaid
erDiagram
  users ||--o{ orders : places
  orders ||--o{ seller_orders : "split per shop"
  orders ||--o{ order_items : contains
  seller_orders ||--o{ order_items : groups
  orders ||--o{ order_pricing_breakdowns : priced_by
  orders ||--|| payments : "unique(order_id)"
  payments ||--o{ payment_attempts : attempts
  seller_orders ||--|| shipments : "unique(seller_order_id)"
  shipments ||--o{ tracking_events : tracks

  orders {
    text id PK
    text user_id FK
    text address_snapshot_json "frozen delivery address"
    text status "see workflows/order-lifecycle.md"
    integer total_vnd
    integer subtotal_vnd
    integer shipping_vnd
    integer discount_vnd
    text currency "VND"
    text idempotency_key UK
    integer created_at
    integer updated_at
  }
  seller_orders {
    text id PK
    text order_id FK
    text shop_id FK
    text status "NEW|CONFIRMED|PACKING|READY_TO_SHIP|SHIPPED|DELIVERED|COMPLETED|CANCELLED|RETURN_REQUESTED|RETURNED"
    integer subtotal_vnd
    integer shipping_vnd
    integer commission_rate_bps "snapshotted at purchase"
    text tracking_number "nullable"
    integer created_at
    integer updated_at
  }
  order_items {
    text id PK
    text seller_order_id FK
    text order_id FK
    text variant_id FK
    text product_id FK
    text name_snapshot
    text sku_snapshot
    text attrs_json
    integer unit_price_vnd
    integer qty
    integer item_discount_vnd
    integer voucher_discount_vnd
    integer line_total_vnd
  }
  order_pricing_breakdowns {
    text id PK
    text order_id FK
    text line_type
    integer amount_vnd "negative = discount"
    text meta_json
  }
  payments {
    text id PK
    text order_id FK
    text method "COD|MOCK_WALLET|MOCK_BANK|STRIPE"
    text status "PENDING|AUTHORIZED|PAID|FAILED|REFUNDED|EXPIRED"
    integer amount_vnd
    integer created_at
    integer updated_at
  }
  payment_attempts {
    text id PK
    text payment_id FK
    text status "same enum as payments"
    text simulate "nullable dev override"
    text provider_ref "nullable; Stripe session id — webhook dedupe key"
    text idempotency_key
    integer created_at
  }
  shipments {
    text id PK
    text seller_order_id FK
    text provider
    text status "CREATED|PICKED|IN_TRANSIT|DELIVERED|FAILED|RETURNED"
    text tracking_number UK
    integer created_at
  }
  tracking_events {
    text id PK
    text shipment_id FK "cascade"
    text status
    text detail
    integer created_at
  }
```

Carrier-adapter seam: `shipments.provider`/`tracking_number` are seller-entered
today (no carrier API). Real providers (Viettel/GHN — deferred) will add
`provider_ref` columns on `shipments` and `tracking_events` mirroring
`payment_attempts.provider_ref`: the provider's object id and remote event id
for webhook dedupe.

## Returns and refunds

```mermaid
erDiagram
  seller_orders ||--o{ return_requests : "idx (seller_order_id, status)"
  orders ||--o{ return_requests : scopes
  users ||--o{ return_requests : files
  return_requests ||--o{ return_items : "cascade"
  order_items ||--o{ return_items : returns
  payments ||--o{ refunds : issued
  return_items |o--o| refunds : "unique(return_item_id); NULL = cancellation"

  return_requests {
    text id PK
    text seller_order_id FK
    text order_id FK
    text user_id FK
    text status "PENDING|APPROVED|REJECTED|REFUNDED|DISPUTED"
    text reason
    text evidence_json "JSON array"
    text decided_by FK "nullable"
    integer decided_at "nullable"
    text decision_note "nullable"
    integer created_at
  }
  return_items {
    text id PK
    text return_request_id FK "cascade"
    text order_item_id FK
    integer qty
    integer restock "boolean"
    integer refund_vnd
  }
  refunds {
    text id PK
    text payment_id FK
    text return_item_id FK "nullable UK — one refund per returned item"
    integer amount_vnd
    text status "PENDING|COMPLETED|FAILED"
    text reason
    integer created_at
  }
```

## Financial ledger and settlements

Append-only `financial_ledger_entries` is the book of record: signed
`amount_vnd` per `account` (`CUSTOMER_PAYABLE`, `PLATFORM_REVENUE`,
`SELLER_PAYABLE`, `REFUNDS_PAYABLE`), keyed by `(ref_type, ref_id)` —
`ORDER` / `REFUND` / `SETTLEMENT`. Settlements batch paid seller legs;
`settlement_items.seller_order_id` is unique so a leg settles at most once.

```mermaid
erDiagram
  shops ||--o{ financial_ledger_entries : "idx (account, shop_id)"
  shops ||--o{ seller_settlements : "idx (shop_id, status)"
  seller_settlements ||--o{ settlement_items : "cascade"
  seller_orders ||--o| settlement_items : "unique(seller_order_id)"

  financial_ledger_entries {
    text id PK
    text account "CUSTOMER_PAYABLE|PLATFORM_REVENUE|SELLER_PAYABLE|REFUNDS_PAYABLE"
    text shop_id FK "nullable"
    integer amount_vnd "signed"
    text ref_type "ORDER|REFUND|SETTLEMENT"
    text ref_id "indexed with ref_type"
    text meta_json
    integer created_at
  }
  seller_settlements {
    text id PK
    text shop_id FK
    text status "PENDING|PAID"
    integer gross_vnd
    integer commission_vnd
    integer refund_vnd
    integer net_vnd
    integer created_at
    integer paid_at "nullable"
  }
  settlement_items {
    text id PK
    text settlement_id FK "cascade"
    text seller_order_id FK UK
    integer gross_vnd
    integer commission_vnd
    integer net_vnd
  }
```

## Notifications

```mermaid
erDiagram
  users ||--o{ notifications : "idx (user_id, read_at), cascade"
  users ||--o{ notification_preferences : configures

  notifications {
    text id PK
    text user_id FK "cascade"
    text type "account|seller_application|order|payment|shipment|return|voucher"
    text title
    text body
    text href "nullable"
    integer read_at "nullable = unread"
    integer created_at
  }
  notification_preferences {
    text user_id PK,FK "composite PK (user_id, type), cascade"
    text type PK
    integer enabled "boolean"
  }
```

## Wishlists

```mermaid
erDiagram
  users ||--|| wishlists : "unique(user_id), cascade"
  wishlists ||--o{ wishlist_items : "cascade"
  products ||--o{ wishlist_items : "unique(wishlist_id, product_id), cascade"

  wishlists {
    text id PK
    text user_id FK UK "cascade"
    integer created_at
  }
  wishlist_items {
    text id PK
    text wishlist_id FK "cascade"
    text product_id FK "cascade"
    integer created_at
  }
```


## Idempotency and audit

```mermaid
erDiagram
  idempotency_records {
    text key PK
    text user_id FK
    text request_hash "sha256 of canonical payload"
    text status "IN_PROGRESS|COMPLETED|FAILED"
    text response_json "nullable"
    integer created_at
  }
  audit_logs {
    text id PK
    text actor_id FK "nullable = system"
    text action
    text target_type
    text target_id "(target_type, target_id) indexed"
    text meta_json
    integer created_at
  }
```

## Planned entity groups

Per design spec §3: search indexes.

## Migrations

`make db-generate` (drizzle-kit) → `make db-migrate` → `make db-seed`.
Deterministic, idempotent seed (`onConflictDoNothing`, fixed seed timestamp);
e2e runs `scripts/db-seed.ts` against `${os.tmpdir()}/marketflow-e2e.db` (see
`playwright.config.ts` — outside the repo tree so Turbopack's watcher can't
force-reload pages on WAL churn).
