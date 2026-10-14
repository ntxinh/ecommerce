import { mkdirSync, rmSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulidx";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import {
  auditLogs,
  cartItems,
  inventory,
  orderItems,
  orderPricingBreakdowns,
  orders,
  paymentAttempts,
  payments,
  sellerOrders,
  stockReservations,
  voucherRedemptions,
  vouchers,
} from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { SEEDED_AT, seedIdentity } from "@/server/db/seed/identity";
import { addItem, updateQty } from "@/server/modules/cart/service";
import { releaseReservation } from "@/server/modules/inventory/service";
import { placeOrder } from "@/server/modules/orders/checkout";
import { cancelOrder, getOrder, listOrders, retryPayment } from "@/server/modules/orders/service";
import { transitionSellerOrder } from "@/server/modules/orders/transitions";
import { priceOrder } from "@/server/modules/pricing/price-order";

const PATH = "./tests/.tmp/checkout-test.db";
const CUSTOMER: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };
const OTHER: Actor = { userId: "usr_seller2", roles: ["CUSTOMER", "SELLER"], memberships: [] };
const ADMIN: Actor = { userId: "usr_admin", roles: ["ADMIN"], memberships: [] };
// var_6 lives in shop_2 — usr_seller2 owns it (SHOP1_OWNER belongs to shop_1).
const SHOP2_OWNER: Actor = {
  userId: "usr_seller2",
  roles: ["SELLER"],
  memberships: [{ shopId: "shop_2", role: "OWNER", permissions: [] }],
};
const ADDRESS = "addr_1"; // seeded default for usr_customer

let db: DB;
let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `chk_${keySeq}`;
}

async function errorCode(fn: () => Promise<unknown> | unknown): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as AuthError).code;
  }
  throw new Error("expected AuthError");
}

/** Adds qty of a variant to the customer's cart and returns the cartItemId. */
function cartItemId(variantId: string, qty: number): string {
  const view = addItem(db, CUSTOMER.userId, variantId, qty);
  return view.items.find((i) => i.variantId === variantId)!.cartItemId;
}

function orderCount(): number {
  return db.select().from(orders).all().length;
}

function stock(variantId: string) {
  return db.select().from(inventory).where(eq(inventory.variantId, variantId)).get()!;
}

function reservationsFor(orderKey: string) {
  return db
    .select()
    .from(stockReservations)
    .all()
    .filter((r) => r.idempotencyKey.startsWith(`${orderKey}:`));
}

const baseInput = (cartItemIds: string[], extra: Record<string, unknown> = {}) => ({
  cartItemIds,
  addressId: ADDRESS,
  shippingByShop: {} as Record<string, string>,
  voucherCodes: [] as string[],
  paymentMethod: "COD" as const,
  idempotencyKey: nextKey(),
  ...extra,
});

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
});

describe("placeOrder", () => {
  it("(a) multi-shop COD checkout: one order, two seller orders, snapshots + breakdown", async () => {
    const items = [
      { variantId: "var_1", qty: 1 }, // shop_1, flash 99000
      { variantId: "var_6", qty: 2 }, // shop_2, 90000 each
    ];
    const ids = items.map((i) => cartItemId(i.variantId, i.qty));
    const onHandBefore = stock("var_1").onHand;

    const res = await placeOrder(db, CUSTOMER, baseInput(ids));

    expect(res.status).toBe("PROCESSING");
    expect(res.sellerOrderIds).toHaveLength(2);

    const order = db.select().from(orders).where(eq(orders.id, res.orderId)).get()!;
    const priced = priceOrder(db, CUSTOMER.userId, items, [], {
      shop_1: { method: "standard", feeVnd: 15000 },
      shop_2: { method: "standard", feeVnd: 15000 },
    });
    expect(order.totalVnd).toBe(priced.grandTotalVnd);
    expect(order.shippingVnd).toBe(30000);
    expect(JSON.parse(order.addressSnapshotJson)).toMatchObject({ id: ADDRESS });

    const sos = db.select().from(sellerOrders).where(eq(sellerOrders.orderId, res.orderId)).all();
    expect(sos.map((s) => s.shopId).sort()).toEqual(["shop_1", "shop_2"]);
    for (const so of sos) {
      expect(so.status).toBe("NEW");
      expect(so.commissionRateBps).toBe(500); // snapshot from settings
    }

    const ois = db.select().from(orderItems).where(eq(orderItems.orderId, res.orderId)).all();
    expect(ois).toHaveLength(2);
    const mug = ois.find((i) => i.variantId === "var_1")!;
    expect(mug.skuSnapshot).toBe("MUG-BLU");
    expect(mug.nameSnapshot).toContain("Mug");
    expect(mug.qty).toBe(1);

    const bks = db
      .select()
      .from(orderPricingBreakdowns)
      .where(eq(orderPricingBreakdowns.orderId, res.orderId))
      .all();
    expect(bks.filter((b) => b.lineType === "SHIPPING_FEE")).toHaveLength(2);

    // COD: payment stays PENDING, reservation already CONSUMED, stock moved.
    const pay = db.select().from(payments).where(eq(payments.orderId, res.orderId)).get()!;
    expect(pay.method).toBe("COD");
    expect(pay.status).toBe("PENDING");
    expect(pay.amountVnd).toBe(order.totalVnd);
    const resv = reservationsFor(order.idempotencyKey);
    expect(resv).toHaveLength(2);
    expect(resv.every((r) => r.status === "CONSUMED")).toBe(true);
    expect(stock("var_1").onHand).toBe(onHandBefore - 1);
    expect(stock("var_1").reserved).toBe(0);
  });

  it("(b) INSUFFICIENT_STOCK rolls back the whole checkout", async () => {
    const id = cartItemId("var_2", 999); // on_hand 25
    const before = orderCount();
    const reservedBefore = stock("var_2").reserved;

    const code = await errorCode(() => placeOrder(db, CUSTOMER, baseInput([id])));
    expect(code).toBe("INSUFFICIENT_STOCK");
    expect(orderCount()).toBe(before);
    expect(stock("var_2").reserved).toBe(reservedBefore);
  });

  it("(c) idempotent replay returns the same order without duplicating rows", async () => {
    const id = cartItemId("var_7", 1);
    const input = baseInput([id]);
    const first = await placeOrder(db, CUSTOMER, input);
    const before = orderCount();
    const second = await placeOrder(db, CUSTOMER, input);
    expect(second.orderId).toBe(first.orderId);
    expect(second.sellerOrderIds).toEqual(first.sellerOrderIds);
    expect(orderCount()).toBe(before);
  });

  it("(c2) same key with a different payload → IDEMPOTENCY_CONFLICT", async () => {
    const id = cartItemId("var_7", 1);
    const key = nextKey();
    await placeOrder(db, CUSTOMER, baseInput([id], { idempotencyKey: key }));
    const other = cartItemId("var_8", 1);
    const code = await errorCode(() =>
      placeOrder(db, CUSTOMER, baseInput([other], { idempotencyKey: key })),
    );
    expect(code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("(d) total-limit voucher: second sequential checkout completes without it", async () => {
    db.insert(vouchers)
      .values({
        id: `vch_${ulid()}`,
        code: "ONCE",
        scope: "PLATFORM",
        kind: "FIXED",
        value: 5000,
        totalLimit: 1,
        startsAt: SEEDED_AT,
        endsAt: SEEDED_AT + 5 * 365 * 24 * 60 * 60 * 1000,
        status: "ACTIVE",
      })
      .run();

    // var_8 has accumulated qty across earlier tests — clear the line first.
    const prior = db.select().from(cartItems).where(eq(cartItems.variantId, "var_8")).all();
    for (const p of prior) db.delete(cartItems).where(eq(cartItems.id, p.id)).run();
    const firstItem = cartItemId("var_8", 1);
    const one = await placeOrder(db, CUSTOMER, baseInput([firstItem], { voucherCodes: ["ONCE"] }));
    // addItem is an upsert — reset to qty 1 so both checkouts price the same basket.
    updateQty(db, CUSTOMER.userId, firstItem, 1);
    const two = await placeOrder(db, CUSTOMER, baseInput([firstItem], { voucherCodes: ["ONCE"] }));
    expect(two.status).toBe("PROCESSING");

    const voucherId = db.select().from(vouchers).where(eq(vouchers.code, "ONCE")).get()!.id;
    expect(
      db.select().from(voucherRedemptions).where(eq(voucherRedemptions.voucherId, voucherId)).all(),
    ).toHaveLength(1);
    const twoBreakdowns = db
      .select()
      .from(orderPricingBreakdowns)
      .where(
        and(
          eq(orderPricingBreakdowns.orderId, two.orderId),
          eq(orderPricingBreakdowns.lineType, "PLATFORM_VOUCHER"),
        ),
      )
      .all();
    expect(twoBreakdowns).toHaveLength(0);
    const oneOrder = db.select().from(orders).where(eq(orders.id, one.orderId)).get()!;
    const twoOrder = db.select().from(orders).where(eq(orders.id, two.orderId)).get()!;
    expect(twoOrder.totalVnd - oneOrder.totalVnd).toBe(5000); // no voucher discount
  });

  it("(e) cancel frees reservations: released for wallet, on_hand restored for COD", async () => {
    // Online-payment order that failed → reservations still ACTIVE.
    const walletItem = cartItemId("var_3", 1);
    const w = await placeOrder(
      db,
      CUSTOMER,
      baseInput([walletItem], { paymentMethod: "MOCK_WALLET", simulate: "failure" }),
    );
    expect(w.status).toBe("PAYMENT_FAILED");
    const wKey = db.select().from(orders).where(eq(orders.id, w.orderId)).get()!.idempotencyKey;
    expect(reservationsFor(wKey).every((r) => r.status === "ACTIVE")).toBe(true);

    const canc = await cancelOrder(db, CUSTOMER, w.orderId);
    expect(canc.status).toBe("CANCELLED");
    expect(reservationsFor(wKey).every((r) => r.status === "RELEASED")).toBe(true);
    expect(stock("var_3").reserved).toBe(0);
    expect(db.select().from(orders).where(eq(orders.id, w.orderId)).get()!.status).toBe(
      "CANCELLED",
    );

    // COD order: consumed reservation restores on_hand on cancel.
    const codItem = cartItemId("var_4", 2);
    const onHandBefore = stock("var_4").onHand;
    const c = await placeOrder(db, CUSTOMER, baseInput([codItem]));
    expect(stock("var_4").onHand).toBe(onHandBefore - 2);
    await cancelOrder(db, CUSTOMER, c.orderId);
    expect(stock("var_4").onHand).toBe(onHandBefore);
    const cKey = db.select().from(orders).where(eq(orders.id, c.orderId)).get()!.idempotencyKey;
    expect(reservationsFor(cKey).every((r) => r.status === "RELEASED")).toBe(true);
    const codSos = db.select().from(sellerOrders).where(eq(sellerOrders.orderId, c.orderId)).all();
    expect(codSos.every((s) => s.status === "CANCELLED")).toBe(true);
  });

  it("(f) wallet failure → PAYMENT_FAILED → retryPayment succeeds", async () => {
    const id = cartItemId("var_5", 1);
    const res = await placeOrder(
      db,
      CUSTOMER,
      baseInput([id], { paymentMethod: "MOCK_WALLET", simulate: "failure" }),
    );
    expect(res.status).toBe("PAYMENT_FAILED");
    // Reservations stay ACTIVE awaiting retry.
    const key = db.select().from(orders).where(eq(orders.id, res.orderId)).get()!.idempotencyKey;
    expect(reservationsFor(key).every((r) => r.status === "ACTIVE")).toBe(true);

    const retry = await retryPayment(db, CUSTOMER, res.orderId, "success");
    expect(retry.status).toBe("PAID");
    const order = db.select().from(orders).where(eq(orders.id, res.orderId)).get()!;
    expect(order.status).toBe("PAID");
    const pay = db.select().from(payments).where(eq(payments.orderId, res.orderId)).get()!;
    expect(pay.status).toBe("PAID");
    const attempts = db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.paymentId, pay.id))
      .all();
    expect(attempts.map((a) => a.status).sort()).toEqual(["FAILED", "PAID"]);
    expect(reservationsFor(key).every((r) => r.status === "CONSUMED")).toBe(true);
  });

  it("(g) getOrder is owner/admin only", async () => {
    const res = await placeOrder(db, CUSTOMER, baseInput([cartItemId("var_8", 1)]));
    expect(await errorCode(() => getOrder(db, OTHER, res.orderId))).toBe("FORBIDDEN");
    expect(getOrder(db, CUSTOMER, res.orderId).order.id).toBe(res.orderId);
    expect(getOrder(db, ADMIN, res.orderId).order.id).toBe(res.orderId);
    expect(await errorCode(() => getOrder(db, CUSTOMER, "ord_missing"))).toBe("NOT_FOUND");
  });

  it("listOrders is scoped to the customer and paginates by cursor", async () => {
    const page = listOrders(db, CUSTOMER, { limit: 2 });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((o) => o.userId === CUSTOMER.userId)).toBe(true);
    if (page.nextCursor) {
      const next = listOrders(db, CUSTOMER, { limit: 2, cursor: page.nextCursor });
      const ids = new Set(page.items.map((o) => o.id));
      expect(next.items.every((o) => !ids.has(o.id))).toBe(true);
    }
    expect(listOrders(db, OTHER, { limit: 50 }).items).toHaveLength(0);
  });

  it("cancels an unpaid wallet order even with seller_orders present, freeing reservations", async () => {
    const id = cartItemId("var_6", 1);
    const res = await placeOrder(
      db,
      CUSTOMER,
      baseInput([id], { paymentMethod: "MOCK_WALLET", simulate: "failure" }),
    );
    // Seller confirm on the unpaid parent is gated (422) — so the seller side
    // can never pin an unpaid order open.
    const so = db.select().from(sellerOrders).where(eq(sellerOrders.orderId, res.orderId)).get();
    if (!so) throw new Error("seller order missing");
    expect(await errorCode(() => transitionSellerOrder(db, so.id, "CONFIRMED", SHOP2_OWNER))).toBe(
      "INVALID_INPUT",
    );

    const canc = await cancelOrder(db, CUSTOMER, res.orderId);
    expect(canc.status).toBe("CANCELLED");
    const key = db.select().from(orders).where(eq(orders.id, res.orderId)).get()!.idempotencyKey;
    expect(reservationsFor(key).every((r) => r.status === "RELEASED")).toBe(true);
  });

  it("retry after a swept reservation commits PAYMENT_FAILED instead of wedging", async () => {
    // var_2's cart line accumulated across earlier tests — reset to qty 1.
    for (const p of db.select().from(cartItems).where(eq(cartItems.variantId, "var_2")).all()) {
      db.delete(cartItems).where(eq(cartItems.id, p.id)).run();
    }
    const id = cartItemId("var_2", 1);
    const res = await placeOrder(
      db,
      CUSTOMER,
      baseInput([id], { paymentMethod: "MOCK_WALLET", simulate: "failure" }),
    );
    // Simulate the sweep: reservation expires before the customer retries.
    const key = db.select().from(orders).where(eq(orders.id, res.orderId)).get()!.idempotencyKey;
    for (const r of reservationsFor(key)) {
      releaseReservation(db, r.id, "sweep_test");
    }
    const out = await retryPayment(db, CUSTOMER, res.orderId, "success");
    expect(out.status).toBe("PAYMENT_FAILED");
    expect(db.select().from(orders).where(eq(orders.id, res.orderId)).get()!.status).toBe(
      "PAYMENT_FAILED",
    );
    const audit = db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, res.orderId), eq(auditLogs.action, "payment.stock_lost")))
      .all();
    expect(audit).toHaveLength(1);
  });

  it("a failed retry never downgrades a captured payment; cancel still refunds it", async () => {
    // var_3's cart line accumulated across earlier tests — reset to qty 1.
    for (const p of db.select().from(cartItems).where(eq(cartItems.variantId, "var_3")).all()) {
      db.delete(cartItems).where(eq(cartItems.id, p.id)).run();
    }
    const res = await placeOrder(
      db,
      CUSTOMER,
      baseInput([cartItemId("var_3", 1)], { paymentMethod: "MOCK_WALLET", simulate: "failure" }),
    );
    // Stock lost: release the reservation, then a succeeding retry pays but
    // can't consume → PAYMENT_FAILED with a PAID (captured) payment.
    const key = db.select().from(orders).where(eq(orders.id, res.orderId)).get()!.idempotencyKey;
    for (const r of reservationsFor(key)) {
      releaseReservation(db, r.id, "sweep_test");
    }
    const paidRetry = await retryPayment(db, CUSTOMER, res.orderId, "success");
    expect(paidRetry.status).toBe("PAYMENT_FAILED");
    const pay = db.select().from(payments).where(eq(payments.orderId, res.orderId)).get()!;
    expect(pay.status).toBe("PAID");

    // A later failed retry must not downgrade the captured payment.
    const failedRetry = await retryPayment(db, CUSTOMER, res.orderId, "failure");
    expect(failedRetry.status).toBe("PAYMENT_FAILED");
    expect(db.select().from(payments).where(eq(payments.orderId, res.orderId)).get()!.status).toBe(
      "PAID",
    );

    // Cancel refunds the captured amount.
    await cancelOrder(db, CUSTOMER, res.orderId);
    expect(db.select().from(payments).where(eq(payments.orderId, res.orderId)).get()!.status).toBe(
      "REFUNDED",
    );
  });
});
