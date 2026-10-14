import "server-only";

import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { ulid } from "ulidx";
import type { RequestReturnInputType } from "@/server/api/contracts/returns";
import { AuthError } from "@/server/api/errors";
import { type Actor, requirePermission } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import { orderItems, orders, returnItems, returnRequests, sellerOrders } from "@/server/db/schema";
import { settingNumber } from "@/server/db/settings";
import { issueReturnRefunds } from "@/server/modules/payments/refunds";
import { deliveredAt } from "./fulfillment";
import { type Tx, transitionSellerOrder } from "./transitions";

type ReturnRequest = typeof returnRequests.$inferSelect;
type ReturnItem = typeof returnItems.$inferSelect;

/** Return-request statuses that still consume an item's returnable qty —
 *  DISPUTED included: an unresolved claim can't be re-sold to a second
 *  request. */
const QTY_HOLDING = ["PENDING", "APPROVED", "REFUNDED", "DISPUTED"] as const;

function loadLeg(tx: Tx, sellerOrderId: string) {
  const so = tx.select().from(sellerOrders).where(eq(sellerOrders.id, sellerOrderId)).get();
  if (!so) throw new AuthError("NOT_FOUND", 404, "seller order not found");
  const order = tx.select().from(orders).where(eq(orders.id, so.orderId)).get();
  if (!order) throw new AuthError("NOT_FOUND", 404, "order not found");
  return { so, order };
}

/**
 * Files a return request for items of one DELIVERED|COMPLETED leg. Gates:
 * order owner only, return window (`return_window_days` setting, default 7),
 * per-item qty not exceeding purchased minus already-claimed returnable qty.
 * A DELIVERED leg flips to RETURN_REQUESTED; COMPLETED legs stay put.
 */
export function requestReturn(db: DB, actor: Actor, input: RequestReturnInputType): string {
  return db.transaction((tx) => {
    if (!input.items.length) {
      throw new AuthError("INVALID_INPUT", 400, "no items");
    }
    const { so, order } = loadLeg(tx, input.sellerOrderId);
    if (order.userId !== actor.userId) {
      throw new AuthError("FORBIDDEN", 403, "only the buyer can file a return");
    }
    if (so.status !== "DELIVERED" && so.status !== "COMPLETED") {
      throw new AuthError("INVALID_STATE", 409, `seller order is ${so.status}, not returnable`);
    }
    const delivered = deliveredAt(tx, so.id);
    const windowMs = settingNumber(tx, "return_window_days", 7) * 86_400_000;
    if (delivered === null || Date.now() - delivered > windowMs) {
      throw new AuthError("RETURN_WINDOW_EXPIRED", 409, "return window expired");
    }

    // Qty already claimed by live requests (REJECTED lines free theirs).
    const priorIds = tx
      .select({ id: returnRequests.id })
      .from(returnRequests)
      .where(
        and(
          eq(returnRequests.sellerOrderId, so.id),
          inArray(returnRequests.status, [...QTY_HOLDING]),
        ),
      )
      .all()
      .map((r) => r.id);
    const claimed = new Map<string, number>();
    if (priorIds.length) {
      for (const line of tx
        .select({ orderItemId: returnItems.orderItemId, qty: returnItems.qty })
        .from(returnItems)
        .where(inArray(returnItems.returnRequestId, priorIds))
        .all()) {
        claimed.set(line.orderItemId, (claimed.get(line.orderItemId) ?? 0) + line.qty);
      }
    }

    const items = tx.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id)).all();
    const byId = new Map(items.map((i) => [i.id, i]));
    const lines = input.items.map((line) => {
      const item = byId.get(line.orderItemId);
      const used = (claimed.get(line.orderItemId) ?? 0) + line.qty;
      if (!item || used > item.qty) {
        throw new AuthError(
          "INVALID_INPUT",
          422,
          `item ${line.orderItemId} has ${item ? item.qty - (claimed.get(item.id) ?? 0) : 0} returnable`,
        );
      }
      claimed.set(item.id, used);
      return { item, qty: line.qty, restock: line.restock ?? false };
    });

    const id = `rr_${ulid()}`;
    tx.insert(returnRequests)
      .values({
        id,
        sellerOrderId: so.id,
        orderId: order.id,
        userId: actor.userId,
        status: "PENDING",
        reason: input.reason,
        evidenceJson: JSON.stringify(input.evidence ?? []),
        createdAt: Date.now(),
      })
      .run();
    for (const { item, qty, restock } of lines) {
      tx.insert(returnItems)
        .values({
          id: `ri_${ulid()}`,
          returnRequestId: id,
          orderItemId: item.id,
          qty,
          restock,
          refundVnd: Math.floor((item.lineTotalVnd * qty) / item.qty),
        })
        .run();
    }
    if (so.status === "DELIVERED") {
      transitionSellerOrder(tx, so.id, "RETURN_REQUESTED", actor);
    }
    return id;
  });
}

/**
 * Paged return-request list. Customer scope is the caller's own requests;
 * `opts.shopId` switches to the seller view (`order:read` on that shop);
 * ADMIN with a shopId also takes the seller view. ULID-desc cursor, max 50.
 */
export function listReturnRequests(
  db: DB,
  actor: Actor,
  opts: { shopId?: string; status?: string; cursor?: string; limit?: number } = {},
): { items: ReturnRequest[]; nextCursor: string | null } {
  const conds = [];
  if (opts.shopId) {
    requirePermission(actor, "order:read", { shopId: opts.shopId });
    conds.push(eq(sellerOrders.shopId, opts.shopId));
  } else if (!actor.roles.includes("ADMIN")) {
    conds.push(eq(returnRequests.userId, actor.userId));
  }
  if (opts.status) conds.push(eq(returnRequests.status, opts.status as ReturnRequest["status"]));
  if (opts.cursor) conds.push(lt(returnRequests.id, opts.cursor));
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const rows = db
    .select({ request: returnRequests })
    .from(returnRequests)
    .innerJoin(sellerOrders, eq(returnRequests.sellerOrderId, sellerOrders.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(returnRequests.id))
    .limit(limit + 1)
    .all()
    .map((r) => r.request);
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
}

/** Request + its item lines. Buyer sees own; `order:read` members and admin see all. */
export function getReturnRequest(
  db: DB,
  actor: Actor,
  id: string,
): { request: ReturnRequest; items: ReturnItem[] } {
  const request = db.select().from(returnRequests).where(eq(returnRequests.id, id)).get();
  if (!request) throw new AuthError("NOT_FOUND", 404, "return request not found");
  if (request.userId !== actor.userId) {
    const so = db
      .select({ shopId: sellerOrders.shopId })
      .from(sellerOrders)
      .where(eq(sellerOrders.id, request.sellerOrderId))
      .get();
    requirePermission(actor, "order:read", { shopId: so?.shopId });
  }
  const items = db.select().from(returnItems).where(eq(returnItems.returnRequestId, id)).all();
  return { request, items };
}

/**
 * Seller decision on a return request: PENDING only for shop members
 * (`order:write`); ADMIN may additionally decide a DISPUTED one. APPROVED fires
 * `issueReturnRefunds` (no-op until Task 5); REJECTED releases a
 * RETURN_REQUESTED leg back to COMPLETED.
 */
export function decideReturn(
  db: DB,
  actor: Actor,
  id: string,
  decision: "APPROVED" | "REJECTED",
  note?: string,
): void {
  db.transaction((tx) => {
    const request = tx.select().from(returnRequests).where(eq(returnRequests.id, id)).get();
    if (!request) throw new AuthError("NOT_FOUND", 404, "return request not found");
    const { so } = loadLeg(tx, request.sellerOrderId);
    requirePermission(actor, "order:write", { shopId: so.shopId });

    const adminOverride = actor.roles.includes("ADMIN") && request.status === "DISPUTED";
    if (!(request.status === "PENDING" || adminOverride)) {
      throw new AuthError("INVALID_STATE", 409, `return request is ${request.status}`);
    }

    tx.update(returnRequests)
      .set({
        status: decision,
        decidedBy: actor.userId,
        decidedAt: Date.now(),
        decisionNote: note ?? null,
      })
      .where(eq(returnRequests.id, id))
      .run();

    if (decision === "APPROVED") {
      issueReturnRefunds(tx, id);
    } else if (so.status === "RETURN_REQUESTED") {
      transitionSellerOrder(tx, so.id, "COMPLETED", actor);
    }
  });
}

/** Buyer escalates a REJECTED request to DISPUTED for admin adjudication. */
export function disputeReturn(db: DB, actor: Actor, id: string): void {
  db.transaction((tx) => {
    const request = tx.select().from(returnRequests).where(eq(returnRequests.id, id)).get();
    if (!request) throw new AuthError("NOT_FOUND", 404, "return request not found");
    if (request.userId !== actor.userId) {
      throw new AuthError("FORBIDDEN", 403, "only the buyer can dispute a return");
    }
    if (request.status !== "REJECTED") {
      throw new AuthError("INVALID_STATE", 409, `return request is ${request.status}`);
    }
    tx.update(returnRequests).set({ status: "DISPUTED" }).where(eq(returnRequests.id, id)).run();
  });
}
