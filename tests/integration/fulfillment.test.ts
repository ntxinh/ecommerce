import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import {
  auditLogs,
  inventory,
  orderItems,
  paymentAttempts,
  payments,
  sellerOrders,
  shipments,
  stockReservations,
  trackingEvents,
} from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { addItem } from "@/server/modules/cart/service";
import { placeOrder } from "@/server/modules/orders/checkout";
import {
  cancelSellerOrder,
  completeSellerOrder,
  confirmSellerOrder,
  deliverSellerOrder,
  packSellerOrder,
  shipSellerOrder,
} from "@/server/modules/orders/fulfillment";
import { cancelOrder } from "@/server/modules/orders/service";
import { paymentProviderFor } from "@/server/modules/payments/providers";

const PATH = "./tests/.tmp/fulfillment-test.db";
const CUSTOMER: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };
const ADMIN: Actor = { userId: "usr_admin", roles: ["ADMIN"], memberships: [] };
const SHOP1_OWNER: Actor = {
  userId: "usr_seller",
  roles: ["SELLER"],
  memberships: [{ shopId: "shop_1", role: "OWNER", permissions: [] }],
};
const SHOP2_OWNER: Actor = {
  userId: "usr_seller2",
  roles: ["SELLER"],
  memberships: [{ shopId: "shop_2", role: "OWNER", permissions: [] }],
};
const ADDRESS = "addr_1"; // seeded for usr_customer

let db: DB;
let keySeq = 0;
const nextKey = () => `ful_${++keySeq}`;

async function errorCode(fn: () => Promise<unknown> | unknown): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as AuthError).code;
  }
  throw new Error("expected AuthError");
}

function cartItemId(variantId: string, qty: number): string {
  const view = addItem(db, CUSTOMER.userId, variantId, qty);
  return view.items.find((i) => i.variantId === variantId)!.cartItemId;
}

function stock(variantId: string) {
  return db.select().from(inventory).where(eq(inventory.variantId, variantId)).get()!;
}

function leg(orderId: string, shopId: string) {
  return db
    .select()
    .from(sellerOrders)
    .where(eq(sellerOrders.orderId, orderId))
    .all()
    .find((s) => s.shopId === shopId)!;
}

const paidOrder = async (
  items: { variantId: string; qty: number }[],
  extra: Record<string, unknown> = {},
) =>
  placeOrder(db, CUSTOMER, {
    cartItemIds: items.map((i) => cartItemId(i.variantId, i.qty)),
    addressId: ADDRESS,
    shippingByShop: {},
    voucherCodes: [],
    paymentMethod: "MOCK_WALLET",
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

describe("mockBank provider", () => {
  it("mb_ refs, simulate flag, confirm/refund contract", async () => {
    const bank = paymentProviderFor("MOCK_BANK");
    const ok = bank.createAttempt({ amountVnd: 1000 });
    expect(ok.ref).toMatch(/^mb_/);
    expect(await bank.confirm({ ref: ok.ref })).toBe("PAID");

    const bad = bank.createAttempt({ amountVnd: 1000, simulate: "failure" });
    expect(await bank.confirm({ ref: bad.ref })).toBe("FAILED");
    expect(await bank.refund({ ref: bad.ref, amountVnd: 500 })).toBe("REFUNDED");
  });

  it("MOCK_BANK checkout dispatches like the wallet; simulate failure → PAYMENT_FAILED", async () => {
    const ok = await paidOrder([{ variantId: "var_6", qty: 1 }], {
      paymentMethod: "MOCK_BANK",
    });
    expect(ok.status).toBe("PAID");
    const pay = db.select().from(payments).where(eq(payments.orderId, ok.orderId)).get()!;
    expect(pay.status).toBe("PAID");
    expect(pay.method).toBe("MOCK_BANK");

    const bad = await paidOrder([{ variantId: "var_6", qty: 1 }], {
      paymentMethod: "MOCK_BANK",
      simulate: "failure",
    });
    expect(bad.status).toBe("PAYMENT_FAILED");
    const badPay = db.select().from(payments).where(eq(payments.orderId, bad.orderId)).get()!;
    expect(badPay.status).toBe("FAILED");
    expect(
      db.select().from(paymentAttempts).where(eq(paymentAttempts.paymentId, badPay.id)).all(),
    ).toHaveLength(1);
  });
});

describe("seller fulfillment lifecycle", () => {
  it("CONFIRMED → PACKING → SHIPPED (shipment + tracking) → DELIVERED → COMPLETED, with audit rows", async () => {
    const res = await paidOrder([{ variantId: "var_1", qty: 1 }]);
    const so = leg(res.orderId, "shop_1");

    expect(confirmSellerOrder(db, SHOP1_OWNER, so.id).status).toBe("CONFIRMED");
    expect(packSellerOrder(db, SHOP1_OWNER, so.id).status).toBe("PACKING");

    const shipped = shipSellerOrder(db, SHOP1_OWNER, so.id, {
      carrier: "ghn",
      trackingNumber: "TRK-1",
    });
    expect(shipped.status).toBe("SHIPPED");

    const shipment = db.select().from(shipments).where(eq(shipments.sellerOrderId, so.id)).get()!;
    expect(shipment.provider).toBe("ghn");
    expect(shipment.trackingNumber).toBe("TRK-1");
    expect(shipment.status).toBe("IN_TRANSIT");
    expect(
      db
        .select()
        .from(trackingEvents)
        .where(eq(trackingEvents.shipmentId, shipment.id))
        .all()
        .map((e) => e.status),
    ).toEqual(["SHIPPED"]);
    expect(
      db.select().from(sellerOrders).where(eq(sellerOrders.id, so.id)).get()!.trackingNumber,
    ).toBe("TRK-1");

    expect(deliverSellerOrder(db, SHOP1_OWNER, so.id).status).toBe("DELIVERED");
    expect(db.select().from(shipments).where(eq(shipments.id, shipment.id)).get()!.status).toBe(
      "DELIVERED",
    );
    expect(
      db
        .select()
        .from(trackingEvents)
        .where(eq(trackingEvents.shipmentId, shipment.id))
        .all()
        .map((e) => e.status),
    ).toEqual(["SHIPPED", "DELIVERED"]);

    expect(completeSellerOrder(db, SHOP1_OWNER, so.id).status).toBe("COMPLETED");

    const actions = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.targetId, so.id))
      .all()
      .map((a) => a.action);
    expect(actions).toContain("seller_order.transition");
    expect(actions).toContain("shipment.created");
    expect(
      db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.targetId, so.id))
        .all()
        .every((a) => a.actorId === "usr_seller"),
    ).toBe(true);
  });
  it("rejects illegal jumps and non-member actors", async () => {
    const res = await paidOrder([{ variantId: "var_2", qty: 1 }]);
    const so = leg(res.orderId, "shop_1");

    expect(await errorCode(() => packSellerOrder(db, SHOP1_OWNER, so.id))).toBe("INVALID_INPUT");
    expect(
      await errorCode(() =>
        shipSellerOrder(db, SHOP1_OWNER, so.id, { carrier: "ghn", trackingNumber: "X" }),
      ),
    ).toBe("INVALID_INPUT");
    expect(await errorCode(() => deliverSellerOrder(db, SHOP1_OWNER, so.id))).toBe("INVALID_INPUT");
    expect(await errorCode(() => completeSellerOrder(db, SHOP1_OWNER, so.id))).toBe(
      "INVALID_INPUT",
    );

    expect(await errorCode(() => confirmSellerOrder(db, CUSTOMER, so.id))).toBe("FORBIDDEN");
    expect(await errorCode(() => confirmSellerOrder(db, SHOP2_OWNER, so.id))).toBe("FORBIDDEN");
    expect(await errorCode(() => confirmSellerOrder(db, ADMIN, "so_missing"))).toBe("NOT_FOUND");
    expect(leg(res.orderId, "shop_1").status).toBe("NEW");
  });

  it("seller cannot progress a leg while the parent order is unpaid", async () => {
    const res = await paidOrder([{ variantId: "var_7", qty: 1 }], {
      paymentMethod: "MOCK_BANK",
      simulate: "failure",
    });
    const so = leg(res.orderId, "shop_2");
    expect(await errorCode(() => confirmSellerOrder(db, SHOP2_OWNER, so.id))).toBe("INVALID_INPUT");
  });
});

describe("cancelSellerOrder", () => {
  it("releases the leg's reservation share and refunds its slice of a paid order", async () => {
    const res = await paidOrder(
      [
        { variantId: "var_2", qty: 1 }, // shop_1 leg
        { variantId: "var_6", qty: 2 }, // shop_2 leg
      ],
      { voucherCodes: ["WELCOME10"] }, // platform voucher crosses both legs
    );
    const so1 = leg(res.orderId, "shop_1");

    const before = stock("var_2");
    const legItems = db.select().from(orderItems).where(eq(orderItems.sellerOrderId, so1.id)).all();
    const legQty = legItems.reduce((s, l) => s + l.qty, 0);
    const share = legItems.reduce((s, l) => s + l.lineTotalVnd, 0) + so1.shippingVnd;

    const out = await cancelSellerOrder(db, SHOP1_OWNER, so1.id);
    expect(out.status).toBe("CANCELLED");
    expect(out.refundedVnd).toBe(share);
    expect(share).toBeGreaterThan(0);

    // Paid online leg: reservation was CONSUMED at dispatch, so cancel
    // restores on_hand; the row flips to RELEASED.
    const after = stock("var_2");
    expect(after.reserved).toBe(before.reserved);
    expect(after.onHand).toBe(before.onHand + legQty);

    expect(
      db
        .select()
        .from(stockReservations)
        .all()
        .filter((r) => r.idempotencyKey.endsWith(":var_2") && r.status === "RELEASED"),
    ).toHaveLength(1);

    // Payment stays PAID (partial); the audit row is the ledger entry.
    const payment = db.select().from(payments).where(eq(payments.orderId, res.orderId)).get()!;
    expect(payment.status).toBe("PAID");
    expect(
      db
        .select()
        .from(auditLogs)
        .all()
        .filter((a) => a.action === "order.partial_refund" && a.targetId === so1.id)
        .map((a) => JSON.parse(a.metaJson).refundVnd),
    ).toEqual([share]);

    // Sibling leg untouched; the cancelled leg is idempotent and refunds once.
    expect(leg(res.orderId, "shop_2").status).toBe("NEW");
    const again = await cancelSellerOrder(db, SHOP1_OWNER, so1.id);
    expect(again.refundedVnd).toBe(0);
    expect(
      db
        .select()
        .from(auditLogs)
        .all()
        .filter((a) => a.action === "order.partial_refund" && a.targetId === so1.id),
    ).toHaveLength(1);
  });

  it("restores on_hand for a COD leg (reservation was consumed at checkout)", async () => {
    const res = await placeOrder(db, CUSTOMER, {
      cartItemIds: [cartItemId("var_8", 2)],
      addressId: ADDRESS,
      shippingByShop: {},
      voucherCodes: [],
      paymentMethod: "COD",
      idempotencyKey: nextKey(),
    });
    const so = leg(res.orderId, "shop_2");
    const before = stock("var_8");

    const out = await cancelSellerOrder(db, SHOP2_OWNER, so.id);
    expect(out.refundedVnd).toBe(0);
    const after = stock("var_8");
    expect(after.onHand).toBe(before.onHand + 2);
    expect(after.reserved).toBe(before.reserved);
  });

  it("a progressed leg cannot be cancelled; owner/customer cannot leg-cancel", async () => {
    const res = await paidOrder([{ variantId: "var_5", qty: 1 }]);
    const so = leg(res.orderId, "shop_1");
    confirmSellerOrder(db, SHOP1_OWNER, so.id);
    packSellerOrder(db, SHOP1_OWNER, so.id);
    expect(await errorCode(() => cancelSellerOrder(db, SHOP1_OWNER, so.id))).toBe("INVALID_INPUT");

    const res2 = await paidOrder([{ variantId: "var_3", qty: 1 }]);
    const so2 = leg(res2.orderId, "shop_1");
    expect(await errorCode(() => cancelSellerOrder(db, CUSTOMER, so2.id))).toBe("FORBIDDEN");
    expect(await errorCode(() => cancelSellerOrder(db, SHOP2_OWNER, so2.id))).toBe("FORBIDDEN");
  });
});

describe("review fixes", () => {
  it("seller-cancelling one leg doesn't block the buyer cancelling the rest", async () => {
    const res = await paidOrder([
      { variantId: "var_3", qty: 1 },
      { variantId: "var_6", qty: 1 },
    ]);
    const so1 = leg(res.orderId, "shop_1");
    const so2 = leg(res.orderId, "shop_2");

    await cancelSellerOrder(db, SHOP1_OWNER, so1.id);

    // A CANCELLED leg must not count as "progressed" — the buyer can still
    // cancel the order, which releases the remaining leg's stock.
    const out = await cancelOrder(db, CUSTOMER, res.orderId);
    expect(out.status).toBe("CANCELLED");
    expect(leg(res.orderId, "shop_2").status).toBe("CANCELLED");
    expect(db.select().from(payments).where(eq(payments.orderId, res.orderId)).get()!.status).toBe(
      "REFUNDED",
    );
    expect(so2.shopId).toBe("shop_2");
  });

  it("duplicate tracking number → INVALID_INPUT, not a raw constraint error", async () => {
    const a = await paidOrder([{ variantId: "var_7", qty: 1 }]);
    const soA = leg(a.orderId, "shop_2");
    confirmSellerOrder(db, SHOP2_OWNER, soA.id);
    packSellerOrder(db, SHOP2_OWNER, soA.id);
    shipSellerOrder(db, SHOP2_OWNER, soA.id, { carrier: "ghn", trackingNumber: "TRK-DUP" });

    const b = await paidOrder([{ variantId: "var_6", qty: 1 }]);
    const soB = leg(b.orderId, "shop_2");
    confirmSellerOrder(db, SHOP2_OWNER, soB.id);
    packSellerOrder(db, SHOP2_OWNER, soB.id);
    expect(
      await errorCode(() =>
        shipSellerOrder(db, SHOP2_OWNER, soB.id, { carrier: "ghn", trackingNumber: "TRK-DUP" }),
      ),
    ).toBe("INVALID_INPUT");
    // Failed attempt left no shipment behind.
    expect(
      db.select().from(shipments).where(eq(shipments.sellerOrderId, soB.id)).all(),
    ).toHaveLength(0);
  });
});
