import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { auditLogs, orders, sellerOrders } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import {
  canTransitionOrder,
  canTransitionSellerOrder,
  ORDER_TRANSITIONS,
  type OrderStatus,
  SELLER_ORDER_TRANSITIONS,
  type SellerOrderStatus,
  transitionOrder,
  transitionSellerOrder,
} from "@/server/modules/orders/transitions";

const PATH = "./tests/.tmp/transitions-unit.db";
const OWNER: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };
const ADMIN: Actor = { userId: "usr_admin", roles: ["ADMIN"], memberships: [] };
const STRANGER: Actor = { userId: "usr_seller2", roles: ["CUSTOMER"], memberships: [] };
const SHOP1_OWNER: Actor = {
  userId: "usr_seller",
  roles: ["SELLER"],
  memberships: [{ shopId: "shop_1", role: "OWNER", permissions: [] }],
};

let db: DB;
let seq = 0;

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as AuthError).code;
  }
  throw new Error("expected AuthError");
}

function insertOrder(status: OrderStatus): string {
  seq += 1;
  const id = `ord_u${seq}`;
  const now = Date.now();
  db.insert(orders)
    .values({
      id,
      userId: "usr_customer",
      addressSnapshotJson: "{}",
      status,
      totalVnd: 0,
      subtotalVnd: 0,
      idempotencyKey: `uk_${seq}`,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

function insertSellerOrder(orderId: string, status: SellerOrderStatus): string {
  seq += 1;
  const id = `so_u${seq}`;
  const now = Date.now();
  db.insert(sellerOrders)
    .values({
      id,
      orderId,
      shopId: "shop_1",
      status,
      subtotalVnd: 0,
      commissionRateBps: 500,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
});

describe("transition tables", () => {
  const ORDER_STATES = Object.keys(ORDER_TRANSITIONS) as OrderStatus[];
  const SELLER_STATES = Object.keys(SELLER_ORDER_TRANSITIONS) as SellerOrderStatus[];

  it("accepts exactly the legal order transitions", () => {
    for (const from of ORDER_STATES) {
      for (const to of ORDER_STATES) {
        expect(canTransitionOrder(from, to), `${from} → ${to}`).toBe(
          ORDER_TRANSITIONS[from].includes(to),
        );
      }
    }
    // Spot-check the spec'd edges.
    expect(canTransitionOrder("PENDING_PAYMENT", "PAID")).toBe(true);
    expect(canTransitionOrder("PAYMENT_FAILED", "PENDING_PAYMENT")).toBe(true);
    expect(canTransitionOrder("DELIVERED", "REFUNDED")).toBe(true);
    expect(canTransitionOrder("SHIPPED", "CANCELLED")).toBe(false);
    expect(canTransitionOrder("COMPLETED", "REFUNDED")).toBe(false);
  });

  it("accepts exactly the legal seller-order transitions", () => {
    for (const from of SELLER_STATES) {
      for (const to of SELLER_STATES) {
        expect(canTransitionSellerOrder(from, to), `${from} → ${to}`).toBe(
          SELLER_ORDER_TRANSITIONS[from].includes(to),
        );
      }
    }
    expect(canTransitionSellerOrder("NEW", "CONFIRMED")).toBe(true);
    expect(canTransitionSellerOrder("NEW", "SHIPPED")).toBe(false);
    expect(canTransitionSellerOrder("RETURN_REQUESTED", "RETURNED")).toBe(true);
    expect(canTransitionSellerOrder("CANCELLED", "NEW")).toBe(false);
  });
});

describe("transitionOrder against a real DB", () => {
  it("applies a legal transition, bumps updatedAt, writes audit_logs", () => {
    const id = insertOrder("PENDING_PAYMENT");
    const updated = transitionOrder(db, id, "PAID", OWNER);
    expect(updated.status).toBe("PAID");
    const audit = db.select().from(auditLogs).where(eq(auditLogs.targetId, id)).all();
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("order.transition");
    expect(JSON.parse(audit[0].metaJson)).toEqual({ from: "PENDING_PAYMENT", to: "PAID" });
  });

  it("throws INVALID_INPUT on an illegal transition and writes nothing", () => {
    const id = insertOrder("PENDING_PAYMENT");
    const err = errorCode(() => transitionOrder(db, id, "SHIPPED", OWNER));
    expect(err).toBe("INVALID_INPUT");
    expect(db.select().from(orders).where(eq(orders.id, id)).get()?.status).toBe("PENDING_PAYMENT");
    expect(db.select().from(auditLogs).where(eq(auditLogs.targetId, id)).all()).toHaveLength(0);
  });

  it("enforces ownership: non-owner non-admin gets FORBIDDEN, ADMIN passes", () => {
    const id = insertOrder("PENDING_PAYMENT");
    expect(errorCode(() => transitionOrder(db, id, "CANCELLED", STRANGER))).toBe("FORBIDDEN");
    expect(transitionOrder(db, id, "CANCELLED", ADMIN).status).toBe("CANCELLED");
  });

  it("is a no-op when already in the target state", () => {
    const id = insertOrder("PAID");
    expect(transitionOrder(db, id, "PAID", OWNER).status).toBe("PAID");
    expect(db.select().from(auditLogs).where(eq(auditLogs.targetId, id)).all()).toHaveLength(0);
  });

  it("throws NOT_FOUND for a missing order", () => {
    expect(errorCode(() => transitionOrder(db, "ord_none", "PAID", ADMIN))).toBe("NOT_FOUND");
  });
});

describe("transitionSellerOrder against a real DB", () => {
  it("applies NEW → CONFIRMED for the shop owner and audits", () => {
    const orderId = insertOrder("PROCESSING");
    const soId = insertSellerOrder(orderId, "NEW");
    expect(transitionSellerOrder(db, soId, "CONFIRMED", SHOP1_OWNER).status).toBe("CONFIRMED");
    const audit = db.select().from(auditLogs).where(eq(auditLogs.targetId, soId)).all();
    expect(audit[0].metaJson).toBe(JSON.stringify({ from: "NEW", to: "CONFIRMED" }));
  });

  it("rejects illegal jumps and unauthorized actors", () => {
    const orderId = insertOrder("PROCESSING");
    const soId = insertSellerOrder(orderId, "NEW");
    expect(errorCode(() => transitionSellerOrder(db, soId, "SHIPPED", SHOP1_OWNER))).toBe(
      "INVALID_INPUT",
    );
    expect(errorCode(() => transitionSellerOrder(db, soId, "CONFIRMED", STRANGER))).toBe(
      "FORBIDDEN",
    );
  });
});
