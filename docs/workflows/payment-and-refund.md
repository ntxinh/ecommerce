# Payment and Refund

**Status: Implemented** — payments in `src/server/modules/payments/`, returns
in `src/server/modules/orders/returns.ts`, ledger in
`src/server/modules/finance/ledger.ts`. Provider writes dispatch
**post-commit**: decision/checkout transactions book PENDING rows, then the
provider call runs and `completeRefund`/`persistPaymentOutcome` settles.

## Payments

`PaymentProvider` interface `{ createAttempt, confirm, refund }`; adapters:
`cod` (pending until collected), `mock-wallet`, `mock-bank` (accept
`simulate: "success" | "failure"` for tests/E2E), plus `stripe`/`finix` when
keys are configured. Confirm is idempotent on attempt id. Parent order:
`PENDING_PAYMENT → PAID|PAYMENT_FAILED`; COD skips it — the attempt stays
`PENDING` until collection.

## Returns → refunds

Flow: buyer files → shop member decides → refund books + dispatches → settle.

1. `requestReturn(db, actor, input)` (`POST`-style server action
   `requestReturnAction`, customer order page). Gates: order owner only, leg
   `DELIVERED|COMPLETED`, inside `return_window_days` (setting, default 7) of
   the leg's `DELIVERED` tracking event, per-item qty ≤ purchased minus
   already-claimed. A `DELIVERED` leg flips to `RETURN_REQUESTED`;
   `COMPLETED` legs stay put. Status `PENDING`; qty-holding statuses are
   `PENDING|APPROVED|REFUNDED|DISPUTED`.
2. `decideReturn(db, actor, id, "APPROVED"|"REJECTED", note?)` — seller
   returns queue (`decideReturnAction`). Requires `order:write` on the leg's
   shop; ADMIN may additionally decide a `DISPUTED` request.
   - **APPROVED** → `issueReturnRefunds` inside the tx: a `refunds` row per
     return item (`return_item_id` UNIQUE = dup guard), `restock` items back
     on_hand, `postRefundInitiation` per leg. PAID payments get real PENDING
     refunds dispatched post-commit via `paymentProviderFor(method).refund`;
     `status === "REFUNDED"` → `completeRefund` (row → COMPLETED,
     `postRefundCompletion`, `markPaymentRefundedIfComplete`,
     `settleReturnRequest`). COD/uncaptured items settle as zero-amount
     COMPLETED markers in-tx.
   - **REJECTED** → releases a `RETURN_REQUESTED` leg back to `COMPLETED`;
     the rejected qty is claimable again.
3. `disputeReturn` — buyer escalates `REJECTED → DISPUTED`; admin decides in
   `/admin/refunds` (same `decideReturn` path).
4. `settleReturnRequest` — when every item's refund is COMPLETED: request →
   `REFUNDED`; leg → `RETURNED` if all purchased qty is claimed by holding
   requests else `COMPLETED`. `completeRefund` then moves the parent to
   `PARTIALLY_REFUNDED`/`REFUNDED` when a legal edge exists.

## Financial records

`financial_ledger_entries`: append-only signed entries on named accounts
(`CUSTOMER_PAYABLE`, `PLATFORM_REVENUE`, `SELLER_PAYABLE`, `REFUNDS_PAYABLE`);
balance = SUM per account. Refund initiation earmarks
`REFUNDS_PAYABLE +x` / `SELLER_PAYABLE −x`; completion books
`REFUNDS_PAYABLE −x` / `CUSTOMER_PAYABLE −x`. Deliberate simplification of
full double-entry — see [known-limitations](../roadmap/known-limitations.md).

`seller_settlements` + `settlement_items` simulate payouts; `refundVnd` on a
settlement item subtracts completed refunds attributed to that leg.

## UI surfaces

- Customer order detail (`/account/orders/[id]`): per-leg return form
  (returnable legs only) + request statuses + Dispute on `REJECTED`.
- Seller `/seller/returns`: PENDING queue (All filter), approve/reject + note.
- Admin `/admin/refunds`: DISPUTED adjudication + latest 50 refunds.
