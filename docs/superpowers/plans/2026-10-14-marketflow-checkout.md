# MarketFlow Slice 2 — Transactional Checkout & Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers can add multi-shop products to a cart, check out atomically with stock reservation + voucher pricing + idempotency, and receive parent/seller orders with a real state machine — verified by concurrency and rollback tests plus a Playwright multi-shop checkout journey.

**Architecture:** Extends the modular monolith. New modules: `catalog`, `inventory`, `cart`, `pricing`, `orders`, `payments` (mock adapter), `shipping` (quote-only mock). All business logic in services; route handlers + server actions are thin.

**Tech Stack:** existing — Drizzle/better-sqlite3, zod, next-intl, vitest, playwright, ulidx, server-only.

**Spec:** `docs/superpowers/specs/2026-10-13-marketflow-design.md` §3–§7 + `docs/marketflow-marketplace-build-prompt.md` §4/§8/§9/§14/§23.

## Global Constraints

- Money `integer` VND `_vnd`; timestamps `integer` unixepoch **milliseconds** `_at`; ids text ULID.
- Every `src/server/**` file first line `import "server-only";`.
- Server is authoritative for price/stock/totals; client never trusted.
- All writes that span related rows run inside `db.transaction((tx) => …)` — synchronous better-sqlite3 transactions (no awaits inside).
- Every new user-facing string in BOTH `messages/en.json` and `messages/vi.json` (parity test enforces).
- `make check` + `pnpm playwright test` green at every task boundary. Each task commits.
- Permission union currently: `product:read|product:write|order:read|order:write|shop:manage|admin:*|seller:apply` — reuse; shop-scoped checks pass `{shopId}`.
- `AuthError(code, status)` codes: extend `ErrorCode` union as needed (`"INSUFFICIENT_STOCK"`, `"VOUCHER_INVALID"`, `"NOT_FOUND"`, `"IDEMPOTENCY_CONFLICT"`).

---

### Task 1: Catalog + inventory + order schema + seed

**Files:**
- Create: `src/server/db/schema/catalog.ts`, `inventory.ts`, `orders.ts`, `pricing.ts`, `src/server/db/seed/catalog.ts`
- Modify: `src/server/db/schema/index.ts`, `scripts/db-seed.ts`
- Test: `tests/integration/catalog-schema.test.ts`

**Interfaces:**
- Produces (consumed by all later tasks):
  - `categories(id, parentId?, slug UNIQUE, nameEn, nameVi, sortOrder)`
  - `brands(id, name UNIQUE)`
  - `products(id, shopId→shops, categoryId, brandId?, slug UNIQUE, nameEn, nameVi, descriptionEn, descriptionVi, status enum DRAFT|ACTIVE|ARCHIVED, createdAt)`
  - `productVariants(id, productId, sku UNIQUE, nameEn, nameVi, attributesJson text, basePriceVnd int, salePriceVnd int?, createdAt)` — indexes `(productId)`, `(sku)`.
  - `inventory(variantId PK→productVariants, onHand int, reserved int, updatedAt)` — available = onHand − reserved, never stored.
  - `inventoryMovements(id, variantId, delta int, reason text, actorId?, createdAt)` append-only.
  - `stockReservations(id, variantId, qty int, status enum ACTIVE|CONSUMED|RELEASED|EXPIRED, idempotencyKey, expiresAt, createdAt)` index `(expiresAt,status)`.
  - `carts(id, userId UNIQUE→users, createdAt, updatedAt)`; `cartItems(id, cartId, variantId, qty int, UNIQUE(cartId,variantId))`.
  - `vouchers(id, code UNIQUE, scope enum PLATFORM|SHOP, shopId?, kind enum PERCENT|FIXED|SHIPPING, value int, minSpendVnd int, maxDiscountVnd int?, startsAt, endsAt, totalLimit int?, perUserLimit int?, usedCount int default 0, status enum ACTIVE|DISABLED)` index `(code)`.
  - `promotions(id, scope enum PRODUCT|SHOP|FLASH, productId?, shopId?, kind enum PERCENT|FIXED|FLASH_PRICE, value int, startsAt, endsAt, status)`.
  - `orders(id, userId, addressSnapshotJson, status enum PENDING_PAYMENT|PAID|PROCESSING|SHIPPED|DELIVERED|COMPLETED|CANCELLED|PAYMENT_FAILED|PARTIALLY_REFUNDED|REFUNDED, totalVnd, subtotalVnd, shippingVnd, discountVnd, currency default 'VND', idempotencyKey UNIQUE, createdAt, updatedAt)` index `(userId,createdAt)`.
  - `sellerOrders(id, orderId→orders, shopId, status enum NEW|CONFIRMED|PACKING|READY_TO_SHIP|SHIPPED|DELIVERED|COMPLETED|CANCELLED|RETURN_REQUESTED|RETURNED, subtotalVnd, shippingVnd, commissionRateBps int, trackingNumber?, createdAt, updatedAt)` index `(shopId,status)`.
  - `orderItems(id, sellerOrderId→sellerOrders, orderId→orders, variantId, productId, nameSnapshot, skuSnapshot, attrsJson, unitPriceVnd, qty, itemDiscountVnd, voucherDiscountVnd, lineTotalVnd)` index `(orderId)`, `(productId)`.
  - `orderPricingBreakdowns(id, orderId, lineType text, amountVnd int, metaJson)`.
  - `payments(id, orderId UNIQUE, method enum COD|MOCK_WALLET|MOCK_BANK, status enum PENDING|AUTHORIZED|PAID|FAILED|REFUNDED|EXPIRED, amountVnd, createdAt, updatedAt)`; `paymentAttempts(id, paymentId, status, simulate text?, idempotencyKey, createdAt)`.
  - `shipments(id, sellerOrderId UNIQUE, provider text, status enum CREATED|PICKED|IN_TRANSIT|DELIVERED|FAILED|RETURNED, trackingNumber UNIQUE, createdAt)`; `trackingEvents(id, shipmentId, status, detail, createdAt)`.
  - `idempotencyRecords(key PK, userId, requestHash, status enum IN_PROGRESS|COMPLETED|FAILED, responseJson, createdAt)`.
  - `auditLogs(id, actorId?, action, targetType, targetId, metaJson, createdAt)` index `(targetType,targetId)`.
  - `seedCatalog(db)` — deterministic fixed ids: 2 categories + 2 nested, 1 brand, `shop_1` + new `shop_2` "Danang Goods" (owner usr_seller needs second membership — or seed `usr_seller2` promotes: seller2 gets SELLER role + shop_2 ownership; adjust so its pending application becomes APPROVED→shop_2), ≥6 products across both shops, variants with stock ≥5 each, 1 active platform voucher `WELCOME10` (10% max 50k), 1 shop voucher `SHOP2FIX` (fixed 20k min 200k, shop_2), 1 active shop promotion on shop_1, 1 flash promo on one product.
- Consumes: `getDb`, `migrateDb`, existing seed pattern (`onConflictDoNothing`, fixed ids, `SEEDED_AT` ms).

- [ ] **Step 1:** Write schema files exactly as listed; `src/server/db/schema/index.ts` re-exports all.
- [ ] **Step 2:** Failing integration test `tests/integration/catalog-schema.test.ts`: migrate temp db, seedIdentity + seedCatalog, assert: ≥2 shops, ≥6 products, all products have ≥1 variant with inventory row, voucher `WELCOME10` exists, seed twice = idempotent.
- [ ] **Step 3:** `drizzle-kit generate` (via `make db-generate`), implement `seedCatalog`, run `make db-reset`.
- [ ] **Step 4:** Verify test passes; commit `feat: catalog+order schema + seed`.

---

### Task 2: Inventory service

**Files:**
- Create: `src/server/modules/inventory/service.ts`
- Test: `tests/unit/inventory.test.ts` + `tests/integration/inventory.test.ts`

**Interfaces:**
- Produces:
  - `availableStock(db, variantId): number` — `onHand - reserved` (clamped ≥0 read-side only).
  - `adjustStock(db, variantId, delta, reason, actorId)` — rejects negative resulting `onHand` (`AuthError("INVALID_INPUT")`); writes `inventoryMovements` row; transaction.
  - `reserveStock(tx, variantId, qty, idempotencyKey, ttlMs)` — conditional `UPDATE inventory SET reserved=reserved+? WHERE variant_id=? AND on_hand-reserved>=?` inside the **caller-supplied tx**; zero rows → `AuthError("INSUFFICIENT_STOCK", 409)`; inserts `stock_reservations` ACTIVE row.
  - `consumeReservation(tx, reservationId)` — reserved→onHand decrement + status CONSUMED.
  - `releaseReservation(tx, reservationId, reason)` — reserved decrement + status RELEASED + movement row.
  - `sweepExpiredReservations(db, now=Date.now()): number` — releases ACTIVE reservations past `expires_at`; returns count.
- Consumes: schema from Task 1.

- [ ] **Step 1:** Failing tests — unit: derivation math; integration: `adjustStock` rejects negative, `reserveStock` fails when insufficient, `consume`/`release` balance `on_hand`/`reserved` and write movements, sweep expires only expired ACTIVES, **two parallel reservations where on_hand=5, each qty=5: exactly one succeeds** (use two `db.transaction` calls in sequence simulating contention — better-sqlite3 serializes; assert second throws INSUFFICIENT_STOCK).
- [ ] **Step 2:** Implement service. Reservation TTL from `application_settings.reservation_ttl_minutes`.
- [ ] **Step 3:** `make check` green; commit `feat: inventory service`.

---

### Task 3: Cart service + routes/actions

**Files:**
- Create: `src/server/modules/cart/service.ts`, `src/server/api/contracts/cart.ts`, `src/app/api/v1/cart/route.ts` (GET), `src/app/api/v1/cart/items/route.ts` (POST/DELETE), `src/features/cart/actions.ts`
- Test: `tests/integration/cart.test.ts`, `tests/unit/cart.test.ts`

**Interfaces:**
- Produces:
  - `getCart(db, userId): CartView` — `{ items: [{cartItemId, variantId, productId, name, sku, attrs, unitPriceVnd, qty, available, shopId, shopName}], byShop: [...], subtotalVnd }` — price/availability resolved live from DB.
  - `addItem(db, userId, variantId, qty)`, `updateQty(db, userId, cartItemId, qty)` (qty 0 → delete), `removeItem(db, userId, cartItemId)`, `clearCart(db, userId)`.
  - `mergeGuestCart(db, userId, items: {variantId, qty}[])` — upsert into server cart (called by login flow; wire in Task 7).
  - Ownership enforced: every mutation asserts `cart_items.cart_id` belongs to user's cart (`AuthError FORBIDDEN`).
  - Route handlers use `defineRoute`-style inline: `getActor()` → service → `{data}`/`toErrorResponse`. Server actions same logic returning `ActionResult`.
- Consumes: Task 1 schema; `getActor`, `AuthError`.

- [ ] **Step 1:** Failing tests — add/update/remove/group-by-shop; cross-user item access denied; qty>stock allowed in cart but `available` flag false (validation happens at checkout); guest merge upserts.
- [ ] **Step 2:** Implement service + routes + actions. Cart auto-created on first add (`INSERT ... ON CONFLICT DO NOTHING` on `carts.user_id`).
- [ ] **Step 3:** Verify + commit `feat: cart service + api`.

---

### Task 4: Pricing engine

**Files:**
- Create: `src/server/modules/pricing/price-order.ts`, `src/server/modules/pricing/vouchers.ts`, `src/server/api/contracts/pricing.ts`
- Test: `tests/unit/pricing.test.ts` (the big matrix), `tests/integration/vouchers.test.ts`

**Interfaces:**
- Produces:
  - `priceOrder(db, userId, items: {variantId, qty}[], voucherCodes: string[], shippingByShop: Record<shopId,{method,feeVnd}>): PricedOrder`
  - `type PricedOrder = { lines: OrderLine[]; perShop: {shopId, subtotalVnd, shopDiscountVnd, shippingFeeVnd, shippingDiscountVnd, items: OrderLine[]}[]; platformDiscountVnd, grandTotalVnd, breakdown: BreakdownLine[]; rejectedVouchers: {code, reason}[] }`
  - `type OrderLine = {variantId, productId, shopId, name, sku, attrs, unitPriceVnd, qty, itemDiscountVnd, voucherDiscountVnd, lineTotalVnd}`
  - `validateVoucher(db, voucher, ctx): null | VoucherRejection` — reasons: `EXPIRED|NOT_STARTED|DISABLED|MIN_SPEND|USER_LIMIT|TOTAL_LIMIT|WRONG_SHOP|UNKNOWN`.
  - Stacking rules (spec §4): per item best single non-voucher promo; ≤1 shop voucher per shop; ≤1 platform voucher; shipping vouchers last. Percentage = `floor(vnd*pct/100)`; allocation proportional floor, remainder to last line.
- Consumes: Task 1 schema.

- [ ] **Step 1:** Failing unit test matrix — base/sale/flash price precedence; shop promo vs voucher interplay; percent floor rounding; fixed-amount clamp to subtotal; min-spend/max-discount/total+per-user limits; expiry windows; rejectedVouchers reasons (never silent); multi-shop split.
- [ ] **Step 2:** Implement pure `priceOrder` + `vouchers.ts`. No DB writes here — `vouchers.ts` also exports `consumeRedemptions(tx, ...)` used by checkout inside its transaction (conditional `UPDATE vouchers SET used_count=used_count+1 WHERE id=? AND (total_limit IS NULL OR used_count<total_limit)`).
- [ ] **Step 3:** `make check` green; commit `feat: pricing engine`.

---

### Task 5: Checkout + orders + state machine (core)

**Files:**
- Create: `src/server/modules/orders/transitions.ts`, `src/server/modules/orders/service.ts`, `src/server/modules/orders/checkout.ts`, `src/server/modules/payments/providers.ts` (mock wallet + COD), `src/server/modules/shipping/providers.ts` (fee tables from settings), `src/server/api/contracts/checkout.ts`, `src/app/api/v1/checkout/route.ts` (POST)
- Test: `tests/integration/checkout.test.ts`, `tests/unit/transitions.test.ts`

**Interfaces:**
- Produces:
  - `placeOrder(db, actor, input: CheckoutInput): Promise<{orderId, sellerOrderIds, status}>` — full flow per spec §5: idempotency check (`Idempotency-Key` header or body) → transaction (validate items/address/shipping → `priceOrder` → consume vouchers → `reserveStock` per line → insert orders/sellerOrders/orderItems/breakdowns/reservations/payment+attempt → write idempotency record) → post-commit payment adapter dispatch (mock wallet auto-confirms unless `simulate:"failure"`; COD stays pending).
  - `transitionOrder(db, orderId, to, actor)` + `transitionSellerOrder(db, sellerOrderId, to, actor)` — enforce transition tables, write `auditLogs` row; illegal → `AuthError("INVALID_INPUT",422)`.
  - Order states: `PENDING_PAYMENT→PAID→PROCESSING→SHIPPED→DELIVERED→COMPLETED`; `PENDING_PAYMENT→PAYMENT_FAILED→PENDING_PAYMENT|CANCELLED`; `PAID|PROCESSING→CANCELLED`; `DELIVERED→PARTIALLY_REFUNDED|REFUNDED`. Seller: `NEW→CONFIRMED→PACKING→READY_TO_SHIP→SHIPPED→DELIVERED→COMPLETED`; `NEW|CONFIRMED→CANCELLED`; `DELIVERED→RETURN_REQUESTED→RETURNED|COMPLETED`.
  - `CheckoutInput = { cartItemIds, addressId, shippingByShop, voucherCodes, paymentMethod, idempotencyKey, simulate? }`.
  - `listOrders(db, actor, {status?, cursor?, limit})` (customer-scoped), `getOrder(db, actor, orderId)` (owner or admin; FORBIDDEN otherwise), `cancelOrder(db, actor, orderId)` (rules: only PENDING_PAYMENT/PAID|PROCESSING pre-ship per sellerOrder state; releases reservations).
- Consumes: Tasks 2–4 services; `application_settings` for shipping fee tables + commission_rate_bps snapshot on sellerOrder.
- COD rule: reservation CONSUMED at order creation (not expiry). Online: ACTIVE with 15min TTL, consumed on payment confirm.

- [ ] **Step 1:** Failing tests — unit: transition legality matrix (legal pass, illegal throw); integration: (a) happy path multi-shop → 1 order + 2 sellerOrders + items snapshot + breakdown rows; (b) INSUFFICIENT_STOCK rolls back everything (no order rows, reserved unchanged); (c) idempotent retry returns same orderId, no duplicates; (d) voucher limit race: two sequential checkouts where limit=1 → second rejected with TOTAL_LIMIT (still completes order without voucher); (e) cancel releases reservations; (f) payment failure → PAYMENT_FAILED → retry works; (g) cross-user getOrder → FORBIDDEN.
- [ ] **Step 2:** Implement transitions.ts → checkout.ts → service.ts → providers. Snapshot commission `commission_rate_bps` from settings onto `sellerOrders`.
- [ ] **Step 3:** Route POST `/api/v1/checkout` with `Idempotency-Key` support + `toErrorResponse`. `make check` green; commit `feat: transactional checkout + orders`.

---

### Task 6: Minimal checkout UI + customer orders pages

**Files:**
- Create: `src/features/checkout/*` (stepper client component, Zustand store for step state only), `src/app/[locale]/(storefront)/cart/page.tsx`, `checkout/page.tsx`, `checkout/confirmation/page.tsx`, `account/orders/page.tsx`, `account/orders/[id]/page.tsx`, `src/features/cart/add-to-cart.tsx`, minimal product page `src/app/[locale]/(storefront)/products/[slug]/page.tsx`, cart badge in header
- Modify: header (cart count), messages en+vi
- Test: reuse existing e2e harness; Task 7 adds spec.

**Interfaces:**
- Consumes: `getCart`, cart actions, `placeOrder` via `POST /api/v1/checkout` (ky) or server action, `listOrders`/`getOrder`.
- Produces: working add-to-cart → cart → checkout → confirmation → order history path in en+vi.
- Guest cart: Zustand `localStorage` store `useGuestCart`; on login merge via `mergeGuestCart` (wire into `loginAction` success path); server cart authoritative after login.

- [ ] **Step 1:** Product page (variant selector client component → add-to-cart action; guests → guest cart). Cart page grouped by shop with qty controls (server-rendered + actions). Checkout page: address select (seed a customer address OR simple inline address form — pick inline form saving to `addresses`), per-shop shipping method select (STANDARD/EXPRESS from settings), voucher code inputs, payment method radio (COD/Mock Wallet), Place Order button → action → confirmation page.
- [ ] **Step 2:** Orders list + detail pages (customer-scoped service calls).
- [ ] **Step 3:** `make check` + manual smoke: seeded customer adds items from shop_1 AND shop_2 → checkout with `WELCOME10` → confirmation shows two seller orders. Commit `feat: checkout ui + orders pages`.

---

### Task 7: E2E checkout journey + docs

**Files:**
- Create: `tests/e2e/checkout.spec.ts`
- Modify: `docs/workflows/order-lifecycle.md`, `checkout-and-inventory.md` (Implemented now), `docs/roadmap/implementation-plan.md`, `docs/database/data-model.md` (new tables), `docs/api/api-conventions.md` (checkout route), openapi.yaml skeleton + `tests/integration/openapi-coverage.test.ts`
- Test: the e2e spec itself.

**Interfaces:**
- Produces: `docs/api/openapi.yaml` covering `/api/v1/health`, `/api/v1/cart*`, `/api/v1/checkout`; coverage test asserting every `route.ts` file+method documented and every spec path exists.

- [ ] **Step 1:** E2E `checkout.spec.ts`: customer login → two different-shop products added → cart → checkout → place order (COD) → confirmation + order detail shows both seller orders. Second test: mock wallet with `simulate:"failure"` → PAYMENT_FAILED state visible.
- [ ] **Step 2:** Write openapi.yaml + coverage test.
- [ ] **Step 3:** Update docs to Implemented; `make verify` green; commit `feat: checkout e2e + api docs`.

---

## Self-review checklist (done at write time)
- Spec coverage: checkout §9.1–9.4 covered (Tasks 4–7); inventory §7.4 core (Task 2); pricing §8 (Task 4); payments minimal adapters COD+wallet (bank deferred — noted); shipping = quote+dispatch stubs (full tracking Task for slice 3); seller fulfillment UI deferred to slice 3 (seller order list needs seller pages — flagged known scope boundary).
- Deferred to slice 3 (documented): MOCK_BANK adapter, full shipment tracking events UI, returns/refunds (Phase 7), seller order-management UI, product management UI (Phase 3 continues).
- Type consistency: `PricedOrder`/`OrderLine`/`CheckoutInput` defined once in Task 4/5 interfaces; Task 6 consumes.
