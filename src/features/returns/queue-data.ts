import "server-only";

import { eq, inArray } from "drizzle-orm";
import { formatVnd } from "@/lib/format";
import type { DB } from "@/server/db/client";
import { orderItems, returnItems, type returnRequests } from "@/server/db/schema";
import type { ReturnQueueRow } from "./queue";

type ReturnRequest = typeof returnRequests.$inferSelect;
type Enrichment = Map<string, { lines: { name: string; qty: number }[]; refundVnd: number }>;

/** Loads {name, qty} lines + refund total for a batch of return requests. */
export function loadReturnRows(db: DB, ids: string[]): Enrichment {
  const map: Enrichment = new Map();
  if (!ids.length) return map;
  for (const line of db
    .select({
      returnRequestId: returnItems.returnRequestId,
      name: orderItems.nameSnapshot,
      qty: returnItems.qty,
      refundVnd: returnItems.refundVnd,
    })
    .from(returnItems)
    .innerJoin(orderItems, eq(returnItems.orderItemId, orderItems.id))
    .where(inArray(returnItems.returnRequestId, ids))
    .all()) {
    const entry = map.get(line.returnRequestId) ?? { lines: [], refundVnd: 0 };
    entry.lines.push({ name: line.name, qty: line.qty });
    entry.refundVnd += line.refundVnd;
    map.set(line.returnRequestId, entry);
  }
  return map;
}

/** Projects ReturnRequest rows + enrichment into client-safe queue rows. */
export function toQueueRows(
  requests: ReturnRequest[],
  enrich: Enrichment,
  locale: string,
  canDecide: (status: string) => boolean,
): ReturnQueueRow[] {
  return requests.map((r) => ({
    id: r.id,
    sellerOrderId: r.sellerOrderId,
    orderId: r.orderId,
    status: r.status,
    reason: r.reason,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt,
    lines: enrich.get(r.id)?.lines ?? [],
    refund: formatVnd(enrich.get(r.id)?.refundVnd ?? 0, locale),
    canDecide: canDecide(r.status),
  }));
}
