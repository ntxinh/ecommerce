# Checkout and Inventory

**Status: Planned** — Phase 5 (pulled ahead of catalog phases per the
risk-descending build order). Design intent (design spec §4–5):

- `orders.service.placeOrder({userId, cartItemIds, addressId, perShopShipping,
  voucherCodes, paymentMethod, idempotencyKey})` runs a **single synchronous
  SQLite transaction**: idempotency lookup → authoritative server-side repricing
  → voucher validation + conditional redemption consume → per-item guarded stock
  reservation (`UPDATE inventory SET reserved = reserved + ? WHERE
  on_hand - reserved >= ?`, zero rows → `INSUFFICIENT_STOCK` → rollback) →
  insert orders/seller_orders/order_items/breakdowns/reservations/payment
  attempt/idempotency record → commit. No external calls inside the transaction.
- Reservations: `ACTIVE → CONSUMED|RELEASED|EXPIRED`. Online-payment
  reservations expire after `reservation_ttl_minutes` (seeded: 15); COD
  reservations are consumed immediately at order creation.
- Expiry is checked on-read plus an admin-triggered sweep — no background
  timers.
- Pricing engine (`pricing.priceOrder`) is a pure function: variant price →
  promotions → shop voucher → platform voucher → shipping discount; integer math
  only, floor rounding, proportional allocation with remainder on last line.
  Precedence/stacking table to be documented here with the implemented code.
