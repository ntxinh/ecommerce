import { createHmac } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { orders, paymentAttempts, payments } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { addItem, clearCart } from "@/server/modules/cart/service";
import { placeOrder } from "@/server/modules/orders/checkout";
import {
  applyStripeSessionOutcome,
  getStripe,
  handleStripeWebhook,
  sessionOutcome,
  setStripeForTests,
} from "@/server/modules/payments/stripe";

const PATH = "./tests/.tmp/stripe-test.db";
const WHSEC = "whsec_testsecret";
const CUSTOMER: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };
const ADDRESS = "addr_1";

let db: DB;
let keySeq = 0;

function stripeEvent(type: string, object: unknown): Stripe.Event {
  return {
    id: `evt_${++keySeq}`,
    type,
    data: { object },
    object: "event",
  } as Stripe.Event;
}

/** Real Stripe-signature scheme so constructEvent verifies it for real. */
function sign(payload: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

function stripeSession(over: Record<string, unknown> = {}) {
  return {
    id: `cs_test_${++keySeq}`,
    object: "checkout.session",
    status: "complete",
    payment_status: "paid",
    metadata: {},
    ...over,
  };
}

async function stripeOrder(): Promise<{
  orderId: string;
  attemptId: string;
  sessionId: string;
  redirectUrl: string;
}> {
  clearCart(db, CUSTOMER.userId);
  const view = addItem(db, CUSTOMER.userId, "var_1", 1);
  const cartItemId = view.items.find((i) => i.variantId === "var_1")!.cartItemId;
  let captured: Record<string, unknown> | undefined;
  const stub = {
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          captured = params;
          return { id: `cs_test_${++keySeq}`, url: `https://checkout.stripe.com/c/${keySeq}` };
        },
      },
    },
  };
  setStripeForTests(stub as unknown as Stripe);
  const result = await placeOrder(
    db,
    CUSTOMER,
    {
      cartItemIds: [cartItemId],
      addressId: ADDRESS,
      shippingByShop: {},
      voucherCodes: [],
      paymentMethod: "STRIPE",
      idempotencyKey: `stripe_${++keySeq}`,
    },
    { origin: "https://shop.test", locale: "vi" },
  );
  const payment = db.select().from(payments).where(eq(payments.orderId, result.orderId)).get()!;
  const att = db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.paymentId, payment.id))
    .get()!;
  expect(captured).toMatchObject({
    mode: "payment",
    metadata: { orderId: result.orderId, attemptId: att.id },
    success_url: `https://shop.test/vi/checkout/pay/${result.orderId}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `https://shop.test/vi/checkout/pay/${result.orderId}`,
    line_items: [
      {
        price_data: { currency: "vnd", unit_amount: payment.amountVnd },
        quantity: 1,
      },
    ],
  });
  expect(att.providerRef).toMatch(/^cs_test_/);
  return {
    orderId: result.orderId,
    attemptId: att.id,
    sessionId: att.providerRef!,
    redirectUrl: result.redirectUrl!,
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
  setStripeForTests(null);
});

describe("sessionOutcome", () => {
  it("maps session state to the coarse outcome", () => {
    expect(sessionOutcome({ status: "complete", payment_status: "paid" })).toBe("PAID");
    expect(sessionOutcome({ status: "open", payment_status: "unpaid" })).toBe("PENDING");
    expect(sessionOutcome({ status: "expired", payment_status: "unpaid" })).toBe("FAILED");
    expect(sessionOutcome({ status: "complete", payment_status: "unpaid" })).toBe("PENDING");
    expect(sessionOutcome({ status: "complete", payment_status: "no_payment_required" })).toBe(
      "PENDING",
    );
  });
});

describe("placeOrder STRIPE", () => {
  it("creates a Checkout Session, stores providerRef, returns redirectUrl, stays PENDING", async () => {
    const { orderId, redirectUrl, sessionId } = await stripeOrder();
    expect(redirectUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(sessionId).toMatch(/^cs_test_/);
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe(
      "PENDING_PAYMENT",
    );
    expect(db.select().from(payments).where(eq(payments.orderId, orderId)).get()!.status).toBe(
      "PENDING",
    );
  });

  it("rejects STRIPE without a request origin", async () => {
    setStripeForTests({
      checkout: { sessions: { create: async () => ({}) } },
    } as unknown as Stripe);
    const view = addItem(db, CUSTOMER.userId, "var_2", 1);
    const cartItemId = view.items.find((i) => i.variantId === "var_2")!.cartItemId;
    await expect(
      placeOrder(db, CUSTOMER, {
        cartItemIds: [cartItemId],
        addressId: ADDRESS,
        shippingByShop: {},
        voucherCodes: [],
        paymentMethod: "STRIPE",
        idempotencyKey: `stripe_${++keySeq}`,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("sessions.create failure wedges PAYMENT_FAILED (retryable), not stuck PENDING", async () => {
    clearCart(db, CUSTOMER.userId);
    const view = addItem(db, CUSTOMER.userId, "var_3", 1);
    const cartItemId = view.items.find((i) => i.variantId === "var_3")!.cartItemId;
    setStripeForTests({
      checkout: {
        sessions: {
          create: async () => {
            throw new Error("stripe api unreachable");
          },
        },
      },
    } as unknown as Stripe);
    const result = await placeOrder(
      db,
      CUSTOMER,
      {
        cartItemIds: [cartItemId],
        addressId: ADDRESS,
        shippingByShop: {},
        voucherCodes: [],
        paymentMethod: "STRIPE",
        idempotencyKey: `stripe_${++keySeq}`,
      },
      { origin: "https://shop.test", locale: "en" },
    );
    expect(result.status).toBe("PAYMENT_FAILED");
    expect(result.redirectUrl).toBeUndefined();
    expect(db.select().from(orders).where(eq(orders.id, result.orderId)).get()!.status).toBe(
      "PAYMENT_FAILED",
    );
    const payment = db.select().from(payments).where(eq(payments.orderId, result.orderId)).get()!;
    const att = db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.paymentId, payment.id))
      .get()!;
    expect(att.status).toBe("FAILED");
    expect(att.providerRef).toBeNull();
  });

  it("rejects STRIPE when STRIPE_SECRET_KEY is unset", async () => {
    clearCart(db, CUSTOMER.userId);
    const view = addItem(db, CUSTOMER.userId, "var_4", 1);
    const cartItemId = view.items.find((i) => i.variantId === "var_4")!.cartItemId;
    setStripeForTests(null); // forces unconfigured even if env is set
    await expect(
      placeOrder(
        db,
        CUSTOMER,
        {
          cartItemIds: [cartItemId],
          addressId: ADDRESS,
          shippingByShop: {},
          voucherCodes: [],
          paymentMethod: "STRIPE",
          idempotencyKey: `stripe_${++keySeq}`,
        },
        { origin: "https://shop.test", locale: "en" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("stripe webhook", () => {
  it("checkout.session.completed marks attempt+payment PAID and order PAID", async () => {
    const { orderId, attemptId, sessionId } = await stripeOrder();
    setStripeForTests(new Stripe("sk_test_x"));
    process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
    const payload = JSON.stringify(
      stripeEvent("checkout.session.completed", stripeSession({ id: sessionId })),
    );
    const res = handleStripeWebhook(db, payload, sign(payload, WHSEC));
    expect(res.status).toBe(200);
    expect(
      db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)).get()!.status,
    ).toBe("PAID");
    expect(db.select().from(payments).where(eq(payments.orderId, orderId)).get()!.status).toBe(
      "PAID",
    );
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe("PAID");
  });

  it("double delivery of the same event stays exactly-once", async () => {
    const { orderId, attemptId, sessionId } = await stripeOrder();
    setStripeForTests(new Stripe("sk_test_x"));
    process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
    const payload = JSON.stringify(
      stripeEvent("checkout.session.completed", stripeSession({ id: sessionId })),
    );
    const sig = sign(payload, WHSEC);
    handleStripeWebhook(db, payload, sig);
    const second = handleStripeWebhook(db, payload, sig);
    expect(second.status).toBe(200);
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe("PAID");
    expect(
      db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)).get()!.status,
    ).toBe("PAID");
  });

  it("a late expired event never downgrades a PAID attempt/order", async () => {
    const { orderId, attemptId, sessionId } = await stripeOrder();
    setStripeForTests(new Stripe("sk_test_x"));
    process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
    const paid = JSON.stringify(
      stripeEvent("checkout.session.completed", stripeSession({ id: sessionId })),
    );
    handleStripeWebhook(db, paid, sign(paid, WHSEC));
    const expired = JSON.stringify(
      stripeEvent(
        "checkout.session.expired",
        stripeSession({ id: sessionId, status: "expired", payment_status: "unpaid" }),
      ),
    );
    handleStripeWebhook(db, expired, sign(expired, WHSEC));
    expect(
      db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)).get()!.status,
    ).toBe("PAID");
    expect(db.select().from(payments).where(eq(payments.orderId, orderId)).get()!.status).toBe(
      "PAID",
    );
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe("PAID");
  });

  it("checkout.session.expired wedges the order PAYMENT_FAILED", async () => {
    const { orderId, attemptId, sessionId } = await stripeOrder();
    setStripeForTests(new Stripe("sk_test_x"));
    process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
    const payload = JSON.stringify(
      stripeEvent(
        "checkout.session.expired",
        stripeSession({ id: sessionId, status: "expired", payment_status: "unpaid" }),
      ),
    );
    handleStripeWebhook(db, payload, sign(payload, WHSEC));
    expect(
      db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)).get()!.status,
    ).toBe("FAILED");
    expect(db.select().from(payments).where(eq(payments.orderId, orderId)).get()!.status).toBe(
      "FAILED",
    );
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe(
      "PAYMENT_FAILED",
    );
  });

  it("payment_intent.payment_failed is non-terminal — open session can still pay", async () => {
    const { orderId, attemptId, sessionId } = await stripeOrder();
    setStripeForTests(new Stripe("sk_test_x"));
    process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
    const pi = {
      id: "pi_test_1",
      object: "payment_intent",
      metadata: { orderId, attemptId },
    };
    const declined = JSON.stringify(stripeEvent("payment_intent.payment_failed", pi));
    expect(handleStripeWebhook(db, declined, sign(declined, WHSEC)).status).toBe(200);
    // Attempt stays PENDING — the in-session retry can still succeed.
    expect(
      db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)).get()!.status,
    ).toBe("PENDING");
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe(
      "PENDING_PAYMENT",
    );
    // And the later paid event on the same session still lands.
    const paid = JSON.stringify(
      stripeEvent("checkout.session.completed", stripeSession({ id: sessionId })),
    );
    handleStripeWebhook(db, paid, sign(paid, WHSEC));
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe("PAID");
  });

  it("bad signature → 400, missing secret → 404", async () => {
    setStripeForTests(new Stripe("sk_test_x"));
    process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
    const payload = JSON.stringify(stripeEvent("checkout.session.completed", stripeSession()));
    expect(handleStripeWebhook(db, payload, "t=1,v1=bogus").status).toBe(400);
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(handleStripeWebhook(db, payload, sign(payload, WHSEC)).status).toBe(404);
  });

  it("unknown session ref acks 200 without touching anything", async () => {
    setStripeForTests(new Stripe("sk_test_x"));
    process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
    const payload = JSON.stringify(
      stripeEvent("checkout.session.completed", stripeSession({ id: "cs_test_stray" })),
    );
    expect(handleStripeWebhook(db, payload, sign(payload, WHSEC)).status).toBe(200);
  });
});

describe("applyStripeSessionOutcome", () => {
  it("FAILED attempt is dead — a stale PAID doesn't resurrect it", async () => {
    const { orderId, attemptId, sessionId } = await stripeOrder();
    applyStripeSessionOutcome(db, { id: sessionId }, "FAILED");
    applyStripeSessionOutcome(db, { id: sessionId }, "PAID");
    expect(
      db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)).get()!.status,
    ).toBe("FAILED");
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe(
      "PAYMENT_FAILED",
    );
  });
});

describe("getStripe env gating", () => {
  it("returns null without STRIPE_SECRET_KEY", () => {
    delete process.env.STRIPE_SECRET_KEY;
    setStripeForTests(undefined as unknown as Stripe);
    // setStripeForTests(undefined) resets the lazy singleton to uncomputed.
    expect(getStripe()).toBeNull();
  });
});
