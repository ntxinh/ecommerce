import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { ulid } from "ulidx";
import { beforeAll, describe, expect, it } from "vitest";
import { RequestReturnInput } from "@/server/api/contracts/returns";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import {
  financialLedgerEntries,
  inventory,
  inventoryMovements,
  orderItems,
  orders,
  payments,
  refunds,
  returnRequests,
  sellerOrders,
} from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { addItem, clearCart } from "@/server/modules/cart/service";
import { balance, type LedgerAccount, postOrderRecognition } from "@/server/modules/finance/ledger";
import { releaseOrderReservations } from "@/server/modules/inventory/service";
import { placeOrder } from "@/server/modules/orders/checkout";
import {
  confirmSellerOrder,
  deliverSellerOrder,
  packSellerOrder,
  shipSellerOrder,
} from "@/server/modules/orders/fulfillment";
import { persistPaymentOutcome } from "@/server/modules/orders/outcome";
import { decideReturn, requestReturn } from "@/server/modules/orders/returns";
import { cancelOrder, retryPayment } from "@/server/modules/orders/service";
import { issueReturnRefunds } from "@/server/modules/payments/refunds";

const PATH = "./tests/.tmp/finance-test.db";
const CUSTOMER: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };
const SHOP1_OWNER: Actor = {
  userId: "usr_seller",
  roles: ["SELLER"],
  memberships: [{ shopId: "shop_1", role: "OWNER", permissions: [] }],
};
const ADDRESS = "addr_1";
const BPS = 500; // seed commission_rate_bps

let db: DB;
let keySeq = 0;
const nextKey = () => `fin_${++keySeq}`;

// --- ledger assertions -------------------------------------------------------

const entries = () => db.select().from(financialLedgerEntries).all();

/** Entries scoped to one order (ORDER refId + its refunds' REFUND refIds). */
function orderEntries(orderId: string) {
  const payment = db.select().from(payments).where(eq(payments.orderId, orderId)).get();
  const refundIds = payment
    ? db
        .select({ id: refunds.id })
        .from(refunds)
        .where(eq(refunds.paymentId, payment.id))
        .all()
        .map((r) => r.id)
    : [];
  return entries().filter(
    (e) =>
      (e.refType === "ORDER" && e.refId === orderId) ||
      (e.refType === "REFUND" && refundIds.includes(e.refId)),
  );
}

const scopedSum = (rows: { account: string; amountVnd: number }[], account: LedgerAccount) =>
  rows.filter((r) => r.account === account).reduce((s, r) => s + r.amountVnd, 0);

/** The money invariant, evaluated globally over the whole ledger. */
function globalInvariant() {
  const all = entries();
  return (
    scopedSum(all, "CUSTOMER_PAYABLE") -
    scopedSum(all, "SELLER_PAYABLE") -
    scopedSum(all, "PLATFORM_REVENUE") -
    scopedSum(all, "REFUNDS_PAYABLE")
  );
}

// --- fixtures ----------------------------------------------------------------

function cartItemId(variantId: string, qty: number): string {
  clearCart(db, CUSTOMER.userId);
  return addItem(db, CUSTOMER.userId, variantId, qty).items.find((i) => i.variantId === variantId)!
    .cartItemId;
}

/** MOCK_WALLET order that settles PAID inside placeOrder's dispatch. */
async function paidOrder(variantId: string, qty: number) {
  const res = await placeOrder(db, CUSTOMER, {
    cartItemIds: [cartItemId(variantId, qty)],
    addressId: ADDRESS,
    shippingByShop: {},
    voucherCodes: [],
    paymentMethod: "MOCK_WALLET",
    idempotencyKey: nextKey(),
  });
  const payment = db.select().from(payments).where(eq(payments.orderId, res.orderId)).get()!;
  const so = db.select().from(sellerOrders).where(eq(sellerOrders.orderId, res.orderId)).all()[0];
  return { ...res, payment, so };
}

/** COD order variant (payment stays PENDING — nothing captured). */
async function codOrder(variantId: string, qty: number) {
  const res = await placeOrder(db, CUSTOMER, {
    cartItemIds: [cartItemId(variantId, qty)],
    addressId: ADDRESS,
    shippingByShop: {},
    voucherCodes: [],
    paymentMethod: "COD",
    idempotencyKey: nextKey(),
  });
  const payment = db.select().from(payments).where(eq(payments.orderId, res.orderId)).get()!;
  const so = db.select().from(sellerOrders).where(eq(sellerOrders.orderId, res.orderId)).all()[0];
  return { ...res, payment, so };
}

/** PAID order with its shop_1 leg driven to DELIVERED. */
async function paidDeliveredLeg(variantId: string, qty: number) {
  const res = await paidOrder(variantId, qty);
  confirmSellerOrder(db, SHOP1_OWNER, res.so.id);
  packSellerOrder(db, SHOP1_OWNER, res.so.id);
  shipSellerOrder(db, SHOP1_OWNER, res.so.id, { carrier: "ghn", trackingNumber: nextKey() });
  deliverSellerOrder(db, SHOP1_OWNER, res.so.id);
  return res;
}

const retInput = (
  sellerOrderId: string,
  items: { orderItemId: string; qty: number; restock?: boolean }[],
) => RequestReturnInput.parse({ sellerOrderId, items, reason: "arrived broken", evidence: [] });

const orderStatus = (id: string) => db.select().from(orders).where(eq(orders.id, id)).get()!.status;
const paymentStatus = (id: string) =>
  db.select().from(payments).where(eq(payments.id, id)).get()!.status;

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
});

// -----------------------------------------------------------------------------

describe("order recognition postings", () => {
  it("PAID order posts CUSTOMER_PAYABLE = total, per-leg SELLER_PAYABLE/PLATFORM_REVENUE, shipping revenue; invariant holds", async () => {
    const { orderId, so } = await paidOrder("var_2", 2); // shop_1, +15_000 shipping
    const order = db.select().from(orders).where(eq(orders.id, orderId)).get()!;
    const c = Math.floor((so.subtotalVnd * BPS) / 10000);

    const rows = orderEntries(orderId).filter((e) => e.refType === "ORDER");
    expect(rows).toHaveLength(4);
    expect(scopedSum(rows, "CUSTOMER_PAYABLE")).toBe(order.totalVnd);
    expect(rows.find((r) => r.account === "CUSTOMER_PAYABLE")!.shopId).toBeNull();
    expect(scopedSum(rows, "SELLER_PAYABLE")).toBe(so.subtotalVnd - c);
    expect(rows.find((r) => r.account === "SELLER_PAYABLE")!.shopId).toBe("shop_1");
    expect(scopedSum(rows, "PLATFORM_REVENUE")).toBe(c + so.shippingVnd);

    expect(balance(db, "SELLER_PAYABLE", "shop_1")).toBe(so.subtotalVnd - c);
    expect(globalInvariant()).toBe(0);
  });

  it("floors commission on odd subtotals", () => {
    const orderId = `ord_${ulid()}`;
    const now = Date.now();
    db.transaction((tx) => {
      tx.insert(orders)
        .values({
          id: orderId,
          userId: CUSTOMER.userId,
          addressSnapshotJson: "{}",
          status: "PAID",
          totalVnd: 30000,
          subtotalVnd: 30000,
          shippingVnd: 0,
          discountVnd: 0,
          idempotencyKey: nextKey(),
          createdAt: now,
          updatedAt: now,
        })
        .run();
      for (const [i, subtotalVnd] of [9999, 20001].entries()) {
        tx.insert(sellerOrders)
          .values({
            id: `so_hand_${i}_${ulid()}`,
            orderId,
            shopId: "shop_1",
            status: "NEW",
            subtotalVnd,
            shippingVnd: 0,
            commissionRateBps: BPS,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
      // postOrderRecognition is the recognition path; drive it directly to
      // assert floor() on subtotals the seed catalog can't produce.
      postOrderRecognition(tx, orderId);
    });
    const rows = orderEntries(orderId);
    // 9999*5% = 499.95 → 499; 20001*5% = 1000.05 → 1000
    expect(scopedSum(rows, "PLATFORM_REVENUE")).toBe(499 + 1000);
    expect(scopedSum(rows, "SELLER_PAYABLE")).toBe(9999 - 499 + (20001 - 1000));
    expect(scopedSum(rows, "CUSTOMER_PAYABLE")).toBe(30000);
  });

  it("redelivering the PAID outcome does not double-post", async () => {
    const { orderId, payment } = await paidOrder("var_6", 1);
    const before = orderEntries(orderId).length;
    const again = persistPaymentOutcome(db, payment.id, "PAID");
    expect(again.orderStatus).toBe("PAID");
    expect(orderEntries(orderId)).toHaveLength(before);
  });
});

describe("return refunds", () => {
  it("APPROVED return issues+completes a refund: postings keep the invariant, request REFUNDED, order PARTIALLY_REFUNDED", async () => {
    const { orderId, so, payment } = await paidDeliveredLeg("var_2", 2);
    const item = db.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id)).all()[0];
    const x = Math.floor((item.lineTotalVnd * 1) / item.qty); // 150000
    const c = Math.floor((so.subtotalVnd * BPS) / 10000);
    const cPrime = Math.floor((x * BPS) / 10000);

    const rrId = requestReturn(db, CUSTOMER, retInput(so.id, [{ orderItemId: item.id, qty: 1 }]));
    await decideReturn(db, SHOP1_OWNER, rrId, "APPROVED");

    const refundRows = db.select().from(refunds).where(eq(refunds.paymentId, payment.id)).all();
    expect(refundRows).toHaveLength(1);
    expect(refundRows[0].status).toBe("COMPLETED");
    expect(refundRows[0].amountVnd).toBe(x);
    expect(refundRows[0].returnItemId).not.toBeNull();

    const rows = orderEntries(orderId);
    expect(scopedSum(rows, "REFUNDS_PAYABLE")).toBe(0); // +x then −x
    expect(scopedSum(rows, "SELLER_PAYABLE")).toBe(so.subtotalVnd - c - (x - cPrime));
    expect(scopedSum(rows, "PLATFORM_REVENUE")).toBe(c + so.shippingVnd - cPrime);
    expect(scopedSum(rows, "CUSTOMER_PAYABLE")).toBe(so.subtotalVnd + so.shippingVnd - x);

    expect(db.select().from(returnRequests).where(eq(returnRequests.id, rrId)).get()!.status).toBe(
      "REFUNDED",
    );
    // Partial claim: the leg settles back to COMPLETED so the remaining unit
    // can still be returned within the window.
    expect(db.select().from(sellerOrders).where(eq(sellerOrders.id, so.id)).get()!.status).toBe(
      "COMPLETED",
    );
    expect(orderStatus(orderId)).toBe("PARTIALLY_REFUNDED"); // 1 of 2 units refunded
    expect(paymentStatus(payment.id)).toBe("PAID"); // partially refunded
    expect(globalInvariant()).toBe(0);

    // Second in-window request on the COMPLETED leg claims the last unit →
    // fully claimed leg lands RETURNED, order REFUNDED.
    const rr2 = requestReturn(db, CUSTOMER, retInput(so.id, [{ orderItemId: item.id, qty: 1 }]));
    await decideReturn(db, SHOP1_OWNER, rr2, "APPROVED");
    expect(db.select().from(returnRequests).where(eq(returnRequests.id, rr2)).get()!.status).toBe(
      "REFUNDED",
    );
    expect(db.select().from(sellerOrders).where(eq(sellerOrders.id, so.id)).get()!.status).toBe(
      "RETURNED",
    );
    expect(orderStatus(orderId)).toBe("REFUNDED");
    // Both units' line totals refunded; shipping never is → payment still PAID.
    expect(paymentStatus(payment.id)).toBe("PAID");
    expect(globalInvariant()).toBe(0);
  });

  it("restock:true returns units to on_hand with a return_restock movement", async () => {
    const { so } = await paidDeliveredLeg("var_3", 1);
    const item = db.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id)).all()[0];
    const onHand = () =>
      db.select().from(inventory).where(eq(inventory.variantId, item.variantId)).get()!.onHand;
    const before = onHand();

    const rrId = requestReturn(
      db,
      CUSTOMER,
      retInput(so.id, [{ orderItemId: item.id, qty: 1, restock: true }]),
    );
    await decideReturn(db, SHOP1_OWNER, rrId, "APPROVED");

    expect(onHand()).toBe(before + 1);
    const mov = db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, item.variantId))
      .all()
      .at(-1)!;
    expect(mov.reason).toBe("return_restock");
    expect(mov.delta).toBe(1);
    expect(mov.actorId).toBe(SHOP1_OWNER.userId);

    // A repeat issue is a pure no-op: no second restock, no second row.
    const again = db.transaction((tx) => issueReturnRefunds(tx, rrId, SHOP1_OWNER.userId));
    expect(again).toHaveLength(0);
    expect(onHand()).toBe(before + 1);
  });

  it("COD return settles in-tx: marker row, restock, request REFUNDED, no provider call needed", async () => {
    const res = await codOrder("var_1", 1);
    const so = db.select().from(sellerOrders).where(eq(sellerOrders.orderId, res.orderId)).all()[0];
    confirmSellerOrder(db, SHOP1_OWNER, so.id);
    packSellerOrder(db, SHOP1_OWNER, so.id);
    shipSellerOrder(db, SHOP1_OWNER, so.id, { carrier: "ghn", trackingNumber: nextKey() });
    deliverSellerOrder(db, SHOP1_OWNER, so.id);
    const item = db.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id)).all()[0];
    const onHand = () =>
      db.select().from(inventory).where(eq(inventory.variantId, item.variantId)).get()!.onHand;
    const before = onHand();

    const rrId = requestReturn(
      db,
      CUSTOMER,
      retInput(so.id, [{ orderItemId: item.id, qty: 1, restock: true }]),
    );
    await decideReturn(db, SHOP1_OWNER, rrId, "APPROVED");

    expect(db.select().from(returnRequests).where(eq(returnRequests.id, rrId)).get()!.status).toBe(
      "REFUNDED",
    );
    expect(db.select().from(sellerOrders).where(eq(sellerOrders.id, so.id)).get()!.status).toBe(
      "RETURNED",
    );
    expect(onHand()).toBe(before + 1);
    const rows = db.select().from(refunds).where(eq(refunds.paymentId, res.payment.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("COMPLETED"); // zero-amount marker — nothing captured
    expect(rows[0].amountVnd).toBe(0);
    expect(globalInvariant()).toBe(0); // COD: no recognition postings, nothing to claw back
  });

  it("duplicate issueReturnRefunds issues only one refunds row", async () => {
    const { so, payment } = await paidDeliveredLeg("var_4", 1);
    const item = db.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id)).all()[0];
    const rrId = requestReturn(db, CUSTOMER, retInput(so.id, [{ orderItemId: item.id, qty: 1 }]));
    await decideReturn(db, SHOP1_OWNER, rrId, "APPROVED");

    const before = db.select().from(refunds).where(eq(refunds.paymentId, payment.id)).all();
    expect(before).toHaveLength(1);
    const again = db.transaction((tx) => issueReturnRefunds(tx, rrId));
    expect(again).toHaveLength(0); // UNIQUE(return_item_id) conflict → skipped
    expect(db.select().from(refunds).where(eq(refunds.paymentId, payment.id)).all()).toHaveLength(
      before.length,
    );
  });

  it("order reaches REFUNDED only when every line is covered by completed refunds", async () => {
    const { orderId, so, payment } = await paidDeliveredLeg("var_5", 1);
    const item = db.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id)).all()[0];

    // Single-unit order: the one line fully covered → REFUNDED (partial path
    // asserted above via PARTIALLY_REFUNDED).
    const rr1 = requestReturn(db, CUSTOMER, retInput(so.id, [{ orderItemId: item.id, qty: 1 }]));
    await decideReturn(db, SHOP1_OWNER, rr1, "APPROVED");

    expect(orderStatus(orderId)).toBe("REFUNDED");
    // Return refunds cover line totals only — the shipping charge is never
    // refunded, so the payment keeps the captured remainder (stays PAID).
    expect(paymentStatus(payment.id)).toBe("PAID");
    expect(globalInvariant()).toBe(0);
  });
});

describe("cancellation refunds", () => {
  it("cancelling a PAID order writes a COMPLETED refunds row and nets the ledger to zero", async () => {
    const { orderId, so, payment } = await paidOrder("var_6", 1);
    const x = so.subtotalVnd + so.shippingVnd; // leg share = line totals + shipping
    const cPrime = Math.floor((x * BPS) / 10000);

    await cancelOrder(db, CUSTOMER, orderId);

    const rows = db.select().from(refunds).where(eq(refunds.paymentId, payment.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("COMPLETED");
    expect(rows[0].returnItemId).toBeNull(); // cancellation refund
    expect(rows[0].amountVnd).toBe(x);

    const scoped = orderEntries(orderId);
    expect(scopedSum(scoped, "CUSTOMER_PAYABLE")).toBe(0);
    expect(scopedSum(scoped, "SELLER_PAYABLE")).toBe(
      so.subtotalVnd - Math.floor((so.subtotalVnd * BPS) / 10000) - (x - cPrime),
    );
    expect(scopedSum(scoped, "REFUNDS_PAYABLE")).toBe(0);
    expect(paymentStatus(payment.id)).toBe("REFUNDED");
    expect(globalInvariant()).toBe(0);
  });
});

describe("stock-lost wedge", () => {
  it("PAID capture with lost stock still posts recognition so the later cancel's clawbacks balance", async () => {
    // Fail the first attempt → PAYMENT_FAILED, then free the reservations so
    // the retry's successful capture wedges on missing stock.
    const res = await placeOrder(db, CUSTOMER, {
      cartItemIds: [cartItemId("var_2", 1)],
      addressId: ADDRESS,
      shippingByShop: {},
      voucherCodes: [],
      paymentMethod: "MOCK_WALLET",
      idempotencyKey: nextKey(),
      simulate: "failure",
    });
    const order = db.select().from(orders).where(eq(orders.id, res.orderId)).get()!;
    const variantIds = db
      .select({ variantId: orderItems.variantId })
      .from(orderItems)
      .where(eq(orderItems.orderId, res.orderId))
      .all()
      .map((l) => l.variantId);
    db.transaction((tx) =>
      releaseOrderReservations(tx, order.idempotencyKey, variantIds, undefined, "test_release"),
    );

    const retry = await retryPayment(db, CUSTOMER, res.orderId, "success");
    expect(retry.status).toBe("PAYMENT_FAILED"); // captured but stock gone
    const payment = db.select().from(payments).where(eq(payments.orderId, res.orderId)).get()!;
    expect(payment.status).toBe("PAID");

    // Recognition posted despite the wedge — CP/SP/PR reflect the capture.
    expect(orderEntries(res.orderId).filter((e) => e.refType === "ORDER").length).toBeGreaterThan(
      0,
    );

    await cancelOrder(db, CUSTOMER, res.orderId);
    const scoped = orderEntries(res.orderId);
    expect(scopedSum(scoped, "CUSTOMER_PAYABLE")).toBe(0);
    expect(scopedSum(scoped, "REFUNDS_PAYABLE")).toBe(0);
    expect(scopedSum(scoped, "SELLER_PAYABLE") + scopedSum(scoped, "PLATFORM_REVENUE")).toBe(0);
    expect(globalInvariant()).toBe(0);
  });
});
