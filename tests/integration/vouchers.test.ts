import { mkdirSync, rmSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthError } from "@/server/api/errors";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { voucherRedemptions, vouchers } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { priceOrder } from "@/server/modules/pricing/price-order";
import { consumeRedemptions, validateVoucher } from "@/server/modules/pricing/vouchers";

const PATH = "./tests/.tmp/vouchers-test.db";
const USER = "usr_customer";
const OTHER = "usr_admin";

let db: DB;

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as AuthError).code;
  }
  throw new Error("expected AuthError");
}

function redemptionCount(voucherId: string, userId = USER) {
  return db
    .select()
    .from(voucherRedemptions)
    .where(and(eq(voucherRedemptions.voucherId, voucherId), eq(voucherRedemptions.userId, userId)))
    .all().length;
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
  // Restore canonical voucher fixtures — tests mutate status/limits/usedCount.
  db.delete(voucherRedemptions).run();
  db.delete(vouchers).run();
  seedCatalog(db);
});

describe("validateVoucher against the real table", () => {
  const ctx = { userId: USER, scopeSubtotalVnd: 500000, now: Date.now() };

  it("returns null for a valid seeded voucher", () => {
    const w10 = db.select().from(vouchers).where(eq(vouchers.code, "WELCOME10")).get()!;
    expect(validateVoucher(db, w10, ctx)).toBeNull();
  });

  it("returns UNKNOWN for a null voucher row", () => {
    expect(validateVoucher(db, null, ctx)).toEqual({ code: "?", reason: "UNKNOWN" });
  });

  it("rejects expired / not-started / disabled rows", () => {
    const w10 = db.select().from(vouchers).where(eq(vouchers.code, "WELCOME10")).get()!;
    expect(validateVoucher(db, w10, { ...ctx, now: w10.endsAt + 1 })).toMatchObject({
      reason: "EXPIRED",
    });
    expect(validateVoucher(db, w10, { ...ctx, now: w10.startsAt - 1 })).toMatchObject({
      reason: "NOT_STARTED",
    });
    db.update(vouchers).set({ status: "DISABLED" }).where(eq(vouchers.id, "vch_1")).run();
    expect(validateVoucher(db, { ...w10, status: "DISABLED" }, ctx)).toMatchObject({
      reason: "DISABLED",
    });
  });
});

describe("priceOrder + consumeRedemptions round trip", () => {
  it("applies seeded vouchers end to end and consumes redemptions", () => {
    const priced = priceOrder(
      db,
      USER,
      [
        { variantId: "var_1", qty: 1 },
        { variantId: "var_7", qty: 2 },
      ],
      ["SHOP2FIX", "WELCOME10"],
      {
        shop_1: { method: "STANDARD", feeVnd: 15000 },
        shop_2: { method: "STANDARD", feeVnd: 30000 },
      },
    );
    expect(priced.rejectedVouchers).toEqual([]);
    expect(priced.appliedVouchers.map((v) => v.code)).toEqual(["SHOP2FIX", "WELCOME10"]);
    expect(priced.platformDiscountVnd).toBe(31405);
    // 94050 + 220000 - 31405 + 45000 shipping
    expect(priced.grandTotalVnd).toBe(327645);

    db.transaction((tx) => consumeRedemptions(tx, USER, priced.appliedVouchers));
    expect(db.select().from(vouchers).where(eq(vouchers.id, "vch_1")).get()!.usedCount).toBe(1);
    expect(db.select().from(vouchers).where(eq(vouchers.id, "vch_2")).get()!.usedCount).toBe(1);
    expect(redemptionCount("vch_1")).toBe(1);
  });

  it("rejects WELCOME10 after the same user's per-user limit is consumed", () => {
    const priced = priceOrder(db, USER, [{ variantId: "var_7", qty: 1 }], ["WELCOME10"]);
    db.transaction((tx) => consumeRedemptions(tx, USER, priced.appliedVouchers));

    const again = priceOrder(db, USER, [{ variantId: "var_7", qty: 1 }], ["WELCOME10"]);
    expect(again.rejectedVouchers).toEqual([{ code: "WELCOME10", reason: "USER_LIMIT" }]);
    // a different user is unaffected
    const other = priceOrder(db, OTHER, [{ variantId: "var_7", qty: 1 }], ["WELCOME10"]);
    expect(other.rejectedVouchers).toEqual([]);
  });

  it("rolls back the consume when the total limit is already hit", () => {
    db.update(vouchers).set({ totalLimit: 1, usedCount: 1 }).where(eq(vouchers.id, "vch_2")).run();
    const before = db.select().from(voucherRedemptions).all().length;
    const code = errorCode(() =>
      db.transaction((tx) =>
        consumeRedemptions(tx, USER, [
          { voucherId: "vch_2", code: "SHOP2FIX", discountVnd: 20000 },
        ]),
      ),
    );
    expect(code).toBe("VOUCHER_INVALID");
    expect(db.select().from(voucherRedemptions).all()).toHaveLength(before);
    expect(db.select().from(vouchers).where(eq(vouchers.id, "vch_2")).get()!.usedCount).toBe(1);
  });

  it("enforces per-user limit inside the transaction even if pricing raced", () => {
    db.insert(voucherRedemptions)
      .values({ id: "red_x", voucherId: "vch_1", userId: USER, createdAt: Date.now() })
      .run();
    const code = errorCode(() =>
      db.transaction((tx) =>
        consumeRedemptions(tx, USER, [
          { voucherId: "vch_1", code: "WELCOME10", discountVnd: 1000 },
        ]),
      ),
    );
    expect(code).toBe("VOUCHER_INVALID");
    expect(db.select().from(vouchers).where(eq(vouchers.id, "vch_1")).get()!.usedCount).toBe(0);
  });

  it("writes one redemption per voucher and honors the unique voucher+order key", () => {
    db.transaction((tx) =>
      consumeRedemptions(
        tx,
        USER,
        [
          { voucherId: "vch_1", code: "WELCOME10", discountVnd: 1000 },
          { voucherId: "vch_2", code: "SHOP2FIX", discountVnd: 20000 },
        ],
        null,
      ),
    );
    expect(db.select().from(voucherRedemptions).all()).toHaveLength(2);
  });
});
