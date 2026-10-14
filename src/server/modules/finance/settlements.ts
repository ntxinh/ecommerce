import "server-only";

import { and, desc, eq, inArray, lt, notInArray } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import { type Actor, requirePermission } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import {
  refunds,
  returnItems,
  returnRequests,
  sellerOrders,
  sellerSettlements,
  settlementItems,
} from "@/server/db/schema";
import { post } from "./ledger";

export type Settlement = typeof sellerSettlements.$inferSelect;

const commission = (subtotalVnd: number, rateBps: number) =>
  Math.floor((subtotalVnd * rateBps) / 10_000);

/**
 * Creates one PENDING settlement over every COMPLETED leg of the shop not yet
 * in settlement_items (a leg settles at most once — unique index is the guard).
 * admin:* or shop OWNER. Throws INVALID_INPUT when nothing is pending.
 */
export function generateSettlement(db: DB, actor: Actor | null, shopId: string): string {
  if (!actor) throw new AuthError("UNAUTHORIZED", 401);
  if (
    !actor.roles.includes("ADMIN") &&
    !actor.memberships.some((m) => m.shopId === shopId && m.role === "OWNER")
  ) {
    throw new AuthError("FORBIDDEN", 403);
  }

  return db.transaction((tx) => {
    const legs = tx
      .select()
      .from(sellerOrders)
      .where(
        and(
          eq(sellerOrders.shopId, shopId),
          eq(sellerOrders.status, "COMPLETED"),
          notInArray(
            sellerOrders.id,
            tx.select({ id: settlementItems.sellerOrderId }).from(settlementItems),
          ),
        ),
      )
      .all();
    if (legs.length === 0) {
      throw new AuthError("INVALID_INPUT", 422, "no completed legs to settle");
    }

    // COMPLETED refunds on those legs (return-linked only; cancellation
    // refunds have returnItemId NULL and belong to legs that never complete).
    const refundsByLeg = new Map<string, number>();
    for (const row of tx
      .select({
        sellerOrderId: returnRequests.sellerOrderId,
        amountVnd: refunds.amountVnd,
      })
      .from(refunds)
      .innerJoin(returnItems, eq(refunds.returnItemId, returnItems.id))
      .innerJoin(returnRequests, eq(returnItems.returnRequestId, returnRequests.id))
      .where(
        and(
          eq(refunds.status, "COMPLETED"),
          inArray(
            returnRequests.sellerOrderId,
            legs.map((l) => l.id),
          ),
        ),
      )
      .all()) {
      refundsByLeg.set(
        row.sellerOrderId,
        (refundsByLeg.get(row.sellerOrderId) ?? 0) + row.amountVnd,
      );
    }

    let grossVnd = 0;
    let commissionVnd = 0;
    let refundVnd = 0;
    const items = legs.map((so) => {
      const c = commission(so.subtotalVnd, so.commissionRateBps);
      const r = refundsByLeg.get(so.id) ?? 0;
      grossVnd += so.subtotalVnd;
      commissionVnd += c;
      refundVnd += r;
      return {
        sellerOrderId: so.id,
        grossVnd: so.subtotalVnd,
        commissionVnd: c,
        netVnd: so.subtotalVnd - c - r,
      };
    });

    const settlementId = `stl_${ulid()}`;
    tx.insert(sellerSettlements)
      .values({
        id: settlementId,
        shopId,
        status: "PENDING",
        grossVnd,
        commissionVnd,
        refundVnd,
        netVnd: grossVnd - commissionVnd - refundVnd,
        createdAt: Date.now(),
      })
      .run();
    tx.insert(settlementItems)
      .values(items.map((i) => ({ id: `sti_${ulid()}`, settlementId, ...i })))
      .run();
    return settlementId;
  });
}

/** admin:* only — PENDING → PAID and books the SELLER_PAYABLE −net payout. */
export function markSettlementPaid(db: DB, actor: Actor | null, settlementId: string): void {
  requirePermission(actor, "admin:*");
  db.transaction((tx) => {
    const s = tx
      .select()
      .from(sellerSettlements)
      .where(eq(sellerSettlements.id, settlementId))
      .get();
    if (!s) throw new AuthError("NOT_FOUND", 404, "settlement not found");
    if (s.status !== "PENDING") {
      throw new AuthError("INVALID_INPUT", 422, "settlement already paid");
    }
    tx.update(sellerSettlements)
      .set({ status: "PAID", paidAt: Date.now() })
      .where(eq(sellerSettlements.id, settlementId))
      .run();
    post(tx, {
      account: "SELLER_PAYABLE",
      shopId: s.shopId,
      amountVnd: -s.netVnd,
      refType: "SETTLEMENT",
      refId: settlementId,
    });
  });
}

/**
 * Settlement list (seller center / admin). Shop actors get `order:read` on the
 * requested shop — or their single membership when shopId is omitted — so they
 * only ever see their own; ADMIN may list everything. ULID-desc cursor, max 50.
 */
export function listSettlements(
  db: DB,
  actor: Actor | null,
  opts: { shopId?: string; status?: Settlement["status"]; cursor?: string; limit?: number } = {},
): { items: Settlement[]; nextCursor: string | null } {
  let shopId = opts.shopId;
  if (!actor?.roles.includes("ADMIN")) {
    shopId ??= actor?.memberships.length === 1 ? actor.memberships[0].shopId : undefined;
    requirePermission(actor, "order:read", { shopId });
  }
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const conds = [];
  if (shopId) conds.push(eq(sellerSettlements.shopId, shopId));
  if (opts.status) conds.push(eq(sellerSettlements.status, opts.status));
  if (opts.cursor) conds.push(lt(sellerSettlements.id, opts.cursor));
  const rows = db
    .select()
    .from(sellerSettlements)
    .where(and(...conds))
    .orderBy(desc(sellerSettlements.id))
    .limit(limit + 1)
    .all();
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
}
