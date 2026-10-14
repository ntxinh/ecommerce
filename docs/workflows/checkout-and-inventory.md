# Checkout and Inventory

**Status: Implemented** — `placeOrder` in `src/server/modules/orders/checkout.ts`
(spec §4–5, §9). Entry points: `POST /api/v1/checkout` and the
`placeOrderAction` server action behind `/[locale]/checkout`.

## Atomic checkout

`placeOrder` runs **one synchronous SQLite transaction**: idempotency lookup →
authoritative server-side repricing → voucher validation + redemption consume
→ per-item guarded stock reservation → inserts for orders, seller_orders,
order_items, pricing breakdowns, payment + attempt, audit log, and the
idempotency record → commit. No external calls inside the transaction; the
mock-wallet dispatch runs after commit (`dispatchWalletPayment`, its own
transaction).

- **Idempotency:** the `Idempotency-Key` header wins over the body field; a
  stable sha256 `requestHash` over the canonical payload detects key reuse
  with a different request (`IDEMPOTENCY_CONFLICT` 409). Records land
  COMPLETED inside the tx — a failed tx leaves no record, so retry is safe.
- **Cart ownership:** `cartItemIds` must all belong to the caller's cart
  (`NOT_FOUND`/`FORBIDDEN` otherwise). The server action buys the whole cart.
- **Shipping:** `shippingByShop` maps shopId → method name; unknown methods
  and methods for shops not in the order → `INVALID_INPUT` 422. Fees are priced
  from `application_settings.shipping_fees` (seeded `{"standard":15000,"express":30000}`).
- **COD** starts at `PROCESSING` and consumes reservations immediately;
  online methods start at `PENDING_PAYMENT` and hold ACTIVE reservations until
  the wallet confirms (`PAID`) or fails (`PAYMENT_FAILED` — stock stays
  reserved for `retryPayment`, released on cancel).

## Stock reservations

`reserveStock` (`src/server/modules/inventory/service.ts`) does the guarded
update `UPDATE inventory SET reserved = reserved + ? WHERE on_hand - reserved
>= ?`; zero rows → `INSUFFICIENT_STOCK` 409 → rollback. Reservation keys are
derived per line (`<order-key>:<variantId>`) so a replay returns the existing
row.

States: `ACTIVE → CONSUMED|RELEASED|EXPIRED`. `consumeReservation` moves qty
from reserved to sold (`on_hand -= qty`); `releaseReservation` restores
availability. Online-payment reservations carry a TTL from
`reservation_ttl_minutes` (seeded: 15) — expiry is enforced on-read; no
background timers. `inventory_movements` is an append-only ledger for
adjustments.

## Pricing

`priceOrder` (`src/server/modules/pricing/price-order.ts`) is a pure function:
variant base/sale price → promotions (`PERCENT`/`FIXED`/`FLASH_PRICE`, shop and
product scoped) → shop voucher → platform voucher → shipping voucher → per-shop
shipping fee. Integer VND math, floor rounding, proportional voucher
allocation with the remainder on the last line. Applied vouchers are consumed
in the same tx via `voucher_redemptions` (`UNIQUE(voucher_id, order_id)`);
`used_count`/`per_user_limit` are enforced inside the transaction.
