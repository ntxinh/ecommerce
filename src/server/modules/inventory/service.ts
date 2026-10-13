import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import type { DB } from "@/server/db/client";
import {
  applicationSettings,
  inventory,
  inventoryMovements,
  stockReservations,
} from "@/server/db/schema";

/** Query surface shared by the DB handle and a drizzle better-sqlite3 tx — lets
 *  reserveStock/consume/release run inside a caller-owned transaction. */
export type Tx = Pick<DB, "select" | "insert" | "update">;

export type Reservation = typeof stockReservations.$inferSelect;

/** Derived stock: onHand - reserved, clamped ≥0 on the read side only. */
export function availableStock(db: DB, variantId: string): number {
  const row = db.select().from(inventory).where(eq(inventory.variantId, variantId)).get();
  return Math.max(0, (row?.onHand ?? 0) - (row?.reserved ?? 0));
}

export function adjustStock(
  db: DB,
  variantId: string,
  delta: number,
  reason: string,
  actorId?: string,
): void {
  db.transaction((tx) => {
    const res = tx
      .update(inventory)
      .set({ onHand: sql`${inventory.onHand} + ${delta}`, updatedAt: Date.now() })
      .where(and(eq(inventory.variantId, variantId), sql`${inventory.onHand} + ${delta} >= 0`))
      .run();
    if (res.changes === 0) {
      throw new AuthError(
        "INVALID_INPUT",
        400,
        `adjustStock would make onHand negative or variant ${variantId} unknown`,
      );
    }
    tx.insert(inventoryMovements)
      .values({ id: `mov_${ulid()}`, variantId, delta, reason, actorId, createdAt: Date.now() })
      .run();
  });
}

/**
 * Atomically bumps `reserved` when `on_hand - reserved >= qty` inside the
 * caller-supplied tx, then writes an ACTIVE reservation row. Replayed
 * idempotency keys return the existing ACTIVE reservation.
 */
export function reserveStock(
  tx: Tx,
  variantId: string,
  qty: number,
  idempotencyKey: string,
  ttlMs?: number,
): Reservation {
  const existing = tx
    .select()
    .from(stockReservations)
    .where(eq(stockReservations.idempotencyKey, idempotencyKey))
    .get();
  if (existing) {
    if (existing.status === "ACTIVE") return existing;
    throw new AuthError(
      "IDEMPOTENCY_CONFLICT",
      409,
      `idempotency key ${idempotencyKey} already resolved as ${existing.status}`,
    );
  }
  const res = tx
    .update(inventory)
    .set({ reserved: sql`${inventory.reserved} + ${qty}`, updatedAt: Date.now() })
    .where(
      and(
        eq(inventory.variantId, variantId),
        sql`${inventory.onHand} - ${inventory.reserved} >= ${qty}`,
      ),
    )
    .run();
  if (res.changes === 0) {
    throw new AuthError("INSUFFICIENT_STOCK", 409, `insufficient stock for variant ${variantId}`);
  }
  const ttlRow = tx
    .select()
    .from(applicationSettings)
    .where(eq(applicationSettings.key, "reservation_ttl_minutes"))
    .get();
  const ttl = ttlMs ?? (ttlRow ? (JSON.parse(ttlRow.value) as number) : 15) * 60 * 1000;
  const reservation: Reservation = {
    id: `res_${ulid()}`,
    variantId,
    qty,
    status: "ACTIVE",
    idempotencyKey,
    expiresAt: Date.now() + ttl,
    createdAt: Date.now(),
  };
  tx.insert(stockReservations).values(reservation).run();
  return reservation;
}

/** Flips an ACTIVE reservation to CONSUMED and moves qty from reserved into sold (on_hand -= qty, reserved -= qty). */
export function consumeReservation(tx: Tx, reservationId: string): void {
  const row = tx
    .select()
    .from(stockReservations)
    .where(eq(stockReservations.id, reservationId))
    .get();
  if (!row) throw new AuthError("NOT_FOUND", 404, `reservation ${reservationId} not found`);
  if (row.status === "CONSUMED") return; // retry-safe
  if (row.status !== "ACTIVE") {
    throw new AuthError("INVALID_INPUT", 409, `reservation ${reservationId} is ${row.status}`);
  }
  tx.update(stockReservations)
    .set({ status: "CONSUMED" })
    .where(and(eq(stockReservations.id, reservationId), eq(stockReservations.status, "ACTIVE")))
    .run();
  tx.update(inventory)
    .set({
      onHand: sql`${inventory.onHand} - ${row.qty}`,
      reserved: sql`${inventory.reserved} - ${row.qty}`,
      updatedAt: Date.now(),
    })
    .where(eq(inventory.variantId, row.variantId))
    .run();
  tx.insert(inventoryMovements)
    .values({
      id: `mov_${ulid()}`,
      variantId: row.variantId,
      delta: -row.qty,
      reason: "reservation_consumed",
      createdAt: Date.now(),
    })
    .run();
}

/** Flips an ACTIVE reservation to RELEASED and frees qty from reserved. Non-ACTIVE rows are a no-op. */
export function releaseReservation(tx: Tx, reservationId: string, reason: string): void {
  const row = tx
    .select()
    .from(stockReservations)
    .where(eq(stockReservations.id, reservationId))
    .get();
  if (!row) throw new AuthError("NOT_FOUND", 404, `reservation ${reservationId} not found`);
  if (row.status !== "ACTIVE") return;
  tx.update(stockReservations)
    .set({ status: "RELEASED" })
    .where(and(eq(stockReservations.id, reservationId), eq(stockReservations.status, "ACTIVE")))
    .run();
  tx.update(inventory)
    .set({ reserved: sql`${inventory.reserved} - ${row.qty}`, updatedAt: Date.now() })
    .where(eq(inventory.variantId, row.variantId))
    .run();
  tx.insert(inventoryMovements)
    .values({
      id: `mov_${ulid()}`,
      variantId: row.variantId,
      delta: 0,
      reason,
      createdAt: Date.now(),
    })
    .run();
}

/** Releases every ACTIVE reservation past expires_at (as EXPIRED) and returns how many. */
export function sweepExpiredReservations(db: DB, now = Date.now()): number {
  const expired = db
    .select()
    .from(stockReservations)
    .where(and(eq(stockReservations.status, "ACTIVE"), lt(stockReservations.expiresAt, now)))
    .all();
  for (const row of expired) {
    db.transaction((tx) => {
      tx.update(stockReservations)
        .set({ status: "EXPIRED" })
        .where(and(eq(stockReservations.id, row.id), eq(stockReservations.status, "ACTIVE")))
        .run();
      tx.update(inventory)
        .set({ reserved: sql`${inventory.reserved} - ${row.qty}`, updatedAt: now })
        .where(eq(inventory.variantId, row.variantId))
        .run();
      tx.insert(inventoryMovements)
        .values({
          id: `mov_${ulid()}`,
          variantId: row.variantId,
          delta: 0,
          reason: "reservation_expired",
          createdAt: now,
        })
        .run();
    });
  }
  return expired.length;
}
