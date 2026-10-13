# Payment and Refund

**Status: Planned** — Phase 6/7. Design intent (design spec §6):

- `PaymentProvider` interface `{ createAttempt, confirm, refund }`; adapters:
  `cod` (pending until collected), `mock-wallet`, `mock-bank`. Mock adapters
  accept `simulate: "success" | "failure"` for tests/E2E. Confirm is idempotent
  on attempt id.
- Refunds are item-granular partials via returns; `refunds(return_item_id
  UNIQUE)` + idempotent adapter prevent duplicates.
- Financial records: `financial_ledger_entries` — append-only signed entries on
  named accounts (`CUSTOMER_PAYABLE`, `PLATFORM_REVENUE`, `SELLER_PAYABLE`,
  `REFUNDS_PAYABLE`); balance = SUM per account; invariants checked in tests.
  Deliberate simplification of full double-entry — see
  [known-limitations](../roadmap/known-limitations.md).
- `seller_settlements` + `settlement_items` simulate payouts.
