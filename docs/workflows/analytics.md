# Seller analytics

`sellerAnalytics(db, actor, shopId)` in `src/server/modules/finance/analytics.ts`
backs `/seller/analytics`. Access: `requirePermission(actor, "order:read", { shopId })`
— shop members with `order:read` (OWNER implicitly) or ADMIN.

## Metric definitions

A "leg" is one row of `seller_orders` — a shop's share of one order.

| Metric | Definition |
|---|---|
| `gmvVnd` | `Σ seller_orders.subtotal_vnd` excluding `CANCELLED` legs |
| `netSalesVnd` | `gmv − Σ COMPLETED refunds on those legs` |
| `orderCount` | count of non-`CANCELLED` legs |
| `unitsSold` | `Σ order_items.qty` over non-`CANCELLED` legs |
| `avgOrderValueVnd` | `floor(gmvVnd / orderCount)`, `0` when no legs |
| `cancelRatePct` | `CANCELLED / all legs × 100`, one decimal |
| `returnRatePct` | legs `RETURNED` **or** with any `COMPLETED` refund `/` all legs `× 100`, one decimal |
| `lowStockCount` | variants of this shop's products with `on_hand − reserved <= 5` (same threshold as the admin dashboard) |
| `estimatedCommissionsVnd` | `Σ floor(subtotal*bps/10000)` over non-`CANCELLED` legs |
| `pendingSettlementVnd` | `Σ PENDING settlements.net_vnd` for the shop |
| `bestSellers` | top 5 products by `Σ qty` over non-`CANCELLED` legs |
| `daily` | last 30 days, zero-filled `{day, gmvVnd}` |

Notes:

- **Rates** use *all* legs (including `CANCELLED`) as the denominator;
  `0` when the shop has no legs at all.
- **Refunds** counted are return-linked only (`refunds.returnItemId` joined via
  `return_items → return_requests`). Cancellation refunds have `returnItemId`
  NULL and belong to `CANCELLED` legs already excluded from GMV.
- **`daily` buckets by UTC day**: `new Date(createdAt).toISOString().slice(0,10)`.
  A store-local timezone bucket is a deliberate simplification — revisit if ops
  cares about VN-day boundaries.
- `estimatedCommissionsVnd` is per-leg `floor(subtotal*bps/10000)` — the same
  formula settlements book, before refund rebates.
