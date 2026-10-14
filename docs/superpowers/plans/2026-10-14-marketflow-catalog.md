# MarketFlow Slice 3 — Catalog & Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers can browse a real homepage (categories, flash-sale, featured shops, trending, recently-viewed), navigate hierarchical categories, search with filters/sort/pagination, and visit public shop storefronts; sellers can manage their product catalog (CRUD + publish flow); admins can moderate listings.

**Architecture:** Adds `catalog` + `search` server modules on the existing schema; `product_images` added for real imagery; seller-facing product management under `/[locale]/seller/products`; moderation under `/[locale]/admin/moderation`. FTS via SQLite `LIKE`/FTS5 — encapsulate in `search` module so Postgres swap is isolated.

**Tech Stack:** existing — Drizzle/better-sqlite3, zod, next-intl, vitest, playwright, shadcn, zustand (recently-viewed/compare client state).

**Spec:** `docs/superpowers/specs/2026-10-13-marketflow-design.md` §3,§8 + prompt §6.1–6.3, §7.3, §13 (moderation), §23.

## Global Constraints

- `_at` ms epochs; `_vnd` integer; ULID/fixed ids; `import "server-only";` on all `src/server/**`.
- All user-facing strings in BOTH `messages/{en,vi}.json`.
- Server Components fetch via services; client islands only where interactive.
- Image assets: seed uses `public/seed/` local images (placehold.co placeholders generated/downloaded at seed time are fine — but prefer checked-in SVG/PNG placeholders under `public/seed/` so e2e is hermetic).
- `make check` + `pnpm playwright test` green per task; each task commits.
- Product visibility rules: storefront shows only `products.status = "ACTIVE"`; DRAFT/ARCHIVED never leak into public queries (search/category/home). Sellers see own products all statuses; admins see all.

---

### Task 1: Product images + reviews-lite schema + catalog service

**Files:**
- Create: `src/server/db/schema/reviews.ts` (reviews table — needed for rating display), `src/server/modules/catalog/service.ts`, `src/server/db/seed/media.ts` (seed product images)
- Modify: `src/server/db/schema/catalog.ts` (add `productImages`, `productAttributes` if missing), `src/server/db/seed/catalog.ts` (call seedMedia)
- Test: `tests/integration/catalog-service.test.ts`

**Interfaces:**
- Produces:
  - `productImages(id, productId, variantId?, url, alt, sortOrder)` — add to catalog schema + migration.
  - `reviews(id, orderItemId UNIQUE, productId, userId, rating int 1-5, title?, body?, status enum PUBLISHED|HIDDEN, createdAt)` — moderation flag for later; seeded ratings on some products.
  - Catalog service:
    - `listCategories(db): CategoryTree` — nested by parentId.
    - `listProducts(db, opts: {categoryId?, shopId?, status?, q?, minPriceVnd?, maxPriceVnd?, minRating?, inStock?, sort?, cursor?, limit?}): {items, nextCursor}` — the single listing function everything else uses.
    - `getProductBySlug(db, slug): ProductDetail` — product + variants + images + rating aggregate + shop card. Throws NOT_FOUND on missing/non-ACTIVE for public callers.
    - `getShopBySlug(db, slug)` + `listShopProducts` reuse listProducts.
    - `getHomepageData(db): { categories, flashSale[], featuredShops[], trending[], newest[] }` — flash-sale = active FLASH promotions; trending = most ordered (order_items count); newest = latest ACTIVE.
    - `recordRecentlyViewed` is client-side (Zustand localStorage) — no server function.
  - `RatingAgg = {avg, count}` computed via `avg(rating), count(*)` on PUBLISHED reviews.
- Consumes: existing schema + `availableStock`.

- [ ] **Step 1:** Schema additions (`productImages`, `reviews`), migration via `make db-generate`.
- [ ] **Step 2:** `seedMedia` — 1–2 images per product (placehold.co URLs OK for dev; add `public/seed/*.svg` placeholders and reference those for determinism), 4–6 seeded PUBLISHED reviews across products (from seeded users on fake order_items — create minimal order_item fixtures OR relax reviews to not require orderItemId for seed… NO: keep `orderItemId UNIQUE` nullable? Spec says reviews tie to order items. Simplest: `orderItemId` nullable in this slice; uniqueness enforced when non-null. Document decision.)
- [ ] **Step 3:** Failing integration test: listProducts filters (category, shop, price range, minRating, inStock, sort price asc/desc/newest/rating, cursor pagination stable); getProductBySlug returns images+rating; non-ACTIVE excluded from public listing; homepage sections populated.
- [ ] **Step 4:** Implement; `make check` green; commit `feat: catalog service + images + reviews schema`.

---

### Task 2: Search service

**Files:**
- Create: `src/server/modules/search/service.ts`, `src/server/api/contracts/search.ts`, `src/app/api/v1/search/route.ts` (GET)
- Test: `tests/integration/search.test.ts`

**Interfaces:**
- Produces:
  - `search(db, params: SearchParams): {items, total, nextCursor}` — name/description/sku/brand LIKE matching (case-insensitive via `lower()`), filters same shape as listProducts + sort `relevance|price_asc|price_desc|rating|newest|popular`. Relevance = simple score: name-match > sku/brand > description (documented heuristic, postgres FTS upgrade path in portability doc).
  - `suggest(db, q): string[]` — top product names matching prefix, for autocomplete.
  - Search history: `search_history(id, userId, query, createdAt)` — write on authenticated search; recent-searches endpoint optional (defer UI, keep table + write).
- Consumes: catalog service internals where shared (filter builder).

- [ ] **Step 1:** Failing tests — q matches name/sku/brand/description; filters compose; sort correctness; pagination; suggestions; history written for authed user.
- [ ] **Step 2:** Implement; add `searchHistory` table + migration; route `GET /api/v1/search?q=&sort=&cursor=`.
- [ ] **Step 3:** `make check`; commit `feat: search service`.

---

### Task 3: Storefront pages — homepage, category, product detail, search

**Files:**
- Create: `src/app/[locale]/(storefront)/page.tsx` (replaces placeholder), `.../categories/[slug]/page.tsx`, `.../search/page.tsx`, `.../shops/[slug]/page.tsx`, `features/catalog/*` (product-card, price, rating-stars, filters-bar, pagination, recently-viewed store)
- Modify: `src/components/shared/site-header.tsx` (search box + categories nav), messages
- Test: e2e additions land in Task 6.

**Interfaces:**
- Consumes: `getHomepageData`, `listCategories`, `listProducts`, `getProductBySlug`, `getShopBySlug`, `search`.
- Produces: public pages; `useRecentlyViewed` zustand store (localStorage, product ids); product detail records view on mount (client effect, logged-in or not).

- [ ] **Step 1:** Homepage server component: sections — categories strip, flash-sale grid w/ countdown to `endsAt` (client component for countdown), featured shops (active shops w/ product counts), trending (top ordered), newest grid, recently-viewed rail (client, reads store → fetch via `/api/v1/products?ids=` small route OR server component can't — use a client fetch to a new `GET /api/v1/products?ids=` endpoint; add it).
- [ ] **Step 2:** Category page (listProducts w/ categoryId + filters sidebar: price range, min rating, in-stock; sort select; cursor load-more). Search page same list + q + suggestions dropdown in header search box (client, debounced fetch to `/api/v1/search/suggest` — add route or reuse `/api/v1/search?mode=suggest`).
- [ ] **Step 3:** Product detail: gallery (images carousel), variant selector wired to price/stock, attributes table, rating summary + reviews list (paginated), shop card link, add-to-cart (exists), related products (same category). Shop storefront page: banner/name/description + product grid.
- [ ] **Step 4:** All strings en+vi. `make check` + smoke `/en`, `/en/categories/…`, `/en/search?q=`, `/en/products/…`, `/en/shops/…`. Commit `feat: storefront catalog pages`.

---

### Task 4: Seller product management

**Files:**
- Create: `src/app/[locale]/seller/products/page.tsx` + `[id]/page.tsx` + `new/page.tsx`, `features/seller/*` (product-form w/ variants editor, product-table, publish-toggle), `src/server/modules/catalog/manage.ts` (seller write ops), `src/server/api/contracts/catalog.ts`
- Test: `tests/integration/catalog-manage.test.ts`

**Interfaces:**
- Produces:
  - `createProduct(db, actor, input)`, `updateProduct(db, actor, productId, input)`, `setProductStatus(db, actor, productId, DRAFT|ACTIVE|ARCHIVED)`, `duplicateProduct`, `upsertVariant(db, actor, productId, variant)`, `setVariantStock(db, actor, variantId, onHand, reason)` (delegates to `adjustStock`).
  - Authz: every op resolves product→shopId → `requirePermission(actor, "product:write", {shopId})`; reads `product:read`.
  - `ProductInput` Zod: names en/vi, categoryId, brandId?, description, status; `VariantInput`: sku, names, attrs JSON, basePriceVnd, salePriceVnd?.
- Consumes: everything existing.

- [ ] **Step 1:** Failing integration tests — create→DRAFT, publish→appears in public list, duplicate creates variant copies with `-COPY` skus, cross-shop write → FORBIDDEN, staff w/o `product:write` denied, sku uniqueness enforced.
- [ ] **Step 2:** Implement service + seller UI: product table (status badges, actions), edit form w/ variants repeater, new-product form, publish/archive actions.
- [ ] **Step 3:** `make check` + smoke as `seller@`: create draft → publish → visible on storefront. Commit `feat: seller product management`.

---

### Task 5: Admin catalog moderation

**Files:**
- Create: `src/app/[locale]/admin/moderation/page.tsx`, `src/app/[locale]/admin/categories/page.tsx`, `src/server/modules/catalog/moderation.ts`, `features/admin/moderation-table.tsx`
- Modify: admin layout nav
- Test: `tests/integration/moderation.test.ts`

**Interfaces:**
- Produces:
  - `listModerationQueue(db, actor)` — products PENDING_REVIEW… need new status? Products have DRAFT|ACTIVE|ARCHIVED. Add `moderationStatus` column? Simplest per spec §7.3 "submit for moderation": add `moderationStatus enum NONE|SUBMITTED|APPROVED|REJECTED|SUSPENDED` to products (migration) — seller `submitForReview` sets SUBMITTED; admin `moderateProduct(db, actor, productId, decision:"approve"|"reject"|"suspend", note)` writes `productModerations` row + updates status.
  - `productModerations(id, productId, actorId, action enum SUBMIT|APPROVE|REJECT|SUSPEND, note, createdAt)` — audit trail.
  - Admin categories CRUD: `createCategory`, `updateCategory`, `deleteCategory` (guard: can't delete category with products → error or reassign? simplest: forbid when products exist, error surfaced).
- Consumes: products table + requirePermission admin.

- [ ] **Step 1:** Failing tests — submit→queue, approve→ACTIVE, reject→DRAFT+note recorded, suspend→hidden from public, non-admin denied, category delete-with-products blocked.
- [ ] **Step 2:** Implement + migration + admin UI (queue table w/ approve/reject/suspend + note dialog; categories management page). Wire seller "Submit for review" action into seller products (Task 4 UI).
- [ ] **Step 3:** `make check`; commit `feat: catalog moderation`.

---

### Task 6: E2E + docs + OpenAPI extension

**Files:**
- Create/extend: `tests/e2e/catalog.spec.ts`, `docs/api/openapi.yaml` (add search + products routes), `docs/database/data-model.md`, `docs/roadmap/implementation-plan.md`, `docs/api/api-conventions.md` if routes added.
- Test: e2e spec.

**Interfaces:**
- Routes added this slice must be in openapi.yaml (coverage test enforces): `/api/v1/search`, `/api/v1/products`, `/api/v1/search/suggest` (whichever exist).

- [ ] **Step 1:** e2e `catalog.spec.ts`: homepage renders sections; search `teapot` → results → product page; category browse + price filter; shop storefront; seller creates draft → submits → admin approves → appears publicly (2-user journey across roles).
- [ ] **Step 2:** Extend openapi.yaml + docs to Implemented.
- [ ] **Step 3:** `make verify` green; commit `feat: catalog e2e + docs`.

---

## Deferred (documented)
- `product_attributes` full attribute-management UI (attributes stored as JSON on variants — management UI deferred; spec's attribute CRUD in admin is Phase 8 scope anyway).
- Search history UI (table + writes implemented; UI surface deferred).
- Wishlists/compare (Phase 4 scope), reviews submission UI (Phase 8), email notifications for moderation (Phase 8 notifications).
- Postgres FTS adapter — encapsulation only.
