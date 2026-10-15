import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { createSession, resolveSession } from "@/server/auth/sessions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { auditLogs, inventory, orders, sessions, users } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import {
  adminDashboard,
  getUserDetail,
  listAuditLogs,
  listUsers,
  revokeUserSessions,
  setUserStatus,
} from "@/server/modules/admin/service";
import { addItem, clearCart } from "@/server/modules/cart/service";
import { authenticate } from "@/server/modules/identity/service";
import { placeOrder } from "@/server/modules/orders/checkout";

const PATH = "./tests/.tmp/admin-test.db";
let db: DB;

const ADMIN: Actor = { userId: "usr_admin", roles: ["ADMIN"], memberships: [] };
const CUSTOMER: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };

let keySeq = 0;
const nextKey = () => `adm_${++keySeq}`;

async function errorCode(fn: () => Promise<unknown> | unknown): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as AuthError).code;
  }
  throw new Error("expected AuthError");
}

/** COD order for seeded variants; returns the order row. */
async function placeOrderFor(items: { variantId: string; qty: number }[]) {
  clearCart(db, CUSTOMER.userId);
  const cartItemIds = items.map(
    (i) => addItem(db, CUSTOMER.userId, i.variantId, i.qty).items.at(-1)!.cartItemId,
  );
  const res = await placeOrder(db, CUSTOMER, {
    cartItemIds,
    addressId: "addr_1",
    shippingByShop: {},
    voucherCodes: [],
    paymentMethod: "COD",
    idempotencyKey: nextKey(),
  });
  return db.select().from(orders).where(eq(orders.id, res.orderId)).get()!;
}

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
});

describe("admin dashboard", () => {
  const SEED_GMV = 150000 + 420000 + 314000; // 3 COMPLETED orders in seedCatalog
  let gmvPlaced = 0;
  const placed: string[] = [];

  it("aggregates counts, GMV, and queues against the seeds", async () => {
    for (let i = 0; i < 3; i++) {
      const order = await placeOrderFor([{ variantId: "var_3", qty: 1 }]);
      placed.push(order.id);
      gmvPlaced += order.totalVnd;
    }
    const d = adminDashboard(db, ADMIN);
    expect(d.ordersToday).toBe(3); // seeded orders are dated 2025-01-01
    expect(d.gmvVnd).toBe(SEED_GMV + gmvPlaced);
    expect(d.customerCount).toBe(4); // admin+seller+seller2+customer all hold CUSTOMER
    expect(d.sellerCount).toBe(2); // usr_seller + usr_seller2
    expect(d.pendingApplications).toBe(1); // seeded app_1 PENDING
    expect(d.moderationQueue).toBe(0);
    expect(d.pendingReturns).toBe(0);
    expect(d.lowStock).toBe(0); // seeds hold ≥20 on hand, none reserved
  });

  it("excludes cancelled orders from GMV and counts low stock", async () => {
    db.update(orders).set({ status: "CANCELLED" }).where(eq(orders.id, placed[0])).run();
    const cancelled = db.select().from(orders).where(eq(orders.id, placed[0])).get()!;
    db.update(inventory).set({ onHand: 3 }).where(eq(inventory.variantId, "var_8")).run();

    const d = adminDashboard(db, ADMIN);
    expect(d.gmvVnd).toBe(SEED_GMV + gmvPlaced - cancelled.totalVnd);
    expect(d.ordersToday).toBe(3); // still created today; status doesn't matter
    expect(d.lowStock).toBe(1);
  });

  it("requires admin", async () => {
    expect(await errorCode(() => adminDashboard(db, CUSTOMER))).toBe("FORBIDDEN");
    expect(await errorCode(() => adminDashboard(db, null))).toBe("UNAUTHORIZED");
  });
});

describe("admin users", () => {
  it("lists users id-desc with roles; q matches email/name; status filters", async () => {
    const all = listUsers(db, ADMIN, {});
    expect(all.items.length).toBe(4);
    expect(all.nextCursor).toBeNull();
    expect(all.items.map((u) => u.id)).toEqual(
      [...all.items.map((u) => u.id)].sort().reverse(), // id-desc
    );
    const seller = all.items.find((u) => u.id === "usr_seller")!;
    expect(seller.roles.sort()).toEqual(["CUSTOMER", "SELLER"]);

    const q = listUsers(db, ADMIN, { q: "seller2@" });
    expect(q.items.map((u) => u.id)).toEqual(["usr_seller2"]);
    expect(listUsers(db, ADMIN, { q: "Seller One" }).items.map((u) => u.id)).toEqual([
      "usr_seller",
    ]);
    expect(listUsers(db, ADMIN, { q: "nobody" }).items).toHaveLength(0);
    expect(listUsers(db, ADMIN, { status: "SUSPENDED" }).items).toHaveLength(0);
    expect(listUsers(db, ADMIN, { status: "ACTIVE" }).items).toHaveLength(4);

    const p1 = listUsers(db, ADMIN, { limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBe(p1.items[1].id);
    const p2 = listUsers(db, ADMIN, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(2);
    expect(p2.nextCursor).toBeNull();
    expect([...p1.items, ...p2.items].map((u) => u.id)).toEqual(all.items.map((u) => u.id));
  });

  it("getUserDetail returns roles, memberships, and audit touching the user", async () => {
    const detail = getUserDetail(db, ADMIN, "usr_seller");
    expect(detail.user.email).toBe("seller@marketflow.dev");
    expect(detail.roles.sort()).toEqual(["CUSTOMER", "SELLER"]);
    expect(detail.memberships).toEqual([
      { shopId: "shop_1", shopName: "Saigon Crafts", role: "OWNER" },
    ]);
    expect(getUserDetail(db, ADMIN, "usr_customer").memberships).toHaveLength(0);
    expect(await errorCode(() => getUserDetail(db, ADMIN, "usr_nope"))).toBe("NOT_FOUND");
  });

  it("suspend revokes sessions, blocks auth, audits; reactivate restores auth", async () => {
    const { token } = await createSession(db, "usr_customer");
    expect(await resolveSession(db, token)).not.toBeNull();

    setUserStatus(db, ADMIN, "usr_customer", "SUSPENDED");
    expect(db.select().from(users).where(eq(users.id, "usr_customer")).get()!.status).toBe(
      "SUSPENDED",
    );
    expect(
      db.select().from(sessions).where(eq(sessions.userId, "usr_customer")).all(),
    ).toHaveLength(0);
    expect(await resolveSession(db, token)).toBeNull(); // row gone anyway
    // authenticate already rejects non-ACTIVE users — asserting, not changing.
    expect(
      await authenticate(db, { email: "customer@marketflow.dev", password: "Marketflow123!" }),
    ).toBeNull();

    const row = listAuditLogs(db, ADMIN, { targetType: "user", targetId: "usr_customer" }).items[0];
    expect(row).toMatchObject({ action: "user.status", actorId: "usr_admin" });
    expect(JSON.parse(row.metaJson)).toEqual({ from: "ACTIVE", to: "SUSPENDED" });

    setUserStatus(db, ADMIN, "usr_customer", "ACTIVE");
    expect(
      await authenticate(db, { email: "customer@marketflow.dev", password: "Marketflow123!" }),
    ).not.toBeNull();

    // A live session is killed by the next resolve even without revocation.
    const { token: t2 } = await createSession(db, "usr_customer");
    setUserStatus(db, ADMIN, "usr_customer", "SUSPENDED");
    expect(await resolveSession(db, t2)).toBeNull();
    expect(await errorCode(() => setUserStatus(db, ADMIN, "usr_admin", "SUSPENDED"))).toBe(
      "INVALID_INPUT", // self-suspension guard
    );
    setUserStatus(db, ADMIN, "usr_customer", "ACTIVE");
  });

  it("revokeUserSessions drops sessions without changing status", async () => {
    const { token } = await createSession(db, "usr_seller2");
    revokeUserSessions(db, ADMIN, "usr_seller2");
    expect(await resolveSession(db, token)).toBeNull();
    expect(db.select().from(users).where(eq(users.id, "usr_seller2")).get()!.status).toBe("ACTIVE");
    const row = listAuditLogs(db, ADMIN, { targetType: "user", targetId: "usr_seller2" }).items[0];
    expect(row.action).toBe("user.sessions_revoked");
  });

  it("requires admin and existing users", async () => {
    expect(await errorCode(() => setUserStatus(db, CUSTOMER, "usr_seller", "SUSPENDED"))).toBe(
      "FORBIDDEN",
    );
    expect(await errorCode(() => setUserStatus(db, null, "usr_seller", "SUSPENDED"))).toBe(
      "UNAUTHORIZED",
    );
    expect(await errorCode(() => setUserStatus(db, ADMIN, "usr_nope", "SUSPENDED"))).toBe(
      "NOT_FOUND",
    );
    expect(await errorCode(() => revokeUserSessions(db, ADMIN, "usr_nope"))).toBe("NOT_FOUND");
    expect(await errorCode(() => listUsers(db, CUSTOMER, {}))).toBe("FORBIDDEN");
  });
});

describe("admin audit log", () => {
  it("lists newest-first with target filter and cursor pagination", async () => {
    const all = listAuditLogs(db, ADMIN, {});
    expect(all.items.length).toBeGreaterThan(0);
    const ids = all.items.map((r) => r.id);
    expect(ids).toEqual([...ids].sort().reverse()); // ULID id-desc = newest first

    // Transition rows from checkout ("order.created") and suspend above.
    const orderRows = listAuditLogs(db, ADMIN, { targetType: "order" });
    expect(orderRows.items.every((r) => r.targetType === "order")).toBe(true);
    expect(orderRows.items.length).toBeGreaterThanOrEqual(3);

    const userRows = listAuditLogs(db, ADMIN, {
      targetType: "user",
      targetId: "usr_customer",
    });
    expect(userRows.items.length).toBeGreaterThanOrEqual(3); // 2 suspends + 1 reactivate
    expect(userRows.items.every((r) => r.targetId === "usr_customer")).toBe(true);

    const p1 = listAuditLogs(db, ADMIN, { limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBe(p1.items[1].id);
    const p2 = listAuditLogs(db, ADMIN, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items.map((r) => r.id).every((id) => !p1.items.some((p) => p.id === id))).toBe(true);
    expect(p2.items[0].id < p1.items[1].id).toBe(true);
  });

  it("requires admin", async () => {
    expect(await errorCode(() => listAuditLogs(db, CUSTOMER, {}))).toBe("FORBIDDEN");
  });
});
