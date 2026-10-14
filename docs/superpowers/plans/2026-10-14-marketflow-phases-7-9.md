# MarketFlow Phases 7–9 — Returns & Finance, Engagement & Admin, Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Complete spec phases 7 (returns, refunds, ledger, settlements), 8 (reviews, notifications, admin console, seller onboarding, analytics) and 9 (coverage, e2e, authz boundaries, indexes, a11y/locale, OpenAPI/Scalar, telemetry, Postgres-readiness) so the app satisfies §27 Definition of Done end to end.

**Architecture:** Same modular monolith. New modules: `finance`, `reviews`, `notifications`, `sellers` (service layer — schema already exists), `admin`. Returns/refunds live in `orders`/`payments` per spec §1 module list. One schema migration; all money paths inside better-sqlite3 synchronous transactions.

**Spec:** `docs/superpowers/specs/2026-10-13-marketflow-design.md` + `docs/marketflow-marketplace-build-prompt.md` §10–§13, §16, §22–§27.

**Base:** branch `feature/marketflow-fulfillment` @ `2aa3880`, worktree `.worktrees/fulfillment`. Already shipped there: fulfillment service (`src/server/modules/orders/fulfillment.ts`), `shipments`+`tracking_events` writes, `mockBank`, seller orders UI, customer tracking timeline, Stripe provider, `persistPaymentOutcome` (`orders/outcome.ts` — the PAID-transition hook point). Remaining Phase-6 debt this plan absorbs: delivery-timestamp derivation, auto-complete route, `/ready`.

## Global Constraints

- IDs `text` ULIDs (`prefix_${ulid()}`); money `integer` whole đồng `_vnd`; timestamps `integer` ms `_at`; all FKs explicit.
- Every `src/server/**` file starts with `import "server-only";`. Services take `db: DB` (or `tx: Tx`) first arg; errors via `AuthError(code, status, msg)` — extend `ErrorCode` in `src/server/api/errors.ts` when needed.
- Route handlers: `export async function POST(req)` → `getActor()` → zod-parse → service → `Response.json({data})` / `toErrorResponse`. Writes prefer server actions (`"use server"` in `features/<x>/actions.ts` returning `{ok:true,...}|{ok:false,error}`).
- New API routes MUST land in `docs/api/openapi.yaml` in the same commit — `tests/integration/openapi-coverage.test.ts` enforces bidirectional sync.
- i18n: every user-facing string in `messages/en.json` AND `messages/vi.json` (parity test enforced). RSC pages `getTranslations({locale, namespace})` pass `t`+`locale` to client islands. New namespaces: `returns`, `reviews`, `notifications`, `finance`, plus `admin`/`seller`/`account` extensions.
- Authz: `requirePermission(actor, perm, {shopId})`; keys: `product:read|write`, `order:read|write`, `shop:manage`, `admin:*`, `seller:apply`. Reuse only. ADMIN bypasses all (ADR-0001).
- Tests: per-file DB `tests/.tmp/<name>-test.db`; `beforeAll`: `rmSync` db+wal+shm → `getDb(PATH)` → `migrateDb` → `seedIdentity(db)` → `seedCatalog(db)`. Inline `Actor` consts.
- `make check` green per task; commit per task. Never weaken financial/inventory/authz invariants (spec §28.12).

---

## Phase 7 — Returns and marketplace finance

### Task 1: Schema — returns, refunds, ledger, settlements, notifications, wishlists

**Files:**
- Modify: `src/server/db/schema/orders.ts` (add `return_requests`, `return_items`, `refunds`, `wishlists`, `wishlist_items`), `src/server/db/schema/reviews.ts` (add `images_json`), `src/server/db/schema/index.ts` (re-export new files)
- Create: `src/server/db/schema/finance.ts`, `src/server/db/schema/notifications.ts`
- Test: `tests/integration/schema-phase7.test.ts`

**Interfaces — write verbatim:**

```ts
// orders.ts — append (orderItems, payments, users already imported; add products import for wishlists)
export const returnRequests = sqliteTable("return_requests", {
  id: text("id").primaryKey(),
  sellerOrderId: text("seller_order_id").notNull().references(() => sellerOrders.id),
  orderId: text("order_id").notNull().references(() => orders.id),
  userId: text("user_id").notNull().references(() => users.id),
  status: text("status", { enum: ["PENDING", "APPROVED", "REJECTED", "REFUNDED", "DISPUTED"] })
    .notNull().default("PENDING"),
  reason: text("reason").notNull(),
  evidenceJson: text("evidence_json").notNull().default("[]"),
  decidedBy: text("decided_by").references(() => users.id),
  decidedAt: integer("decided_at"),
  decisionNote: text("decision_note"),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("return_requests_so_idx").on(t.sellerOrderId, t.status),
           index("return_requests_user_idx").on(t.userId)]);

export const returnItems = sqliteTable("return_items", {
  id: text("id").primaryKey(),
  returnRequestId: text("return_request_id").notNull()
    .references(() => returnRequests.id, { onDelete: "cascade" }),
  orderItemId: text("order_item_id").notNull().references(() => orderItems.id),
  qty: integer("qty").notNull(),
  restock: integer("restock", { mode: "boolean" }).notNull().default(false),
  refundVnd: integer("refund_vnd").notNull(),
}, (t) => [index("return_items_req_idx").on(t.returnRequestId)]);

export const refunds = sqliteTable("refunds", {
  id: text("id").primaryKey(),
  paymentId: text("payment_id").notNull().references(() => payments.id),
  returnItemId: text("return_item_id").references(() => returnItems.id), // NULL = cancellation refund
  amountVnd: integer("amount_vnd").notNull(),
  status: text("status", { enum: ["PENDING", "COMPLETED", "FAILED"] }).notNull().default("PENDING"),
  reason: text("reason").notNull().default(""),
  createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("refunds_return_item_uidx").on(t.returnItemId)]);

export const wishlists = sqliteTable("wishlists", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  createdAt: integer("created_at").notNull(),
});
export const wishlistItems = sqliteTable("wishlist_items", {
  id: text("id").primaryKey(),
  wishlistId: text("wishlist_id").notNull().references(() => wishlists.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("wishlist_items_uidx").on(t.wishlistId, t.productId)]);
```

```ts
// finance.ts — new file; import shops, sellerOrders
export const financialLedgerEntries = sqliteTable("financial_ledger_entries", {
  id: text("id").primaryKey(),
  account: text("account", {
    enum: ["CUSTOMER_PAYABLE", "PLATFORM_REVENUE", "SELLER_PAYABLE", "REFUNDS_PAYABLE"],
  }).notNull(),
  shopId: text("shop_id").references(() => shops.id),
  amountVnd: integer("amount_vnd").notNull(), // signed
  refType: text("ref_type").notNull(), // "ORDER" | "REFUND" | "SETTLEMENT"
  refId: text("ref_id").notNull(),
  metaJson: text("meta_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("ledger_account_idx").on(t.account, t.shopId),
           index("ledger_ref_idx").on(t.refType, t.refId)]);

export const sellerSettlements = sqliteTable("seller_settlements", {
  id: text("id").primaryKey(),
  shopId: text("shop_id").notNull().references(() => shops.id),
  status: text("status", { enum: ["PENDING", "PAID"] }).notNull().default("PENDING"),
  grossVnd: integer("gross_vnd").notNull(),
  commissionVnd: integer("commission_vnd").notNull(),
  refundVnd: integer("refund_vnd").notNull().default(0),
  netVnd: integer("net_vnd").notNull(),
  createdAt: integer("created_at").notNull(),
  paidAt: integer("paid_at"),
}, (t) => [index("settlements_shop_idx").on(t.shopId, t.status)]);

export const settlementItems = sqliteTable("settlement_items", {
  id: text("id").primaryKey(),
  settlementId: text("settlement_id").notNull()
    .references(() => sellerSettlements.id, { onDelete: "cascade" }),
  sellerOrderId: text("seller_order_id").notNull().references(() => sellerOrders.id),
  grossVnd: integer("gross_vnd").notNull(),
  commissionVnd: integer("commission_vnd").notNull(),
  netVnd: integer("net_vnd").notNull(),
}, (t) => [uniqueIndex("settlement_items_so_uidx").on(t.sellerOrderId)]); // leg settles at most once
```

```ts
// notifications.ts — new file
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "account"|"seller_application"|"order"|"payment"|"shipment"|"return"|"voucher"
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  href: text("href"),
  readAt: integer("read_at"),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("notifications_user_read_idx").on(t.userId, t.readAt)]);

export const notificationPreferences = sqliteTable("notification_preferences", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
}, (t) => [primaryKey({ columns: [t.userId, t.type] })]);
```

```ts
// reviews.ts — add column:
// imagesJson: text("images_json").notNull().default("[]"),
```

- [ ] **Step 1: Failing test** — `tests/integration/schema-phase7.test.ts`: PRAGMA `table_info` per new table (columns present), `index_list`/`index_info` assert `refunds_return_item_uidx` + `settlement_items_so_uidx` unique; `reviews.images_json` exists. `pnpm vitest run tests/integration/schema-phase7.test.ts` → FAIL.
- [ ] **Step 2: Write schema; `make db-generate` (migration `0008_*`); inspect generated SQL (FKs + indexes, never hand-edit); test → PASS.**
- [ ] **Step 3: Update `docs/database/data-model.md` Planned-group entries → documented tables. `make check` + `make db-reset` clean; commit `feat: phase7 schema`.**

---

### Task 2: Returns prerequisites — delivery timestamp, auto-complete, /ready

Fulfillment is done on this branch; returns still need a delivery timestamp, the auto-complete sweep, and `/ready`.

**Files:**
- Modify: `src/server/modules/orders/fulfillment.ts` (+`deliveredAt`, +`autoCompleteSellerOrders`)
- Create: `src/app/api/v1/internal/auto-complete/route.ts`, `src/app/api/v1/ready/route.ts`
- Modify: `docs/api/openapi.yaml` (+2 paths)
- Test: `tests/integration/auto-complete.test.ts`

**Interfaces:**
```ts
// fulfillment.ts — add:
export function deliveredAt(tx: Pick<DB, "select">, sellerOrderId: string): number | null
//   SELECT te.created_at FROM tracking_events te JOIN shipments s ON te.shipment_id = s.id
//   WHERE s.seller_order_id = ? AND te.status='DELIVERED' ORDER BY te.created_at DESC LIMIT 1 → null if none.

export function autoCompleteSellerOrders(db: DB, now = Date.now()): number
//   seller_orders.status='DELIVERED' AND deliveredAt(.) < now - days*86400_000
//   → transitionSellerOrder(tx, id, "COMPLETED", null). days from
//   application_settings.auto_complete_days (JSON number, fallback 3). Inline a
//   local settings read — Task 4 owns the shared-helper move. Returns count.
```
- `POST /api/v1/internal/auto-complete`: `req.headers.get("authorization") === "Bearer "+env.INTERNAL_CRON_TOKEN` else 401 `{error:{code:"UNAUTHORIZED"}}` → `{data:{completed: n}}`.
- `GET /api/v1/ready`: `getDb().select({ n: sql`1` }).all()` → `{data:{status:"ready"}}`; throw → `toErrorResponse` (500, no internals).

- [ ] **Step 1: Failing tests** — `auto-complete.test.ts`: drive a leg to DELIVERED via fulfillment fns (placeOrder COD → confirm→pack→ship→deliver), backdate its DELIVERED `tracking_events.created_at` via direct update → `autoCompleteSellerOrders` flips it to COMPLETED; fresh DELIVERED untouched. Route-level checks in the same file: 401 without bearer; `{completed}` with; `/ready` → `{status:"ready"}`.
- [ ] **Step 2: Implement; openapi.yaml both paths; `make check`; commit `feat: auto-complete + ready`.**

---

### Task 3: (absorbed) — fulfillment UI ships on the base branch

Seller orders pages + action buttons + customer tracking timeline already exist (`src/app/[locale]/seller/orders/`, `features/seller/order-*`). Residual gaps land inside Task 7.

---

### Task 4: Returns service

**Files:**
- Create: `src/server/modules/orders/returns.ts`, `src/server/api/contracts/returns.ts`, `src/server/db/settings.ts` (move `settingNumber` out of `orders/checkout.ts`; update its import there), `src/server/modules/payments/refunds.ts` (stub only — see below)
- Modify: `src/server/api/errors.ts` (`+ "RETURN_WINDOW_EXPIRED" | "INVALID_STATE"` to `ErrorCode` — reuse any equivalent already in the union)
- Test: `tests/integration/returns.test.ts`

**Interfaces:**
```ts
// contracts/returns.ts
export const RequestReturnInput = z.object({
  sellerOrderId: z.string().min(1),
  items: z.array(z.object({
    orderItemId: z.string().min(1),
    qty: z.number().int().min(1),
    restock: z.boolean().default(false),
  })).min(1),
  reason: z.string().trim().min(3).max(500),
  evidence: z.array(z.string().url()).max(5).default([]),
});
export type RequestReturnInputType = z.infer<typeof RequestReturnInput>;

// returns.ts — all writes in db.transaction:
export function requestReturn(db: DB, actor: Actor, input: RequestReturnInputType): string
// Gates:
//  - parent order.userId === actor.userId else FORBIDDEN (customer-only; admin does not file).
//  - sellerOrder.status ∈ {DELIVERED, COMPLETED} else INVALID_STATE 409.
//  - deliveredAt(tx, so.id) non-null AND now − deliveredAt <= return_window_days*86400_000
//    else RETURN_WINDOW_EXPIRED 409 (settingNumber(tx,"return_window_days",7)).
//  - each orderItemId belongs to this seller_order; qty <= item.qty − Σ return_items.qty
//    joined via requests in PENDING|APPROVED|REFUNDED (REJECTED don't count).
//  - refundVnd per item = floor(item.lineTotalVnd * qty / item.qty).
// Inserts return_requests PENDING + return_items (evidence → evidenceJson). If sellerOrder
// was DELIVERED → transitionSellerOrder(tx, id, "RETURN_REQUESTED", actor); COMPLETED stays.

export function listReturnRequests(db, actor, opts: {shopId?: string; status?: string; cursor?: string; limit?: number})
// customer sees own (userId=actor.userId); opts.shopId → requirePermission(actor,"order:read",{shopId});
// ADMIN sees all.

export function getReturnRequest(db, actor, id): { request; items }
// buyer sees own; order:read {shopId} members; admin.

export function decideReturn(db, actor, id, decision: "APPROVED"|"REJECTED", note?: string): void
// requirePermission(actor,"order:write",{shopId: so.shopId}) — ADMIN bypasses.
// From PENDING; admin may also decide DISPUTED. Sets decided_by/at/note.
// APPROVED → status APPROVED + issueReturnRefunds(tx, id) (payments/refunds.ts — Task 5 fills;
//   T4 ships it as a real no-op `export function issueReturnRefunds(_tx: Tx, _id: string): void {}`).
// REJECTED → status REJECTED; if sellerOrder.status==='RETURN_REQUESTED' →
//   transitionSellerOrder(tx, soId, "COMPLETED", actor).

export function disputeReturn(db, actor, id): void  // customer only: REJECTED→DISPUTED
```

- [ ] **Step 1: Failing tests** — happy-path request; RETURN_WINDOW_EXPIRED (backdate the DELIVERED tracking event); wrong customer FORBIDDEN; qty over-purchase INVALID_INPUT; overlapping second request rejected; REJECTED releases leg to COMPLETED; REJECTED→DISPUTED→admin APPROVED; non-member decide FORBIDDEN; request on COMPLETED seller order allowed without status flip.
- [ ] **Step 2: Implement incl. no-op `issueReturnRefunds` stub; `make check`; commit `feat: returns service`.**

---

### Task 5: Refunds + financial ledger

**Files:**
- Create: `src/server/modules/finance/ledger.ts`
- Modify: `src/server/modules/payments/refunds.ts` (fill T4's stub), `src/server/modules/orders/outcome.ts` (`persistPaymentOutcome`: on successful PAID persist, `postOrderRecognition` inside the same tx), `src/server/modules/orders/service.ts` cancel path (write refunds row + postings wherever it marks payment REFUNDED)
- Test: `tests/integration/finance.test.ts`

**Interfaces — posting rules (invariant test asserts):**
- Payment PAID: `CUSTOMER_PAYABLE +order.total_vnd` (refType ORDER, refId=orderId); per seller_order: `SELLER_PAYABLE +(so.subtotal_vnd − c)` and `PLATFORM_REVENUE +c`, plus `PLATFORM_REVENUE +so.shipping_vnd`, where `c = floor(so.subtotal_vnd * so.commissionRateBps / 10000)`.
- Refund initiated (amount x on seller_order, c′ = floor(x*bps/10000)): `REFUNDS_PAYABLE +x`; `SELLER_PAYABLE −(x−c′)`; `PLATFORM_REVENUE −c′`.
- Refund COMPLETED: `REFUNDS_PAYABLE −x`; `CUSTOMER_PAYABLE −x`.
- Settlement PAID: `SELLER_PAYABLE −net_vnd` (refType SETTLEMENT).
- **Invariant: `Σ CUSTOMER_PAYABLE == Σ SELLER_PAYABLE + Σ PLATFORM_REVENUE + Σ REFUNDS_PAYABLE`.**

```ts
// finance/ledger.ts
export type LedgerAccount = "CUSTOMER_PAYABLE"|"PLATFORM_REVENUE"|"SELLER_PAYABLE"|"REFUNDS_PAYABLE";
export function post(tx: Tx, e: {account: LedgerAccount; shopId?: string; amountVnd: number;
  refType: "ORDER"|"REFUND"|"SETTLEMENT"; refId: string; meta?: object}): void
export function postOrderRecognition(tx: Tx, orderId: string): void  // all PAID postings above
export function balance(db: Pick<DB,"select">, account: LedgerAccount, shopId?: string): number

// payments/refunds.ts
export function issueReturnRefunds(tx: Tx, returnRequestId: string):
  { refundId: string; paymentId: string; amountVnd: number }[]
// per return_item: INSERT refunds — UNIQUE(return_item_id) conflict → skip (dup-refund guard);
// initiation postings; if item.restock → adjustStock(+qty, "return_restock", actorId);
// returns pending list so decideReturn's post-commit section calls
// paymentProviderFor(payment.method).refund({ref: payment.id, amountVnd}) then
// completeRefund(db, refundId) per success.
export function completeRefund(db: DB, refundId: string): void
// PENDING→COMPLETED + closing postings + markPaymentRefundedIfComplete +
// return_requests → REFUNDED when all its refunds complete + parent order →
// PARTIALLY_REFUNDED|REFUNDED when every line is covered by completed refunds.
export function markPaymentRefundedIfComplete(tx: Tx, paymentId: string): void
```

- [ ] **Step 1: Failing tests** — paid order yields balanced postings + invariant; floor commission on odd subtotal; partial refund keeps invariant; duplicate `issueReturnRefunds` = one refunds row; restock → `on_hand` += qty (+movement row); PAID-order cancel writes refunds row + postings; order → REFUNDED only when all lines refunded.
- [ ] **Step 2: Implement; hook `postOrderRecognition` into `persistPaymentOutcome` PAID path and cancel-refund postings into the existing cancel flow (read the branch code first — `cancelOrder` was refactored on this branch).** `make check`; commit `feat: refunds + ledger`.

---

### Task 6: Settlements

**Files:**
- Create: `src/server/modules/finance/settlements.ts`
- Test: `tests/integration/settlements.test.ts` (UI lands in Tasks 11–13)

**Interfaces:**
```ts
export function generateSettlement(db: DB, actor: Actor|null, shopId: string): string
// admin:* or OWNER membership on shopId. Tx: seller_orders WHERE shop_id=? AND
// status='COMPLETED' AND id NOT IN (SELECT seller_order_id FROM settlement_items)
// → settlement_items + seller_settlements PENDING (gross=Σsubtotal_vnd,
// commission=Σfloor(subtotal*bps/10000), refundVnd=Σ COMPLETED refunds on those
// legs, net=gross−commission−refund). Empty → INVALID_INPUT.
export function markSettlementPaid(db, actor, settlementId): void
// admin:*; PENDING→PAID + paid_at + post(tx,{account:"SELLER_PAYABLE",amountVnd:-net,refType:"SETTLEMENT",refId:settlementId,shopId}).
export function listSettlements(db, actor, {shopId?, status?, cursor?, limit?})
// shop actor → own shop only (requirePermission order:read {shopId}); admin → all.
```

- [ ] **Step 1: Failing tests** — two COMPLETED legs settle w/ correct sums; second generate excludes settled legs (INVALID_INPUT when none left); markPaid posts ledger entry; non-admin/non-owner FORBIDDEN.
- [ ] **Step 2: Implement; `make check`; commit `feat: settlements`.**

---

### Task 7: Returns UI + admin refund queue + phase-7 e2e/docs

**Files:**
- Create: `src/features/returns/actions.ts`, `src/features/returns/return-form.tsx` (per-item qty + restock + reason + evidence URLs), `src/app/[locale]/seller/returns/page.tsx`, `src/app/[locale]/admin/refunds/page.tsx`, `src/features/returns/queue.tsx`
- Modify: customer `account/orders/[id]` page (Request-return button per DELIVERED/COMPLETED seller order + return status display), seller nav (+Returns), admin nav (+Refunds), `docs/workflows/payment-and-refund.md` (→ Implemented), `docs/workflows/order-lifecycle.md` (return states), messages en+vi (`returns` namespace), `tests/e2e/returns.spec.ts`.

- [ ] **Step 1:** Pages wired — seller queue: PENDING returns + approve/reject+note; admin queue: refunds + DISPUTED requests + decide; customer order detail shows return status.
- [ ] **Step 2:** e2e `returns.spec.ts`: COD order → seller confirm/pack/ship/deliver → customer requests return on one item → seller approves → refund COMPLETED + leg RETURNED/COMPLETED. (If T8 hasn't landed, don't assert notifications.)
- [ ] **Step 3:** `make check` + `pnpm playwright test tests/e2e/returns.spec.ts`; commit `feat: returns ui + e2e`.

---

## Phase 8 — Engagement and administration

### Task 8: Notifications service + wiring + bell UI

**Files:**
- Create: `src/server/modules/notifications/service.ts`, `src/app/api/v1/notifications/route.ts` (GET list+unread; PATCH `{id?}` mark one/all), `src/features/notifications/bell.tsx` (dropdown + unread badge + 30s `setInterval`/`fetch` polling — repo has no TanStack Query), mount into `src/components/shared/site-header.tsx`
- Modify: notify call sites — `identity/service.ts` register → `notify(u,"account",…)`; `orders/checkout.ts` order.created; `orders/outcome.ts` payment PAID/FAILED; `orders/fulfillment.ts` SHIPPED/DELIVERED → notify buyer; `orders/returns.ts` decisions; `orders/service.ts` cancel. If T10 lands after T8 it wires its own; if before, wire `decideApplication` too.
- Modify: `openapi.yaml`, messages (`notifications` namespace).
- Test: `tests/integration/notifications.test.ts`

**Interfaces:**
```ts
export type NType = "account"|"seller_application"|"order"|"payment"|"shipment"|"return"|"voucher";
export function notify(db: DB | Tx, userId: string, type: NType,
  n: {title: string; body?: string; href?: string}): void
// notification_preferences (userId,type) enabled=false → skip; default enabled.
export function listNotifications(db, actor, {cursor?, limit?}): {items; nextCursor; unread: number}
export function markRead(db, actor, id: string): void   // owner only
export function markAllRead(db, actor): number
```

- [ ] **Step 1: Failing tests** — notify + unread count; disabled pref suppresses; markRead/markAllRead ownership (other user's id → FORBIDDEN); placeOrder → buyer `order` notification; deliverSellerOrder → buyer `shipment` notification.
- [ ] **Step 2: Implement + wire + route + bell UI.** openapi.yaml; `make check`; commit `feat: notifications`.

---

### Task 9: Reviews service + UI + moderation

**Files:**
- Create: `src/server/modules/reviews/service.ts`, `src/app/api/v1/reviews/route.ts` (POST), `src/app/api/v1/reviews/[id]/route.ts` (PATCH/DELETE), `src/features/reviews/review-form.tsx`, reviews section on `products/[slug]` page + "Write review" per eligible item on `account/orders/[id]`; admin hide/unhide as a second table on `admin/moderation`.
- Modify: `openapi.yaml`, messages (`reviews` namespace).
- Test: `tests/integration/reviews.test.ts`

**Interfaces:**
```ts
export function createReview(db, actor, input: {orderItemId: string; rating: number;
  title?: string; body?: string; images?: string[]}): string
// parent order.userId === actor.userId ∧ parent.status ∈ {DELIVERED,COMPLETED,PARTIALLY_REFUNDED};
// rating int 1..5; UNIQUE(order_item_id) conflict → INVALID_INPUT "already reviewed";
// product.shopId ∉ actor.memberships[].shopId (seller can't review own shop; ADMIN exempt);
// images → reviews.imagesJson.
export function updateReview(db, actor, reviewId, patch: {rating?; title?; body?}): void // author only
export function deleteReview(db, actor, reviewId): void   // author or admin
export function moderateReview(db, actor, reviewId, action: "HIDE"|"UNHIDE", note?): void
// admin:*; status PUBLISHED↔HIDDEN; audit_logs row "review.moderate".
export function listReviewableItems(db, actor): {orderItemId; productName; orderId}[]
```

- [ ] **Step 1: Failing tests** — create on delivered item; duplicate → INVALID_INPUT; non-buyer FORBIDDEN; shop member FORBIDDEN on own product; author edit/delete; admin HIDE → excluded from `listProductReviews` and `ratingAvg`.
- [ ] **Step 2: Implement + routes + UI.** openapi.yaml; `make check`; commit `feat: reviews`.

---

### Task 10: Seller onboarding + shop lifecycle

**Files:**
- Create: `src/server/modules/sellers/service.ts`, `src/server/api/contracts/seller.ts`, `src/app/[locale]/(storefront)/sell/page.tsx`, `src/app/[locale]/admin/applications/page.tsx`, `src/features/sellers/apply-form.tsx`, `src/features/admin/application-table.tsx`, `src/app/[locale]/seller/settings/page.tsx`
- Modify: messages; storefront nav ("Sell" link).
- Test: `tests/integration/sellers.test.ts`

**Interfaces:**
```ts
export const ApplyInput = z.object({
  shopName: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(""),
  businessInfo: z.record(z.string(), z.string()).default({}),
});
export function applyToSell(db, actor, input): string
// requirePermission(actor,"seller:apply"); PENDING application → INVALID_INPUT;
// CHANGES_REQUESTED → resubmit updates the same row to PENDING (clears decided_*).
export function myApplication(db, actor)
export function listApplications(db, actor, {status?, cursor?, limit?})   // admin:*
export function decideApplication(db, actor, appId,
  d: {decision:"APPROVED"|"REJECTED"|"CHANGES_REQUESTED"; note?: string}): void
// admin:*; tx: row update + APPROVED ⇒ insert shops (slug=slugify(shopName), UNIQUE
// collision → "-2"), shop_memberships OWNER, user_roles SELLER onConflictDoNothing;
// audit_logs "seller_application.decide"; notify(applicant,"seller_application",…)
// (wire if T8 landed; else `// notify` comment for T8).
export function setShopStatus(db, actor, shopId, status: "ACTIVE"|"SUSPENDED"): void // admin:*
export function updateShopProfile(db, actor, shopId, {name?, description?})          // shop:manage {shopId}
```

- [ ] **Step 1: Failing tests** — apply→PENDING; duplicate PENDING rejected; APPROVED creates shop+membership+role atomically; SUSPENDED shop's products vanish from `listProducts`/`search` (public reads already join `shops.status='ACTIVE'` — test asserts, no new gate code); CHANGES_REQUESTED → resubmit → PENDING; non-admin decide FORBIDDEN.
- [ ] **Step 2: Implement + UI.** `make check`; commit `feat: seller onboarding`.

---

### Task 11: Admin console — dashboard, users, audit

**Files:**
- Create: `src/server/modules/admin/service.ts`, `src/app/[locale]/admin/page.tsx`, `src/app/[locale]/admin/users/page.tsx` + `users/[id]/page.tsx`, `src/app/[locale]/admin/audit/page.tsx`, `src/features/admin/users-table.tsx`
- Modify: admin nav, messages.
- Test: `tests/integration/admin.test.ts`

**Interfaces:**
```ts
export function adminDashboard(db, actor): {
  ordersToday: number; gmvVnd: number; customerCount: number; sellerCount: number;
  pendingApplications: number; moderationQueue: number; pendingReturns: number; lowStock: number }
// gmv = Σ orders.total_vnd WHERE status != 'CANCELLED'; lowStock = variants (on_hand−reserved) <= 5.
export function listUsers(db, actor, {q?, status?, cursor?, limit?})   // q on email/name LIKE
export function getUserDetail(db, actor, userId)
export function setUserStatus(db, actor, userId, status: "ACTIVE"|"SUSPENDED"): void
// suspend → revokeAllSessions(db,userId) in same tx + audit_logs "user.status".
// authenticate already rejects non-ACTIVE users — assert in test, no code change.
export function listAuditLogs(db, actor, {targetType?, targetId?, cursor?, limit?})
```

- [ ] **Step 1: Failing tests** — dashboard counts vs seeds; suspend → sessions revoked + authenticate returns null; audit list shows prior transition rows.
- [ ] **Step 2: Implement + pages.** `make check`; commit `feat: admin console`.

---

### Task 12: Admin ops — orders, refunds, settings, vouchers

**Files:**
- Create: `src/server/modules/admin/ops.ts`, `src/app/[locale]/admin/orders/page.tsx` (+`[id]`), `src/app/[locale]/admin/settings/page.tsx`, `src/app/[locale]/admin/vouchers/page.tsx`, `src/features/admin/settings-form.tsx`
- Modify: admin refunds page (T7) dispute resolution; messages.
- Test: `tests/integration/admin-ops.test.ts`

**Interfaces:**
```ts
export function listAdminOrders(db, actor, {q?, status?, cursor?, limit?}) // q on order id / buyer email
export function getAdminOrder(db, actor, orderId)                          // reuse getOrder (admin passes)
export function getSettings(db, actor): Record<string, unknown>
export function setSetting(db, actor, key: string, value: unknown): void
// admin:*; whitelist: commission_rate_bps, shipping_fees, return_window_days,
// auto_complete_days, reservation_ttl_minutes; upsert JSON.stringify(value); audit_logs "settings.update" meta {key}.
export function createPlatformVoucher(db, actor, input): string
// vouchers insert scope PLATFORM — mirror seed row shapes in seed/catalog.ts.
```

- [ ] **Step 1: Failing tests** — `setSetting("shipping_fees",…)` changes `quoteShippingFee`; non-admin FORBIDDEN; created voucher applies in `priceOrder`.
- [ ] **Step 2: Implement + pages.** `make check`; commit `feat: admin ops`.

---

### Task 13: Seller analytics

**Files:**
- Create: `src/server/modules/finance/analytics.ts`, `src/app/[locale]/seller/analytics/page.tsx`, `src/features/seller/analytics-charts.tsx`
- Deps: `pnpm add recharts` (spec §8)
- Docs: `docs/workflows/analytics.md` — metric definitions verbatim.
- Test: `tests/integration/analytics.test.ts`

**Interfaces:**
```ts
export function sellerAnalytics(db, actor, shopId): {
  gmvVnd: number; netSalesVnd: number; orderCount: number; unitsSold: number;
  avgOrderValueVnd: number; cancelRatePct: number; returnRatePct: number;
  lowStockCount: number; estimatedCommissionsVnd: number; pendingSettlementVnd: number;
  bestSellers: {productId: string; name: string; units: number}[];
  daily: {day: string; gmvVnd: number}[];  // last 30 days, zero-filled
}
// requirePermission(actor,"order:read",{shopId}). Definitions (document in analytics.md):
// gmv = Σ seller_orders.subtotal_vnd excl CANCELLED; netSales = gmv − Σ COMPLETED refunds on those legs;
// estimatedCommissions = Σ floor(subtotal*bps/10000); pendingSettlement = Σ PENDING settlements.net_vnd.
```

- [ ] **Step 1: Failing test** — numbers vs fixture incl. one refunded leg.
- [ ] **Step 2: Implement + page (metric cards + Recharts LineChart on `daily` + best-sellers table).** `make check`; commit `feat: seller analytics`.

---

### Task 14: Deferred scope sweep (wishlists, promotions UI, attributes UI, search history)

Deferred phase-3/4 scope — needed for the phase-9 "coherent application" claim. **Descope candidate:** if cut, mark each Planned in docs explicitly.

- [ ] **Wishlists:** `getWishlist`/`toggleWishlistItem`/`listWishlistCards` over T1 tables; heart button on product cards; guest mirror in Zustand `use-wishlist.ts` (localStorage) + merge on login; `account/wishlist` page.
- [ ] **Promotions UI:** admin vouchers/promotions form; seller shop-scoped promotions (`shop:manage`) — mirror seed row shapes.
- [ ] **product_attributes editor:** key/value rows on `seller/products/[id]` (table exists).
- [ ] **Search-history UI:** recent searches under search box for logged-in users; clear-history action (`search_history` + `recordSearch` exist).
- [ ] Tests: one integration test each — wishlist toggle idempotent; promotion create perm-gate; attributes roundtrip; history record+clear. `make check`; commit `feat: deferred storefront scope`.

---

## Phase 9 — Quality and operational hardening

### Task 15: Coverage thresholds + authz-boundary matrix

- [ ] `pnpm add -D @vitest/coverage-v8`; `vitest.config.ts` coverage provider `v8` + thresholds on `src/server/modules/{pricing,orders,inventory,payments,finance}` — measure baseline first, pin at max(measured, 80%) lines/functions; if below 80, pin at measured + known-limitations note (never pin below reality).
- [ ] `Makefile` `test-coverage` target; `docs/testing/testing-strategy.md` records baseline.
- [ ] `tests/integration/authz-boundaries.test.ts` — table-driven: seller-A vs seller-B resources across `getSellerOrder`, fulfillment fns, `decideReturn`, `getSellerProduct`, `generateSettlement` → FORBIDDEN; customer → FORBIDDEN; admin → allowed. ~20 assertions.
- [ ] Gap tests for uncovered branches the report exposes in money/stock modules. `make check`; commit `test: coverage + authz boundaries`.

### Task 16: E2E completion

- [ ] Map spec §23's 20 journeys to existing specs (auth, catalog, checkout, fulfillment, returns ≈ 10). Write the missing: seller onboarding + admin approval (11+15), product moderation (16), voucher validation at checkout (17), locale EN↔VI (18), theme light/dark/system (19), cross-shop denial (20 — seller B loads seller A's order URL → redirect/404).
- [ ] `login(page,email)` helper + seeded ids; serial mode on shared seeds; no fixed timeouts.
- [ ] `pnpm playwright test` green; commit `test: e2e journeys`.

### Task 17: Scalar docs + OpenAPI completion

- [ ] `src/app/api/docs/route.ts` → Scalar HTML (`<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference">`, `data-url="/api/v1/openapi.yaml"`); 404 unless `env.API_DOCS_ENABLED === "true"`. `src/app/api/v1/openapi.yaml/route.ts` serves the file (`readFileSync`, `application/yaml`).
- [ ] openapi.yaml: every route from this plan documented — `/api/v1/notifications`, `/api/v1/reviews` (+`/{id}`), `/api/v1/ready`, `/api/v1/internal/auto-complete`, `/api/v1/openapi.yaml` itself (coverage test forces it — document as a spec-serving endpoint).
- [ ] Smoke: `API_DOCS_ENABLED=true pnpm dev` → `/api/docs` 200 + yaml served. commit `feat: scalar api docs`.

### Task 18: Perf, telemetry, a11y/locale, Postgres-readiness, docs sweep

- [ ] **Indexes:** verify spec §3 list — `notifications(user_id,read_at)` (T1), `reviews(product_id)`, `sessions(expires_at)`, `stock_reservations(expires_at,status)`, `vouchers(code)`, `order_items(product_id)`, `orders(user_id,created_at)`; migration if missing.
- [ ] **Telemetry:** `trace()` spans on `placeOrder`, `persistPaymentOutcome`, `sweepExpiredReservations`, `issueReturnRefunds` (`@vercel/otel` already wired); extend `tests/unit/logger.test.ts` if new secret-ish fields exist.
- [ ] **A11y/locale:** labels on all new form controls; keyboard-reachable actions; i18n parity green; spot-render `/vi` new pages.
- [ ] **Postgres-readiness:** update `docs/database/sqlite-postgresql-portability.md` — no `strftime`/AUTOINCREMENT; nullable-unique `return_item_id` portable (multiple NULLs allowed in Postgres too).
- [ ] **Docs:** roadmap checkboxes for 6–9; `known-limitations.md` + (in-memory rate limit, mock providers, CDN Scalar, single-shot settlements); README new routes. `make verify` green.
- [ ] commit `chore: phase 9 hardening`.

---

## Sequencing

- T1 first. T2 → T4 → T5 → T6 fixed. T7 needs T4+T5. T8–T14 independent of each other after T7 — dispatchable in order; notify call sites in T4/T10 wire whenever T8 lands relative to them (comment sites documented).
- Every new API route → openapi.yaml same commit.
- `make check` per task; `make verify` at phase boundaries (post-T7, post-T14, end).
