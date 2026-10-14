import "server-only";

import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import { type Actor, requirePermission } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import {
  inventory,
  orderItems,
  products,
  productVariants,
  refunds,
  returnItems,
  returnRequests,
  sellerOrders,
  sellerSettlements,
} from "@/server/db/schema";

export type SellerAnalytics = {
  gmvVnd: number;
  netSalesVnd: number;
  orderCount: number;
  unitsSold: number;
  avgOrderValueVnd: number;
  cancelRatePct: number;
  returnRatePct: number;
  lowStockCount: number;
  estimatedCommissionsVnd: number;
  pendingSettlementVnd: number;
  bestSellers: { productId: string; name: string; units: number }[];
  daily: { day: string; gmvVnd: number }[]; // last 30 days, zero-filled
};

const commission = (subtotalVnd: number, rateBps: number) =>
  Math.floor((subtotalVnd * rateBps) / 10_000);

/**
 * Seller dashboard metrics for one shop. `order:read` gate — ADMIN bypasses.
 * Definitions (mirrored in docs/workflows/analytics.md):
 * gmv = Σ seller_orders.subtotal_vnd excl CANCELLED; netSales = gmv − Σ
 * COMPLETED refunds on those legs; estimatedCommissions = Σ
 * floor(subtotal*bps/10000); pendingSettlement = Σ PENDING settlements.net_vnd.
 * cancelRate = CANCELLED legs / all legs; returnRate = legs RETURNED or with
 * any COMPLETED return refund / all legs. `daily` buckets gmv by UTC day.
 */
export function sellerAnalytics(db: DB, actor: Actor | null, shopId: string): SellerAnalytics {
  requirePermission(actor, "order:read", { shopId });

  const legs = db.select().from(sellerOrders).where(eq(sellerOrders.shopId, shopId)).all();
  const live = legs.filter((l) => l.status !== "CANCELLED");
  const gmvVnd = live.reduce((n, l) => n + l.subtotalVnd, 0);
  const estimatedCommissionsVnd = live.reduce(
    (n, l) => n + commission(l.subtotalVnd, l.commissionRateBps),
    0,
  );

  // COMPLETED refunds on this shop's legs (return-linked; cancellation refunds
  // have returnItemId NULL and their legs never reach non-CANCELLED anyway).
  const refundRows = db
    .select({ sellerOrderId: returnRequests.sellerOrderId, amountVnd: refunds.amountVnd })
    .from(refunds)
    .innerJoin(returnItems, eq(refunds.returnItemId, returnItems.id))
    .innerJoin(returnRequests, eq(returnItems.returnRequestId, returnRequests.id))
    .innerJoin(sellerOrders, eq(returnRequests.sellerOrderId, sellerOrders.id))
    .where(and(eq(sellerOrders.shopId, shopId), eq(refunds.status, "COMPLETED")))
    .all();
  const refundedVnd = refundRows.reduce((n, r) => n + r.amountVnd, 0);
  const refundedLegs = new Set(refundRows.map((r) => r.sellerOrderId));

  // Units + best sellers come from one grouped query over non-CANCELLED legs.
  const perProduct = db
    .select({
      productId: orderItems.productId,
      name: products.nameEn,
      units: sql<number>`sum(${orderItems.qty})`,
    })
    .from(orderItems)
    .innerJoin(sellerOrders, eq(orderItems.sellerOrderId, sellerOrders.id))
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(and(eq(sellerOrders.shopId, shopId), ne(sellerOrders.status, "CANCELLED")))
    .groupBy(orderItems.productId, products.nameEn)
    .orderBy(desc(sql`sum(${orderItems.qty})`), orderItems.productId)
    .all();
  const unitsSold = perProduct.reduce((n, p) => n + p.units, 0);

  const lowStockCount =
    db
      .select({ n: count() })
      .from(inventory)
      .innerJoin(productVariants, eq(inventory.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(
        and(eq(products.shopId, shopId), sql`${inventory.onHand} - ${inventory.reserved} <= 5`),
      )
      .all()[0]?.n ?? 0;

  const pendingSettlementVnd =
    db
      .select({ n: sql<number>`coalesce(sum(${sellerSettlements.netVnd}), 0)` })
      .from(sellerSettlements)
      .where(and(eq(sellerSettlements.shopId, shopId), eq(sellerSettlements.status, "PENDING")))
      .all()[0]?.n ?? 0;

  // ponytail: UTC day boundary; a store-local bucket only matters if ops cares.
  const dayStart = (d: Date) => d.toISOString().slice(0, 10);
  const byDay = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    byDay.set(dayStart(new Date(Date.now() - i * 86_400_000)), 0);
  }
  const windowStart = byDay.keys().next().value!;
  for (const l of live) {
    const day = dayStart(new Date(l.createdAt));
    if (byDay.has(day)) byDay.set(day, byDay.get(day)! + l.subtotalVnd);
  }

  const returnedLegs = legs.filter((l) => l.status === "RETURNED" || refundedLegs.has(l.id)).length;
  const cancelledLegs = legs.length - live.length;
  const rate = (n: number) => (legs.length ? Math.round((n / legs.length) * 1000) / 10 : 0);

  return {
    gmvVnd,
    netSalesVnd: gmvVnd - refundedVnd,
    orderCount: live.length,
    unitsSold,
    avgOrderValueVnd: live.length ? Math.floor(gmvVnd / live.length) : 0,
    cancelRatePct: rate(cancelledLegs),
    returnRatePct: rate(returnedLegs),
    lowStockCount,
    estimatedCommissionsVnd,
    pendingSettlementVnd,
    bestSellers: perProduct.slice(0, 5),
    daily: [...byDay].map(([day, v]) => ({ day, gmvVnd: v })),
  };
}
