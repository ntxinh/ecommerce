import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { applicationSettings, auditLogs, vouchers } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import {
  createPlatformVoucher,
  getAdminOrder,
  getSettings,
  listAdminOrders,
  setSetting,
} from "@/server/modules/admin/ops";
import { priceOrder } from "@/server/modules/pricing/price-order";
import { quoteShippingFee } from "@/server/modules/shipping/providers";

const PATH = "./tests/.tmp/admin-ops-test.db";
let db: DB;

const ADMIN: Actor = { userId: "usr_admin", roles: ["ADMIN"], memberships: [] };
const CUSTOMER: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as AuthError).code;
  }
  throw new Error("expected AuthError");
}

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
});

describe("admin orders", () => {
  it("lists all orders id-desc with buyer email; q matches order id or buyer email", () => {
    const all = listAdminOrders(db, ADMIN, {});
    expect(all.items.length).toBe(3); // ord_1..ord_3 seeded COMPLETED
    expect(all.items[0].id > all.items[1].id).toBe(true);
    expect(all.items[0].buyerEmail).toBe("customer@marketflow.dev");
    expect(all.nextCursor).toBeNull();

    const byEmail = listAdminOrders(db, ADMIN, { q: "customer@marketflow" });
    expect(byEmail.items.length).toBe(3);
    expect(listAdminOrders(db, ADMIN, { q: "ord_2" }).items.map((o) => o.id)).toEqual(["ord_2"]);
    expect(listAdminOrders(db, ADMIN, { q: "nobody@" }).items).toEqual([]);
  });

  it("filters by status and honours limit/cursor", () => {
    expect(listAdminOrders(db, ADMIN, { status: "COMPLETED" }).items.length).toBe(3);
    expect(listAdminOrders(db, ADMIN, { status: "PENDING_PAYMENT" }).items).toEqual([]);

    const first = listAdminOrders(db, ADMIN, { limit: 2 });
    expect(first.items.length).toBe(2);
    expect(first.nextCursor).not.toBeNull();
    const rest = listAdminOrders(db, ADMIN, { limit: 2, cursor: first.nextCursor! });
    expect(rest.items.length).toBe(1);
    expect(rest.items[0].id).toBe("ord_1");
  });

  it("detail reuses getOrder: full graph for admin, FORBIDDEN for customer", () => {
    const detail = getAdminOrder(db, ADMIN, "ord_2");
    expect(detail.order.id).toBe("ord_2");
    expect(detail.sellerOrders.length).toBe(2); // so_2 + so_3
    expect(detail.items.length).toBeGreaterThan(0);

    expect(errorCode(() => getAdminOrder(db, CUSTOMER, "ord_2"))).toBe("FORBIDDEN");
    expect(errorCode(() => getAdminOrder(db, null, "ord_2"))).toBe("UNAUTHORIZED");
    expect(errorCode(() => getAdminOrder(db, ADMIN, "ord_missing"))).toBe("NOT_FOUND");
    expect(errorCode(() => listAdminOrders(db, CUSTOMER, {}))).toBe("FORBIDDEN");
  });
});

describe("admin settings", () => {
  it("getSettings returns every row JSON-parsed", () => {
    const s = getSettings(db, ADMIN);
    expect(s.commission_rate_bps).toBe(500);
    expect(s.shipping_fees).toEqual({ standard: 15000, express: 30000 });
    expect(s.currency).toBe("VND");
    expect(errorCode(() => getSettings(db, CUSTOMER))).toBe("FORBIDDEN");
  });

  it("setSetting upserts a whitelisted key and quoteShippingFee picks it up", () => {
    expect(quoteShippingFee(db, "standard")).toBe(15000);
    setSetting(db, ADMIN, "shipping_fees", { standard: 21000, express: 45000 });
    expect(quoteShippingFee(db, "standard")).toBe(21000);
    expect(quoteShippingFee(db, "express")).toBe(45000);
    expect(
      db
        .select()
        .from(applicationSettings)
        .where(eq(applicationSettings.key, "shipping_fees"))
        .get()!.value,
    ).toBe('{"standard":21000,"express":45000}');

    const audit = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "settings.update"))
      .all()
      .find((r) => r.targetId === "shipping_fees");
    expect(audit?.actorId).toBe(ADMIN.userId);
    expect(JSON.parse(audit!.metaJson)).toEqual({ key: "shipping_fees" });
  });

  it("rejects non-whitelisted keys, non-admin callers", () => {
    expect(errorCode(() => setSetting(db, ADMIN, "admin_password", "x"))).toBe("INVALID_INPUT");
    expect(errorCode(() => setSetting(db, CUSTOMER, "commission_rate_bps", 900))).toBe("FORBIDDEN");
    expect(errorCode(() => setSetting(db, null, "commission_rate_bps", 900))).toBe("UNAUTHORIZED");
  });

  it("validates value shape per key before upserting", () => {
    expect(errorCode(() => setSetting(db, ADMIN, "commission_rate_bps", -5))).toBe("INVALID_INPUT");
    expect(errorCode(() => setSetting(db, ADMIN, "commission_rate_bps", 10_001))).toBe(
      "INVALID_INPUT",
    );
    expect(errorCode(() => setSetting(db, ADMIN, "return_window_days", 0))).toBe("INVALID_INPUT");
    expect(errorCode(() => setSetting(db, ADMIN, "reservation_ttl_minutes", 2.5))).toBe(
      "INVALID_INPUT",
    );
    expect(errorCode(() => setSetting(db, ADMIN, "shipping_fees", {}))).toBe("INVALID_INPUT");
    expect(errorCode(() => setSetting(db, ADMIN, "shipping_fees", { standard: -1 }))).toBe(
      "INVALID_INPUT",
    );
    // untouched by the rejected writes
    expect(quoteShippingFee(db, "standard")).toBe(21000);
    // valid roundtrip still works
    setSetting(db, ADMIN, "commission_rate_bps", 700);
    expect(getSettings(db, ADMIN).commission_rate_bps).toBe(700);
  });
});

describe("admin platform vouchers", () => {
  const input = {
    code: "admintest",
    kind: "FIXED" as const,
    value: 10000,
    startsAt: Date.now() - 1000,
    endsAt: Date.now() + 86_400_000,
  };

  it("creates a PLATFORM voucher that priceOrder applies", () => {
    const id = createPlatformVoucher(db, ADMIN, input);
    const row = db.select().from(vouchers).where(eq(vouchers.id, id)).get()!;
    expect(row.code).toBe("ADMINTEST"); // normalized upper-case
    expect(row.scope).toBe("PLATFORM");
    expect(row.status).toBe("ACTIVE");
    expect(row.usedCount).toBe(0);

    const priced = priceOrder(db, "usr_customer", [{ variantId: "var_7", qty: 1 }], ["admintest"]);
    expect(priced.rejectedVouchers).toEqual([]);
    expect(priced.appliedVouchers.map((v) => v.code)).toEqual(["ADMINTEST"]);
    expect(priced.platformDiscountVnd).toBe(10000);
  });
  it("rejects duplicates, bad input, and non-admin callers", () => {
    expect(errorCode(() => createPlatformVoucher(db, ADMIN, input))).toBe("INVALID_INPUT");
    expect(
      errorCode(() =>
        createPlatformVoucher(db, ADMIN, { ...input, code: "X2", endsAt: input.startsAt }),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      errorCode(() => createPlatformVoucher(db, ADMIN, { ...input, code: "X3", value: 0 })),
    ).toBe("INVALID_INPUT");
    expect(errorCode(() => createPlatformVoucher(db, CUSTOMER, { ...input, code: "X4" }))).toBe(
      "FORBIDDEN",
    );
  });
});
