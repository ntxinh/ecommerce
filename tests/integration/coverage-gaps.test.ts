import { createHmac } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { RequestReturnInput } from "@/server/api/contracts/returns";
import type { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import {
  applicationSettings,
  financialLedgerEntries,
  inventory,
  orderItems,
  payments,
  refunds,
  sellerOrders,
  stockReservations,
  vouchers,
} from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { addItem, clearCart } from "@/server/modules/cart/service";
import { sellerAnalytics } from "@/server/modules/finance/analytics";
import { balance, post, postOrderRecognition } from "@/server/modules/finance/ledger";
import {
  consumeReservation,
  releaseOrderReservations,
  releaseReservation,
  reserveStock,
} from "@/server/modules/inventory/service";
import { placeOrder } from "@/server/modules/orders/checkout";
import {
  confirmSellerOrder,
  deliverSellerOrder,
  packSellerOrder,
  shipSellerOrder,
} from "@/server/modules/orders/fulfillment";
import { decideReturn, requestReturn } from "@/server/modules/orders/returns";
import {
  type Finix,
  finixCard,
  finixCheckoutLink,
  finixConfigured,
  finixFormTransfer,
  processFinixEvent,
  setFinixForTests,
  verifyFinixSignature,
} from "@/server/modules/payments/finix";
import { type PaymentMethod, paymentProviderFor } from "@/server/modules/payments/providers";
import {
  completeRefund,
  issueReturnRefunds,
  markPaymentRefundedIfComplete,
} from "@/server/modules/payments/refunds";
import {
  sessionPaymentStatus,
  setStripeForTests,
  stripeCard,
} from "@/server/modules/payments/stripe";
import { consumeRedemptions, validateVoucher } from "@/server/modules/pricing/vouchers";

const PATH = "./tests/.tmp/coverage-gaps-test.db";
const CUSTOMER: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };
const ADMIN: Actor = { userId: "usr_admin", roles: ["ADMIN"], memberships: [] };
const SELLER_A: Actor = {
  userId: "usr_seller",
  roles: ["SELLER"],
  memberships: [{ shopId: "shop_1", role: "OWNER", permissions: [] }],
};
const ADDRESS = "addr_1";

let db: DB;
let keySeq = 0;
const nextKey = () => `gap_${++keySeq}`;

async function errorCode(fn: () => Promise<unknown> | unknown): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as AuthError).code;
  }
  throw new Error("expected AuthError");
}

function cartItemId(variantId: string, qty = 1): string {
  clearCart(db, CUSTOMER.userId);
  return addItem(db, CUSTOMER.userId, variantId, qty).items.find((i) => i.variantId === variantId)!
    .cartItemId;
}

/** A paid order; returns orderId and its shop_1 leg id. */
async function paidOrder(variantId: string) {
  const res = await placeOrder(db, CUSTOMER, {
    cartItemIds: [cartItemId(variantId)],
    addressId: ADDRESS,
    shippingByShop: {},
    voucherCodes: [],
    paymentMethod: "MOCK_WALLET",
    idempotencyKey: nextKey(),
  });
  const so = db
    .select()
    .from(sellerOrders)
    .where(eq(sellerOrders.orderId, res.orderId))
    .all()
    .find((s) => s.shopId === "shop_1")!;
  return { orderId: res.orderId, legId: so.id };
}

function stubFinix(handlers: Record<string, (id: string, body?: unknown) => unknown>): Finix {
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    let data: unknown = {};
    if (method === "POST" && path === "/checkout_forms") {
      data = handlers.createForm?.(path, body) ?? {};
    } else if (method === "GET" && path.startsWith("/transfer_attempts")) {
      data = handlers.transferAttempts?.(new URL(url).searchParams.get("entity_id") ?? "") ?? {
        _embedded: { transfer_attempts: [] },
      };
    } else if (method === "GET" && path.startsWith("/transfers/")) {
      data = handlers.getTransfer?.(path.split("/")[2]) ?? {};
    } else if (method === "POST" && path.endsWith("/reversals")) {
      data = handlers.reverse?.(path.split("/")[2], body) ?? {};
    } else if (method === "GET" && path.startsWith("/checkout_forms/")) {
      data = handlers.getForm?.(path.split("/")[2]) ?? {};
    }
    return new Response(JSON.stringify(data), { status: 200 });
  };
  return {
    fetchFn: fetchFn as unknown as typeof fetch,
    base: "https://finix.test",
    auth: "Basic test",
    merchantId: "MU_test",
  };
}

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
});

afterEach(() => {
  setFinixForTests(undefined);
  setStripeForTests(undefined);
});

describe("finance/ledger", () => {
  it("postOrderRecognition is a no-op on replay and NOT_FOUND on a missing order", async () => {
    const { orderId } = await paidOrder("var_1");
    // Checkout already recognized the paid order — replay must add nothing.
    const before = db
      .select()
      .from(financialLedgerEntries)
      .all()
      .filter((e) => e.refId === orderId).length;
    db.transaction((tx) => postOrderRecognition(tx, orderId));
    const after = db
      .select()
      .from(financialLedgerEntries)
      .all()
      .filter((e) => e.refId === orderId).length;
    expect(after).toBe(before);
    expect(after).toBeGreaterThan(0);
    expect(
      await errorCode(() => db.transaction((tx) => postOrderRecognition(tx, "ord_missing"))),
    ).toBe("NOT_FOUND");
  });

  it("balance scopes SELLER_PAYABLE per shop and tolerates empty accounts", () => {
    db.transaction((tx) => {
      post(tx, {
        account: "SELLER_PAYABLE",
        shopId: "shop_1",
        amountVnd: 100,
        refType: "ORDER",
        refId: nextKey(),
      });
      post(tx, {
        account: "SELLER_PAYABLE",
        shopId: "shop_2",
        amountVnd: 40,
        refType: "ORDER",
        refId: nextKey(),
      });
    });
    expect(balance(db, "SELLER_PAYABLE", "shop_1")).toBe(balance(db, "SELLER_PAYABLE") - 40);
    expect(balance(db, "SELLER_PAYABLE", "shop_none")).toBe(0);
  });

  it("sellerAnalytics on a shop with no legs reports zeros", () => {
    const a = sellerAnalytics(db, ADMIN, "shop_none");
    expect(a.orderCount).toBe(0);
    expect(a.gmvVnd).toBe(0);
    expect(a.cancelRatePct).toBe(0);
    expect(a.daily).toHaveLength(30);
  });
});

describe("pricing/vouchers", () => {
  it("validateVoucher rejects a SHOP voucher claimed on a different shop", () => {
    const voucher = db.select().from(vouchers).where(eq(vouchers.id, "vch_2")).get()!;
    expect(
      validateVoucher(db, voucher, {
        userId: CUSTOMER.userId,
        scopeSubtotalVnd: 500_000,
        shopId: "shop_1", // voucher belongs to shop_2
        now: Date.now(),
      }),
    ).toEqual({ code: "SHOP2FIX", reason: "WRONG_SHOP" });
  });

  it("consumeRedemptions throws VOUCHER_INVALID for a missing voucher", async () => {
    const res = await errorCode(() =>
      db.transaction((tx) =>
        consumeRedemptions(
          tx,
          CUSTOMER.userId,
          [{ voucherId: "vch_none", code: "?", discountVnd: 0 }],
          nextKey(),
        ),
      ),
    );
    expect(res).toBe("VOUCHER_INVALID");
  });
});

describe("payments/providers", () => {
  it("paymentProviderFor rejects an unsupported method", async () => {
    expect(await errorCode(() => paymentProviderFor("PAYPAL" as unknown as PaymentMethod))).toBe(
      "INVALID_INPUT",
    );
  });

  it("COD adapter settles instantly: ref issued, confirm PAID, refund REFUNDED", async () => {
    const cod = paymentProviderFor("COD");
    const { ref } = await cod.createAttempt({ amountVnd: 1000 });
    expect(ref).toMatch(/^cod_/);
    expect(await cod.confirm({ ref })).toBe("PAID");
    expect(await cod.refund({ ref, amountVnd: 1000 })).toBe("REFUNDED");
  });
});

describe("payments/stripe adapter edge cases", () => {
  it("sessionPaymentStatus keeps settling sessions PENDING", () => {
    expect(sessionPaymentStatus({ status: "open", payment_status: "unpaid" })).toBe("PENDING");
    expect(sessionPaymentStatus({ status: "complete", payment_status: "unpaid" })).toBe("PENDING");
    expect(sessionPaymentStatus({ status: "expired", payment_status: "unpaid" })).toBe("FAILED");
    expect(sessionPaymentStatus({ status: null, payment_status: "paid" })).toBe("PAID");
  });

  it("refund on an unpaid session (no payment_intent) returns REFUNDED without a call", async () => {
    let refundCalls = 0;
    setStripeForTests({
      checkout: {
        sessions: {
          retrieve: async () => ({
            id: "cs_test",
            status: "open",
            payment_status: "unpaid",
            payment_intent: null,
          }),
        },
      },
      refunds: {
        create: async () => {
          refundCalls += 1;
          return {};
        },
      },
    } as unknown as Stripe);
    expect(await stripeCard.refund({ ref: "cs_test", amountVnd: 1000 })).toBe("REFUNDED");
    expect(refundCalls).toBe(0);
  });

  it("refund on a paid session issues a Stripe refund for the payment_intent", async () => {
    let captured: { payment_intent: string; amount: number } | undefined;
    setStripeForTests({
      checkout: {
        sessions: {
          retrieve: async () => ({
            id: "cs_paid",
            status: "complete",
            payment_status: "paid",
            payment_intent: "pi_1",
          }),
        },
      },
      refunds: {
        create: async (args: { payment_intent: string; amount: number }) => {
          captured = args;
          return {};
        },
      },
    } as unknown as Stripe);
    expect(await stripeCard.refund({ ref: "cs_paid", amountVnd: 5000 })).toBe("REFUNDED");
    expect(captured).toEqual({ payment_intent: "pi_1", amount: 5000 });
  });

  it("createAttempt demands order context", async () => {
    setStripeForTests({} as unknown as Stripe);
    expect(await errorCode(() => stripeCard.createAttempt({ amountVnd: 1 }))).toBe("INVALID_INPUT");
    setStripeForTests(null);
    expect(
      await errorCode(() =>
        stripeCard.createAttempt({
          amountVnd: 1,
          orderId: "ord_1",
          attemptId: "att_1",
          origin: "https://shop.test",
        }),
      ),
    ).toBe("INVALID_INPUT");
  });
});

describe("payments/finix adapter edge cases", () => {
  it("finixConfigured reflects env credentials", () => {
    delete process.env.FINIX_USERNAME;
    expect(finixConfigured()).toBe(false);
    process.env.FINIX_USERNAME = "u";
    process.env.FINIX_PASSWORD = "p";
    process.env.FINIX_MERCHANT_ID = "m";
    expect(finixConfigured()).toBe(true);
    delete process.env.FINIX_USERNAME;
    delete process.env.FINIX_PASSWORD;
    delete process.env.FINIX_MERCHANT_ID;
  });

  it("finixCheckoutLink returns the hosted link or null", async () => {
    const f = stubFinix({ getForm: () => ({ checkout_link: "https://pay.test/x" }) });
    expect(await finixCheckoutLink(f, "checkout_form_1")).toBe("https://pay.test/x");
    const dead = stubFinix({});
    // {} form body → both fields undefined → null
    expect(await finixCheckoutLink(dead, "checkout_form_2")).toBeNull();
    const boom = stubFinix({
      getForm: () => {
        throw new Error("boom");
      },
    });
    expect(await finixCheckoutLink(boom, "checkout_form_3")).toBeNull();
  });

  it("createAttempt requires config, then order context, then creates the form", async () => {
    setFinixForTests(null);
    expect(await errorCode(() => finixCard.createAttempt({ amountVnd: 1 }))).toBe("INVALID_INPUT");
    setFinixForTests(stubFinix({}));
    expect(await errorCode(() => finixCard.createAttempt({ amountVnd: 1 }))).toBe("INVALID_INPUT");
    setFinixForTests(
      stubFinix({
        createForm: () => ({ id: "checkout_form_ok", link_url: "https://pay.test/ok" }),
      }),
    );
    const r = await finixCard.createAttempt({
      amountVnd: 1,
      orderId: "ord_1",
      attemptId: "att_1",
      origin: "https://shop.test",
    });
    expect(r.ref).toBe("checkout_form_ok");
    expect(r.redirectUrl).toBe("https://pay.test/ok");
  });

  it("confirm polls transfers: PENDING with none, PAID once one SUCCEEDED", async () => {
    setFinixForTests(stubFinix({}));
    expect(await finixCard.confirm({ ref: "checkout_form_c" })).toBe("PENDING");
    setFinixForTests(
      stubFinix({
        transferAttempts: () => ({
          _embedded: { transfer_attempts: [{ transfer_id: "TR_9" }] },
        }),
        getTransfer: () => ({ id: "TR_9", state: "SUCCEEDED", amount: 10 }),
      }),
    );
    expect(await finixCard.confirm({ ref: "checkout_form_c" })).toBe("PAID");
  });

  it("refund by transfer id issues a reversal with the refund-scoped idempotency key", async () => {
    let captured: { id: string; body: Record<string, unknown> } | undefined;
    setFinixForTests(
      stubFinix({
        reverse: (id, body) => {
          captured = { id, body: body as Record<string, unknown> };
          return {};
        },
      }),
    );
    const status = await finixCard.refund({ ref: "TR_1", amountVnd: 7000, refundId: "rfd_1" });
    expect(status).toBe("REFUNDED");
    expect(captured).toEqual({
      id: "TR_1",
      body: { refund_amount: 7000, idempotency_id: "TR_1:refund:rfd_1" },
    });
  });

  it("finixFormTransfer rejects a transferId the form never produced", async () => {
    const f = stubFinix({
      transferAttempts: () => ({
        _embedded: { transfer_attempts: [{ transfer_id: "TR_real" }] },
      }),
      getTransfer: () => ({ id: "TR_stray", state: "SUCCEEDED" }),
    });
    expect(await finixFormTransfer(f, "checkout_form_x", "TR_stray")).toBeNull();
    expect(await finixFormTransfer(f, "checkout_form_x", "TR_real")).toMatchObject({
      id: "TR_stray",
      checkout_form_id: "checkout_form_x",
    });
  });

  it("verifyFinixSignature handles null, malformed, wrong and right signatures", () => {
    const payload = "{}";
    const secret = "s3cret";
    expect(verifyFinixSignature(payload, null, secret)).toBe(false);
    expect(verifyFinixSignature(payload, "garbage", secret)).toBe(false);
    expect(verifyFinixSignature(payload, "timestamp=now,sig=zz", secret)).toBe(false);
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", secret).update(`${t}:${payload}`).digest("hex");
    expect(verifyFinixSignature(payload, `timestamp=${t},sig=${sig}`, secret)).toBe(true);
    const wrong = createHmac("sha256", "other").update(`${t}:${payload}`).digest("hex");
    expect(verifyFinixSignature(payload, `timestamp=${t},sig=${wrong}`, secret)).toBe(false);
  });

  it("processFinixEvent ignores non-transfer, id-less and pending events", () => {
    expect(processFinixEvent(db, { entity: "charge", data: {} })).toBe("IGNORED");
    expect(processFinixEvent(db, { entity: "transfer", data: {} })).toBe("IGNORED");
    expect(
      processFinixEvent(db, { entity: "transfer", data: { id: "TR_x", state: "PENDING" } }),
    ).toBe("IGNORED");
  });
});

describe("payments/refunds guards", () => {
  it("issueReturnRefunds throws NOT_FOUND for a missing request", async () => {
    expect(
      await errorCode(() => db.transaction((tx) => issueReturnRefunds(tx, "rr_missing"))),
    ).toBe("NOT_FOUND");
  });

  it("completeRefund: NOT_FOUND, COMPLETED replay is a no-op, FAILED → INVALID_STATE", async () => {
    expect(await errorCode(() => completeRefund(db, "rfd_missing"))).toBe("NOT_FOUND");

    // File + approve a return on a paid order: real refund rows land COMPLETED.
    const { orderId, legId } = await paidOrder("var_2");
    confirmSellerOrder(db, SELLER_A, legId);
    packSellerOrder(db, SELLER_A, legId);
    shipSellerOrder(db, SELLER_A, legId, { carrier: "ghn", trackingNumber: nextKey() });
    deliverSellerOrder(db, SELLER_A, legId);
    const item = db.select().from(orderItems).where(eq(orderItems.sellerOrderId, legId)).all()[0]!;
    const requestId = requestReturn(
      db,
      CUSTOMER,
      RequestReturnInput.parse({
        sellerOrderId: legId,
        items: [{ orderItemId: item.id, qty: 1, restock: false }],
        reason: "changed my mind",
      }),
    );
    await decideReturn(db, SELLER_A, requestId, "APPROVED");

    const payment = db.select().from(payments).where(eq(payments.orderId, orderId)).get()!;
    const done = db.select().from(refunds).where(eq(refunds.paymentId, payment.id)).all()[0]!;
    expect(done.status).toBe("COMPLETED");
    // Replay: already-COMPLETED returns silently, keeps the row COMPLETED.
    completeRefund(db, done.id);
    expect(db.select().from(refunds).where(eq(refunds.id, done.id)).get()!.status).toBe(
      "COMPLETED",
    );

    // A FAILED refund is terminal — completing it must not resurrect it.
    db.update(refunds).set({ status: "FAILED" }).where(eq(refunds.id, done.id)).run();
    expect(await errorCode(() => completeRefund(db, done.id))).toBe("INVALID_STATE");
  });

  it("markPaymentRefundedIfComplete ignores non-PAID payments", () => {
    db.transaction((tx) => markPaymentRefundedIfComplete(tx, "pay_missing"));
    const pending = db
      .select()
      .from(payments)
      .all()
      .find((p) => p.status === "PENDING");
    if (pending) {
      db.transaction((tx) => markPaymentRefundedIfComplete(tx, pending.id));
      expect(db.select().from(payments).where(eq(payments.id, pending.id)).get()!.status).toBe(
        "PENDING",
      );
    }
  });
});

describe("inventory guards", () => {
  it("consumeReservation/releaseReservation throw NOT_FOUND for missing ids", async () => {
    expect(await errorCode(() => db.transaction((tx) => consumeReservation(tx, "res_none")))).toBe(
      "NOT_FOUND",
    );
    expect(
      await errorCode(() => db.transaction((tx) => releaseReservation(tx, "res_none", "x"))),
    ).toBe("NOT_FOUND");
  });

  it("releaseOrderReservations skips variants that never reserved", () => {
    const before = db
      .select()
      .from(inventory)
      .where(eq(inventory.variantId, "var_1"))
      .get()!.reserved;
    db.transaction((tx) =>
      releaseOrderReservations(tx, `ordkey_${nextKey()}`, ["var_1", "var_9"], "usr_seller", "gap"),
    );
    expect(
      db.select().from(inventory).where(eq(inventory.variantId, "var_1")).get()!.reserved,
    ).toBe(before);
  });

  it("reserveStock falls back to the 15-minute TTL when the setting is missing/garbage", () => {
    db.delete(applicationSettings)
      .where(eq(applicationSettings.key, "reservation_ttl_minutes"))
      .run();
    const a = db.transaction((tx) => reserveStock(tx, "var_6", 1, `gap_${nextKey()}`));
    expect(a.expiresAt - a.createdAt).toBe(15 * 60 * 1000);
    db.insert(applicationSettings)
      .values({ key: "reservation_ttl_minutes", value: '"not-a-number"' })
      .run();
    const b = db.transaction((tx) => reserveStock(tx, "var_6", 1, `gap_${nextKey()}`));
    expect(b.expiresAt - b.createdAt).toBe(15 * 60 * 1000);
    db.update(applicationSettings)
      .set({ value: "15" })
      .where(eq(applicationSettings.key, "reservation_ttl_minutes"))
      .run();
    // Housekeeping: the released reservations stay ACTIVE — free them so later
    // suites seeding this db wouldn't see stale stock (file-private db anyway).
    db.delete(stockReservations).where(eq(stockReservations.id, a.id)).run();
    db.delete(stockReservations).where(eq(stockReservations.id, b.id)).run();
  });
});
