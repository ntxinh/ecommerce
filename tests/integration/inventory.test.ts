import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthError } from "@/server/api/errors";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { inventory, inventoryMovements, stockReservations } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import {
  adjustStock,
  availableStock,
  consumeReservation,
  releaseReservation,
  reserveStock,
  sweepExpiredReservations,
} from "@/server/modules/inventory/service";

const PATH = "./tests/.tmp/inventory-test.db";
const VAR = "var_1";
const OTHER_VAR = "var_2";

let db: DB;

function row(variantId = VAR) {
  return db.select().from(inventory).where(eq(inventory.variantId, variantId)).get()!;
}

function movements(variantId = VAR) {
  return db
    .select()
    .from(inventoryMovements)
    .where(eq(inventoryMovements.variantId, variantId))
    .all();
}

function setStock(variantId: string, onHand: number, reserved = 0) {
  db.update(inventory).set({ onHand, reserved }).where(eq(inventory.variantId, variantId)).run();
}

function reservationStatus(id: string) {
  return db.select().from(stockReservations).where(eq(stockReservations.id, id)).get()!.status;
}

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
});

beforeEach(() => {
  db.delete(stockReservations).run();
  db.delete(inventoryMovements).run();
  setStock(VAR, 10);
  setStock(OTHER_VAR, 10);
});

describe("adjustStock", () => {
  it("applies deltas, writes a movement, and rejects negative onHand", () => {
    adjustStock(db, VAR, -4, "damaged", "usr_admin");
    expect(row().onHand).toBe(6);
    adjustStock(db, VAR, 2, "restock");
    expect(row().onHand).toBe(8);

    const movs = movements();
    expect(movs.map((m) => m.delta)).toEqual([-4, 2]);
    expect(movs[0]).toMatchObject({ reason: "damaged", actorId: "usr_admin" });
  });

  it("rejects a delta that would drive onHand below zero and writes nothing", () => {
    expect(() => adjustStock(db, VAR, -11, "shrink")).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT" }) as AuthError,
    );
    expect(row().onHand).toBe(10);
    expect(movements().length).toBe(0);
  });
});

describe("reserveStock", () => {
  it("reserves when stock suffices and fails with INSUFFICIENT_STOCK otherwise", () => {
    setStock(VAR, 5);
    const r = db.transaction((tx) => reserveStock(tx, VAR, 5, "k1", 60_000));
    expect(r.status).toBe("ACTIVE");
    expect(r.expiresAt).toBeGreaterThan(Date.now());
    expect(row().reserved).toBe(5);
    expect(availableStock(db, VAR)).toBe(0);

    expect(() => db.transaction((tx) => reserveStock(tx, VAR, 1, "k2", 60_000))).toThrowError(
      expect.objectContaining({ code: "INSUFFICIENT_STOCK", status: 409 }) as AuthError,
    );
    expect(row().reserved).toBe(5); // failed tx rolled back
  });

  it("two sequential reservations of qty=5 against on_hand=5: exactly one succeeds", () => {
    setStock(VAR, 5);
    const first = db.transaction((tx) => reserveStock(tx, VAR, 5, "ka", 60_000));
    expect(first.status).toBe("ACTIVE");
    expect(() => db.transaction((tx) => reserveStock(tx, VAR, 5, "kb", 60_000))).toThrowError(
      expect.objectContaining({ code: "INSUFFICIENT_STOCK" }) as AuthError,
    );
    expect(row().reserved).toBe(5);
  });

  it("replays the same idempotency key instead of double-reserving", () => {
    setStock(VAR, 5);
    const a = db.transaction((tx) => reserveStock(tx, VAR, 2, "k-idem", 60_000));
    const b = db.transaction((tx) => reserveStock(tx, VAR, 2, "k-idem", 60_000));
    expect(b.id).toBe(a.id);
    expect(row().reserved).toBe(2);
  });

  it("conflicts when the same key replays with different qty or variant", () => {
    db.transaction((tx) => reserveStock(tx, VAR, 2, "k-clash", 60_000));
    expect(() => db.transaction((tx) => reserveStock(tx, VAR, 3, "k-clash", 60_000))).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT", status: 409 }) as AuthError,
    );
    expect(() =>
      db.transaction((tx) => reserveStock(tx, OTHER_VAR, 2, "k-clash", 60_000)),
    ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }) as AuthError);
  });

  it("conflicts when the same key was already resolved", () => {
    const r = db.transaction((tx) => reserveStock(tx, VAR, 1, "k-done", 60_000));
    db.transaction((tx) => consumeReservation(tx, r.id));
    expect(() => db.transaction((tx) => reserveStock(tx, VAR, 1, "k-done", 60_000))).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }) as AuthError,
    );
  });

  it("defaults TTL from application_settings.reservation_ttl_minutes", () => {
    const before = Date.now();
    const r = db.transaction((tx) => reserveStock(tx, VAR, 1, "k-ttl"));
    expect(r.expiresAt).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);
    expect(r.expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
  });
});

describe("consumeReservation", () => {
  it("moves qty from reserved out of onHand and writes a movement", () => {
    setStock(VAR, 10);
    const r = db.transaction((tx) => reserveStock(tx, VAR, 4, "k-consume", 60_000));
    db.transaction((tx) => consumeReservation(tx, r.id));
    expect(row()).toMatchObject({ onHand: 6, reserved: 0 });
    const movs = movements();
    expect(movs.length).toBe(1);
    expect(movs[0]).toMatchObject({ delta: -4, reason: "reservation_consumed" });
    expect(reservationStatus(r.id)).toBe("CONSUMED");
  });

  it("is a no-op on replay and rejects released/expired rows", () => {
    const r = db.transaction((tx) => reserveStock(tx, VAR, 2, "k-c2", 60_000));
    db.transaction((tx) => consumeReservation(tx, r.id));
    db.transaction((tx) => consumeReservation(tx, r.id)); // replay
    expect(row()).toMatchObject({ onHand: 8, reserved: 0 });

    const r2 = db.transaction((tx) => reserveStock(tx, VAR, 1, "k-c3", 60_000));
    db.transaction((tx) => releaseReservation(tx, r2.id, "cancelled"));
    expect(() => db.transaction((tx) => consumeReservation(tx, r2.id))).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT" }) as AuthError,
    );
  });
});

describe("releaseReservation", () => {
  it("frees reserved, keeps onHand, and writes a zero-delta movement", () => {
    setStock(VAR, 10);
    const r = db.transaction((tx) => reserveStock(tx, VAR, 3, "k-rel", 60_000));
    db.transaction((tx) => releaseReservation(tx, r.id, "payment_failed"));
    expect(row()).toMatchObject({ onHand: 10, reserved: 0 });
    const movs = movements();
    expect(movs.length).toBe(1);
    expect(movs[0]).toMatchObject({ delta: 0, reason: "payment_failed" });
    expect(reservationStatus(r.id)).toBe("RELEASED");
  });
});

describe("sweepExpiredReservations", () => {
  it("expires only expired ACTIVE reservations and returns the count", () => {
    const expired = db.transaction((tx) => reserveStock(tx, VAR, 2, "k-exp", -60_000));
    const live = db.transaction((tx) => reserveStock(tx, VAR, 3, "k-live", 60_000));
    const other = db.transaction((tx) => reserveStock(tx, OTHER_VAR, 1, "k-other", -60_000));
    db.transaction((tx) => consumeReservation(tx, other.id)); // CONSUMED + expired — untouched
    const now = Date.now();

    expect(row(VAR)).toMatchObject({ onHand: 10, reserved: 5 });
    expect(sweepExpiredReservations(db, now)).toBe(1);
    expect(row(VAR)).toMatchObject({ onHand: 10, reserved: 3 });

    expect(reservationStatus(expired.id)).toBe("EXPIRED");
    expect(reservationStatus(live.id)).toBe("ACTIVE");
    expect(reservationStatus(other.id)).toBe("CONSUMED");
    expect(sweepExpiredReservations(db, now)).toBe(0); // idempotent
  });
});
