import { createHmac } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { orders, paymentAttempts, payments } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { addItem, clearCart } from "@/server/modules/cart/service";
import { placeOrder } from "@/server/modules/orders/checkout";
import { cancelOrder, retryPayment } from "@/server/modules/orders/service";
import {
  applyFinixTransferOutcome,
  type Finix,
  getFinix,
  handleFinixWebhook,
  setFinixForTests,
  transferOutcome,
} from "@/server/modules/payments/finix";
import { paymentProviderFor } from "@/server/modules/payments/providers";

const PATH = "./tests/.tmp/finix-test.db";
const WHSEC = "whsec_finix_test";
const CUSTOMER: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };
const ADDRESS = "addr_1";

let db: DB;
let keySeq = 0;
let lastCalls: { method: string; url: string; body?: unknown }[] = [];

/** Real Finix-signature scheme: `timestamp=<epoch>, sig=<hex>` (space after
 *  the comma, as Finix emits) → HMAC-SHA256("<ts>:<body>"). */
function sign(payload: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${t}:${payload}`).digest("hex");
  return `timestamp=${t}, sig=${sig}`;
}

function finixTransfer(over: Record<string, unknown> = {}) {
  return {
    id: `TR${++keySeq}`,
    state: "SUCCEEDED",
    amount: 0, // callers must set the real order amount
    currency: "VND",
    ...over,
  };
}

function finixEvent(transfer: Record<string, unknown>) {
  return { entity: "transfer", type: "updated", data: transfer };
}

/** Fetch-based stub: routes the three calls the adapter makes by method+path. */
function stubFinix(handlers: {
  createForm?: (body: Record<string, unknown>) => unknown;
  transferAttempts?: (entityId: string) => unknown;
  getTransfer?: (id: string) => unknown;
  getForm?: (id: string) => unknown;
  reverse?: (id: string, body: Record<string, unknown>) => unknown;
}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    let data: unknown = {};
    if (method === "POST" && path === "/checkout_forms") {
      data = handlers.createForm?.(body) ?? {};
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
  const finix: Finix = {
    fetchFn: fetchFn as unknown as typeof fetch,
    base: "https://finix.test",
    auth: "Basic test",
    merchantId: "MU_test",
  };
  return { finix, calls };
}

async function finixOrder(
  opts: { formId?: string; createFails?: boolean; noCreds?: boolean } = {},
): Promise<{
  orderId: string;
  attemptId: string;
  formId: string;
  amountVnd: number;
  redirectUrl?: string;
}> {
  clearCart(db, CUSTOMER.userId);
  const view = addItem(db, CUSTOMER.userId, "var_1", 1);
  const cartItemId = view.items.find((i) => i.variantId === "var_1")!.cartItemId;
  const formId = opts.formId ?? `checkout_form_${++keySeq}`;
  const { finix, calls } = stubFinix({
    createForm: opts.createFails
      ? () => {
          throw new Error("finix api unreachable");
        }
      : (body) => ({ id: formId, link_url: `https://link.sandbox-payment-form.com/${formId}` }),
  });
  setFinixForTests(opts.noCreds ? null : finix);
  const result = await placeOrder(
    db,
    CUSTOMER,
    {
      cartItemIds: [cartItemId],
      addressId: ADDRESS,
      shippingByShop: {},
      voucherCodes: [],
      paymentMethod: "FINIX",
      idempotencyKey: `finix_${++keySeq}`,
    },
    { origin: "https://shop.test", locale: "vi" },
  );
  lastCalls = calls;
  const payment = db.select().from(payments).where(eq(payments.orderId, result.orderId)).get()!;
  const att = db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.paymentId, payment.id))
    .get()!;
  return {
    orderId: result.orderId,
    attemptId: att.id,
    formId: att.providerRef ?? formId,
    amountVnd: payment.amountVnd,
    redirectUrl: result.redirectUrl,
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
  setFinixForTests(null);
  delete process.env.FINIX_WEBHOOK_SECRET;
});

describe("transferOutcome", () => {
  it("maps transfer state to the coarse outcome", () => {
    expect(transferOutcome("SUCCEEDED")).toBe("PAID");
    expect(transferOutcome("FAILED")).toBe("FAILED");
    expect(transferOutcome("CANCELED")).toBe("FAILED");
    expect(transferOutcome("PENDING")).toBe("PENDING");
    expect(transferOutcome("RETURNED")).toBe("PENDING");
  });
});

describe("placeOrder FINIX", () => {
  it("creates a checkout form, stores providerRef, returns redirectUrl, stays PENDING", async () => {
    const { orderId, formId, amountVnd, redirectUrl } = await finixOrder();
    expect(redirectUrl).toBe(`https://link.sandbox-payment-form.com/${formId}`);
    expect(formId).toMatch(/^checkout_form_/);
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe(
      "PENDING_PAYMENT",
    );
    expect(db.select().from(payments).where(eq(payments.orderId, orderId)).get()!.status).toBe(
      "PENDING",
    );
    // The form binds to the order+attempt and uses VND.
    expect(lastCalls[0].body).toMatchObject({
      merchant_id: "MU_test",
      payment_frequency: "ONE_TIME",
      is_multiple_use: false,
      amount_details: { amount_type: "FIXED", total_amount: amountVnd, currency: "VND" },
      tags: { orderId, attemptId: expect.any(String) },
    });
  });

  it("rejects FINIX without a request origin", async () => {
    const { finix } = stubFinix({});
    setFinixForTests(finix);
    clearCart(db, CUSTOMER.userId);
    const view = addItem(db, CUSTOMER.userId, "var_2", 1);
    const cartItemId = view.items.find((i) => i.variantId === "var_2")!.cartItemId;
    await expect(
      placeOrder(db, CUSTOMER, {
        cartItemIds: [cartItemId],
        addressId: ADDRESS,
        shippingByShop: {},
        voucherCodes: [],
        paymentMethod: "FINIX",
        idempotencyKey: `finix_${++keySeq}`,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("form-create failure wedges PAYMENT_FAILED (retryable), not stuck PENDING", async () => {
    const { orderId } = await finixOrder({ createFails: true });
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe(
      "PAYMENT_FAILED",
    );
    const payment = db.select().from(payments).where(eq(payments.orderId, orderId)).get()!;
    const att = db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.paymentId, payment.id))
      .get()!;
    expect(att.status).toBe("FAILED");
    expect(att.providerRef).toBeNull();
  });

  it("rejects FINIX when creds are unset", async () => {
    clearCart(db, CUSTOMER.userId);
    const view = addItem(db, CUSTOMER.userId, "var_4", 1);
    const cartItemId = view.items.find((i) => i.variantId === "var_4")!.cartItemId;
    setFinixForTests(null); // forces unconfigured even if env is set
    await expect(
      placeOrder(
        db,
        CUSTOMER,
        {
          cartItemIds: [cartItemId],
          addressId: ADDRESS,
          shippingByShop: {},
          voucherCodes: [],
          paymentMethod: "FINIX",
          idempotencyKey: `finix_${++keySeq}`,
        },
        { origin: "https://shop.test", locale: "en" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("money path", () => {
  it("cancel refunds via transfers/{id}/reversals against the settled transfer", async () => {
    const { orderId, formId, amountVnd } = await finixOrder();
    const transfer = finixTransfer({ amount: amountVnd, checkout_form_id: formId });
    applyFinixTransferOutcome(db, transfer, "PAID");
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe("PAID");
    // settledPaymentRef now returns the settled transfer id (external_ref) —
    // the reversal goes straight to /transfers/{id} with a stable idempotency key.
    const { finix, calls } = stubFinix({});
    setFinixForTests(finix);

    await cancelOrder(db, CUSTOMER, orderId);
    const reversal = calls.find((c) => c.method === "POST" && c.url.includes("/reversals"));
    expect(reversal?.url).toContain(`/transfers/${transfer.id}/reversals`);
    expect(reversal?.body).toMatchObject({
      refund_amount: amountVnd,
      // Keyed per refunds row (rfd_…), so two same-amount refunds on one
      // transfer can't collapse into a single Finix reversal.
      idempotency_id: expect.stringContaining(`:refund:rfd_`),
    });
    expect(db.select().from(payments).where(eq(payments.orderId, orderId)).get()!.status).toBe(
      "REFUNDED",
    );
  });

  it("refund by form id picks the SUCCEEDED transfer, not the latest attempt", async () => {
    const failedTid = `TR${++keySeq}_fail`;
    const okTid = `TR${++keySeq}_ok`;
    const { finix, calls } = stubFinix({
      // Declined retry AFTER the success — last-in-list must not win.
      transferAttempts: () => ({
        _embedded: { transfer_attempts: [{ transfer_id: okTid }, { transfer_id: failedTid }] },
      }),
      getTransfer: (id) =>
        id === okTid
          ? { id: okTid, state: "SUCCEEDED", amount: 50000 }
          : { id: failedTid, state: "FAILED", amount: 50000 },
    });
    setFinixForTests(finix);
    const status = await paymentProviderFor("FINIX").refund({
      ref: "checkout_form_cf1",
      amountVnd: 50000,
    });
    expect(status).toBe("REFUNDED");
    const reversal = calls.find((c) => c.url.includes("/reversals"));
    expect(reversal?.url).toContain(`/transfers/${okTid}/reversals`);
  });

  it("refund throws when no succeeded transfer exists — no phantom REFUNDED", async () => {
    const { finix } = stubFinix({
      transferAttempts: () => ({
        _embedded: { transfer_attempts: [{ transfer_id: "TR_declined" }] },
      }),
      getTransfer: () => ({ id: "TR_declined", state: "FAILED", amount: 1 }),
    });
    setFinixForTests(finix);
    await expect(
      paymentProviderFor("FINIX").refund({ ref: "checkout_form_cf2", amountVnd: 1 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("two equal-amount refunds on one transfer mint distinct idempotency keys", async () => {
    const { finix, calls } = stubFinix({});
    setFinixForTests(finix);
    const finixCard = paymentProviderFor("FINIX");
    await finixCard.refund({ ref: "TR_settled", amountVnd: 50000, refundId: "rfd_a" });
    await finixCard.refund({ ref: "TR_settled", amountVnd: 50000, refundId: "rfd_b" });
    const keys = calls
      .filter((c) => c.method === "POST" && c.url.includes("/reversals"))
      .map((c) =>
        c.body && typeof c.body === "object" && "idempotency_id" in c.body
          ? c.body.idempotency_id
          : undefined,
      );
    expect(keys).toEqual(["TR_settled:refund:rfd_a", "TR_settled:refund:rfd_b"]);
  });

  it("settle records externalRef so webhook replays resolve O(1)", async () => {
    const { attemptId, formId, amountVnd } = await finixOrder();
    const transfer = finixTransfer({ amount: amountVnd, checkout_form_id: formId });
    applyFinixTransferOutcome(db, transfer, "PAID");
    const att = db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)).get()!;
    expect(att.externalRef).toBe(transfer.id);
    // A second event for the same transfer resolves by externalRef and no-ops.
    const out = applyFinixTransferOutcome(
      db,
      { id: transfer.id, state: "SUCCEEDED", amount: amountVnd },
      "PAID",
    );
    expect(out.attemptId).toBe(attemptId);
    expect(out.applied).toBe(false);
  });

  it("a transfer whose amount doesn't match the payment is acked, not applied", async () => {
    const { orderId, formId } = await finixOrder();
    const res = applyFinixTransferOutcome(
      db,
      finixTransfer({ amount: 1, checkout_form_id: formId }),
      "PAID",
    );
    expect(res.applied).toBe(false);
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe(
      "PENDING_PAYMENT",
    );
  });

  it("retry refuses a still-live PENDING_PAYMENT order — no second form", async () => {
    const { orderId } = await finixOrder();
    await expect(retryPayment(db, CUSTOMER, orderId)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("retry with creds absent re-wedges PAYMENT_FAILED — order stays retryable", async () => {
    const { orderId } = await finixOrder();
    db.update(orders).set({ status: "PAYMENT_FAILED" }).where(eq(orders.id, orderId)).run();
    setFinixForTests(null);
    await expect(
      retryPayment(db, CUSTOMER, orderId, undefined, { origin: "https://shop.test" }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe(
      "PAYMENT_FAILED",
    );
    // Creds restored → retry mints a fresh form and redirects.
    const { finix } = stubFinix({
      createForm: () => ({
        id: `checkout_form_${++keySeq}`,
        link_url: "https://link.sandbox-payment-form.com/r",
      }),
    });
    setFinixForTests(finix);
    const retry = await retryPayment(db, CUSTOMER, orderId, undefined, {
      origin: "https://shop.test",
    });
    expect(retry.status).toBe("PENDING_PAYMENT");
    expect(retry.redirectUrl).toBe("https://link.sandbox-payment-form.com/r");
  });
});

describe("finix webhook", () => {
  function configured() {
    const { finix } = stubFinix({});
    setFinixForTests(finix);
    process.env.FINIX_WEBHOOK_SECRET = WHSEC;
  }

  it("transfer updated+SUCCEEDED marks attempt+payment PAID and order PAID", async () => {
    const { orderId, attemptId, formId, amountVnd } = await finixOrder();
    configured();
    const payload = JSON.stringify(
      finixEvent(finixTransfer({ amount: amountVnd, checkout_form_id: formId })),
    );
    const res = handleFinixWebhook(db, payload, sign(payload, WHSEC));
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
    const { orderId, attemptId, formId, amountVnd } = await finixOrder();
    configured();
    const payload = JSON.stringify(
      finixEvent(finixTransfer({ amount: amountVnd, checkout_form_id: formId })),
    );
    const sig = sign(payload, WHSEC);
    handleFinixWebhook(db, payload, sig);
    const second = handleFinixWebhook(db, payload, sig);
    expect(second.status).toBe(200);
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe("PAID");
    expect(
      db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)).get()!.status,
    ).toBe("PAID");
  });

  it("a late FAILED transfer never downgrades a PAID attempt/order", async () => {
    const { orderId, attemptId, formId, amountVnd } = await finixOrder();
    configured();
    const paid = JSON.stringify(
      finixEvent(finixTransfer({ amount: amountVnd, checkout_form_id: formId })),
    );
    handleFinixWebhook(db, paid, sign(paid, WHSEC));
    const failed = JSON.stringify(
      finixEvent(finixTransfer({ amount: amountVnd, checkout_form_id: formId, state: "FAILED" })),
    );
    handleFinixWebhook(db, failed, sign(failed, WHSEC));
    expect(
      db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)).get()!.status,
    ).toBe("PAID");
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe("PAID");
  });

  it("transfer FAILED wedges the order PAYMENT_FAILED", async () => {
    const { orderId, attemptId, formId, amountVnd } = await finixOrder();
    configured();
    const payload = JSON.stringify(
      finixEvent(finixTransfer({ amount: amountVnd, checkout_form_id: formId, state: "FAILED" })),
    );
    handleFinixWebhook(db, payload, sign(payload, WHSEC));
    expect(
      db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)).get()!.status,
    ).toBe("FAILED");
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe(
      "PAYMENT_FAILED",
    );
  });

  it("tags.attemptId resolves the attempt when checkout_form_id is absent", async () => {
    const { orderId, attemptId, amountVnd } = await finixOrder();
    configured();
    const payload = JSON.stringify(
      finixEvent(finixTransfer({ amount: amountVnd, tags: { attemptId } })),
    );
    handleFinixWebhook(db, payload, sign(payload, WHSEC));
    expect(db.select().from(orders).where(eq(orders.id, orderId)).get()!.status).toBe("PAID");
  });

  it("bad signature → 400, missing secret → 404", async () => {
    configured();
    const payload = JSON.stringify(finixEvent(finixTransfer()));
    expect(handleFinixWebhook(db, payload, "timestamp=1,sig=bogus").status).toBe(400);
    delete process.env.FINIX_WEBHOOK_SECRET;
    expect(handleFinixWebhook(db, payload, sign(payload, WHSEC)).status).toBe(404);
  });

  it("unknown transfer acks 200 without touching anything", async () => {
    configured();
    const payload = JSON.stringify(
      finixEvent(finixTransfer({ amount: 999, checkout_form_id: "checkout_form_stray" })),
    );
    expect(handleFinixWebhook(db, payload, sign(payload, WHSEC)).status).toBe(200);
  });
});

describe("getFinix env gating", () => {
  it("returns null without creds", () => {
    delete process.env.FINIX_USERNAME;
    delete process.env.FINIX_PASSWORD;
    delete process.env.FINIX_MERCHANT_ID;
    setFinixForTests(undefined as unknown as Finix);
    // setFinixForTests(undefined) resets the lazy singleton to uncomputed.
    expect(getFinix()).toBeNull();
  });
});
