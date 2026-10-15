import "server-only";

import { createHash } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import {
  addresses,
  auditLogs,
  cartItems,
  carts,
  idempotencyRecords,
  orderItems,
  orderPricingBreakdowns,
  orders,
  paymentAttempts,
  payments,
  products,
  productVariants,
  sellerOrders,
} from "@/server/db/schema";
import { settingNumber } from "@/server/db/settings";
import {
  consumeReservation,
  reserveStock,
  sweepExpiredReservations,
} from "@/server/modules/inventory/service";
import { notify } from "@/server/modules/notifications/service";
import { finixCheckoutLink, getFinix } from "@/server/modules/payments/finix";
import { paymentProviderFor } from "@/server/modules/payments/providers";
import { getStripe } from "@/server/modules/payments/stripe";
import {
  type PricedOrder,
  priceOrder,
  type ShippingByShop,
} from "@/server/modules/pricing/price-order";
import { consumeRedemptions } from "@/server/modules/pricing/vouchers";
import { quoteShippingFee } from "@/server/modules/shipping/providers";
import { trace } from "@/server/observability/trace";
import { type PaymentOutcome, persistPaymentOutcome } from "./outcome";
import type { OrderStatus } from "./transitions";

export type CheckoutInput = {
  cartItemIds: string[];
  addressId: string;
  /** shopId → method name (validated + priced from settings server-side). */
  shippingByShop: Record<string, string>;
  voucherCodes: string[];
  paymentMethod: "COD" | "MOCK_WALLET" | "MOCK_BANK" | "STRIPE" | "FINIX";
  idempotencyKey: string;
  simulate?: "success" | "failure";
};

export type PlaceOrderResult = {
  orderId: string;
  sellerOrderIds: string[];
  status: string;
  /** STRIPE only — browser must follow to the hosted Checkout page. */
  redirectUrl?: string;
};

/** Stable hash over the semantically relevant payload (sorted so array order
 *  doesn't mint a different request for the same purchase). */
function requestHash(input: CheckoutInput): string {
  const canonical = {
    cartItemIds: [...input.cartItemIds].sort(),
    addressId: input.addressId,
    shippingByShop: Object.fromEntries(
      Object.entries(input.shippingByShop).sort(([a], [b]) => a.localeCompare(b)),
    ),
    voucherCodes: [...input.voucherCodes].sort(),
    paymentMethod: input.paymentMethod,
    simulate: input.simulate ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Loads cart item rows, asserting every requested id exists and belongs to the
 *  actor's cart (NOT_FOUND / FORBIDDEN otherwise). */
function ownedCartLines(db: Pick<DB, "select">, userId: string, cartItemIds: string[]) {
  if (new Set(cartItemIds).size !== cartItemIds.length) {
    throw new AuthError("INVALID_INPUT", 400, "duplicate cartItemIds");
  }
  const rows = db
    .select({
      id: cartItems.id,
      variantId: cartItems.variantId,
      qty: cartItems.qty,
      ownerId: carts.userId,
      shopId: products.shopId,
    })
    .from(cartItems)
    .innerJoin(carts, eq(carts.id, cartItems.cartId))
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(cartItems.id, cartItemIds))
    .all();
  for (const row of rows) {
    if (row.ownerId !== userId) throw new AuthError("FORBIDDEN", 403, "cart item not yours");
  }
  if (rows.length !== cartItemIds.length) {
    throw new AuthError("NOT_FOUND", 404, "one or more cart items not found");
  }
  return rows;
}

/** Reservation idempotency key per order line — shared-order-key variants would
 *  collide on reserveStock's param check, so the variant disambiguates. */
const lineKey = (orderKey: string, variantId: string) => `${orderKey}:${variantId}`;

/** Post-commit mock dispatch: create attempt → confirm → persist outcome in a
 *  short second transaction (payment + attempt status, order transition,
 *  reservation consume on success). Outside the checkout tx by design. */
export async function dispatchMockPayment(
  db: DB,
  method: "MOCK_WALLET" | "MOCK_BANK",
  _orderId: string,
  paymentId: string,
  attemptId: string,
  simulate: string | undefined,
): Promise<PaymentOutcome> {
  const provider = paymentProviderFor(method);
  const amountVnd = db
    .select({ amountVnd: payments.amountVnd })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .get()!.amountVnd;
  const { ref } = await provider.createAttempt({ amountVnd, simulate });
  const paymentStatus = (await provider.confirm({ ref })) === "PAID" ? "PAID" : "FAILED";

  // A reservation gone non-ACTIVE (swept/expired/released while the payment
  // was pending) means the stock is lost — the order must still commit a
  // terminal-for-now state, never roll back into a stuck PENDING_PAYMENT.
  return persistPaymentOutcome(db, paymentId, paymentStatus, attemptId);
}

/** Post-commit hosted-checkout dispatch (Stripe session / Finix form): creates
 *  the provider checkout for the attempt and records `providerRef` — the
 *  webhook/return-page dedupe key. The attempt stays PENDING until the
 *  provider settles it. A create failure can't roll back the committed order —
 *  wedge it PAYMENT_FAILED (attempt FAILED + audit) so the pay page offers a
 *  retry instead of a dead order. */
export async function dispatchHostedPayment(
  db: DB,
  method: "STRIPE" | "FINIX",
  orderId: string,
  paymentId: string,
  attemptId: string,
  amountVnd: number,
  origin: string,
  locale: string,
): Promise<{ redirectUrl?: string; orderStatus: OrderStatus }> {
  try {
    const { ref, redirectUrl } = await paymentProviderFor(method).createAttempt({
      amountVnd,
      orderId,
      attemptId,
      origin,
      locale,
    });
    db.update(paymentAttempts)
      .set({ providerRef: ref })
      .where(eq(paymentAttempts.id, attemptId))
      .run();
    return { redirectUrl, orderStatus: "PENDING_PAYMENT" };
  } catch (e) {
    if (e instanceof AuthError) {
      // Config/usage errors surface to the caller as validation failures.
      throw e;
    }
    const { orderStatus } = persistPaymentOutcome(db, paymentId, "FAILED", attemptId);
    db.insert(auditLogs)
      .values({
        id: `aud_${ulid()}`,
        actorId: null,
        action:
          method === "STRIPE" ? "payment.stripe_session_failed" : "payment.finix_checkout_failed",
        targetType: "order",
        targetId: orderId,
        metaJson: JSON.stringify({ detail: e instanceof Error ? e.message : String(e) }),
        createdAt: Date.now(),
      })
      .run();
    // A concurrently-cancelled order reports CANCELLED (persistPaymentOutcome
    // leaves forward states alone), not a phantom retryable wedge.
    return { orderStatus };
  }
}

/** Resolves the absolute request origin for hosted-checkout return URLs. */
export function requestOrigin(headers: Headers): string {
  return (
    headers.get("origin") ??
    (headers.get("host") ? `https://${headers.get("host")}` : "http://localhost:3000")
  );
}

/**
 * Atomic checkout (spec §5): idempotency replay → one transaction covering
 * pricing, voucher consume, stock reserve, and all order/payment/idempotency
 * rows → post-commit payment dispatch (mock confirm, or a Stripe Checkout
 * Session the browser is redirected to).
 */
async function placeOrderImpl(
  db: DB,
  actor: Actor,
  input: CheckoutInput,
  opts: { origin?: string; locale?: string } = {},
): Promise<PlaceOrderResult> {
  if (!input.idempotencyKey) {
    throw new AuthError("INVALID_INPUT", 400, "idempotency key required");
  }
  const hash = requestHash(input);
  const prior = db
    .select()
    .from(idempotencyRecords)
    .where(eq(idempotencyRecords.key, input.idempotencyKey))
    .get();
  if (prior) {
    if (prior.userId !== actor.userId || prior.requestHash !== hash) {
      throw new AuthError(
        "IDEMPOTENCY_CONFLICT",
        409,
        "idempotency key reused with different request",
      );
    }
    if (prior.status === "IN_PROGRESS") {
      throw new AuthError("IDEMPOTENCY_CONFLICT", 409, "request in progress");
    }
    if (prior.status === "COMPLETED") {
      const { orderId, sellerOrderIds } = JSON.parse(
        prior.responseJson ?? "{}",
      ) as PlaceOrderResult;
      const live = db.select({ s: orders.status }).from(orders).where(eq(orders.id, orderId)).get();
      const status = live?.s ?? "PENDING_PAYMENT";
      // Replay of a still-pending hosted-checkout order must re-issue the
      // redirect link — the original redirectUrl was never persisted.
      if (
        status === "PENDING_PAYMENT" &&
        (input.paymentMethod === "STRIPE" || input.paymentMethod === "FINIX")
      ) {
        const paymentId = db
          .select({ id: payments.id })
          .from(payments)
          .where(eq(payments.orderId, orderId))
          .get()?.id;
        const ref =
          paymentId &&
          db
            .select({ ref: paymentAttempts.providerRef })
            .from(paymentAttempts)
            .where(eq(paymentAttempts.paymentId, paymentId))
            .orderBy(desc(paymentAttempts.id))
            .all()
            .find((a) => a.ref)?.ref;
        const finix = input.paymentMethod === "FINIX" ? getFinix() : null;
        const link =
          ref &&
          (input.paymentMethod === "STRIPE"
            ? ((await getStripe()
                ?.checkout.sessions.retrieve(ref)
                .then((s) => s.url)
                .catch(() => null)) ?? null)
            : finix
              ? await finixCheckoutLink(finix, ref)
              : null);
        if (link) {
          return { orderId, sellerOrderIds, status, redirectUrl: link };
        }
      }
      return { orderId, sellerOrderIds, status };
    }
    // FAILED → fall through and retry under the same key.
  }
  if (input.paymentMethod === "STRIPE" || input.paymentMethod === "FINIX") {
    if (!opts.origin) {
      throw new AuthError(
        "INVALID_INPUT",
        400,
        `request origin required for ${input.paymentMethod.toLowerCase()} checkout`,
      );
    }
    // Server-side gate — the form hides hosted methods without keys, but API
    // callers only meet this check.
    const configured =
      input.paymentMethod === "STRIPE" ? Boolean(getStripe()) : Boolean(getFinix());
    if (!configured) {
      throw new AuthError(
        "INVALID_INPUT",
        422,
        `${input.paymentMethod.toLowerCase()} is not configured`,
      );
    }
  }

  // Expire stale reservations before repricing/reserving — the sweep is
  // on-read (no background timers) and must run outside the order tx.
  sweepExpiredReservations(db);

  const { orderId, sellerOrderIds, paymentId, attemptId, status, amountVnd } = db.transaction(
    (tx) => {
      const now = Date.now();
      const lines = ownedCartLines(tx, actor.userId, input.cartItemIds);

      const address = tx.select().from(addresses).where(eq(addresses.id, input.addressId)).get();
      if (!address) throw new AuthError("NOT_FOUND", 404, "address not found");
      if (address.userId !== actor.userId) throw new AuthError("FORBIDDEN", 403);

      // Server-priced shipping: only shops actually in the order, validated method.
      const shopIds = new Set(lines.map((l) => l.shopId));
      for (const shopId of Object.keys(input.shippingByShop)) {
        if (!shopIds.has(shopId)) {
          throw new AuthError("INVALID_INPUT", 422, `shipping method for unrelated shop ${shopId}`);
        }
      }
      const shippingByShop: ShippingByShop = {};
      for (const shopId of shopIds) {
        const method = input.shippingByShop[shopId] ?? "standard";
        shippingByShop[shopId] = { method, feeVnd: quoteShippingFee(tx, method) };
      }

      const priced: PricedOrder = priceOrder(
        tx,
        actor.userId,
        lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
        input.voucherCodes,
        shippingByShop,
        now,
      );

      const grossMerch = priced.lines.reduce((s, l) => s + l.unitPriceVnd * l.qty, 0);
      const grossShipping = priced.perShop.reduce((s, g) => s + g.shippingFeeVnd, 0);
      const discount = -priced.breakdown
        .filter((b) => b.amountVnd < 0)
        .reduce((s, b) => s + b.amountVnd, 0);

      // Orders row first — consumeRedemptions keys voucher_redemptions on it.
      const orderId = `ord_${ulid()}`;
      const status = input.paymentMethod === "COD" ? "PROCESSING" : "PENDING_PAYMENT";
      tx.insert(orders)
        .values({
          id: orderId,
          userId: actor.userId,
          addressSnapshotJson: JSON.stringify(address),
          status,
          totalVnd: priced.grandTotalVnd,
          subtotalVnd: grossMerch,
          shippingVnd: grossShipping,
          discountVnd: discount,
          idempotencyKey: input.idempotencyKey,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      try {
        consumeRedemptions(tx, actor.userId, priced.appliedVouchers, orderId);
      } catch (e) {
        if (e instanceof AuthError && e.code === "VOUCHER_INVALID") {
          // Contract maps voucher failures to 422.
          throw new AuthError("VOUCHER_INVALID", 422, e.message);
        }
        throw e;
      }

      const commissionRateBps = settingNumber(tx, "commission_rate_bps", 0);
      const sellerOrderIds: string[] = [];
      for (const group of priced.perShop) {
        const soId = `so_${ulid()}`;
        sellerOrderIds.push(soId);
        tx.insert(sellerOrders)
          .values({
            id: soId,
            orderId,
            shopId: group.shopId,
            status: "NEW",
            subtotalVnd: group.subtotalVnd - group.shopDiscountVnd,
            shippingVnd: group.shippingFeeVnd - group.shippingDiscountVnd,
            commissionRateBps,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        for (const line of group.items) {
          tx.insert(orderItems)
            .values({
              id: `oi_${ulid()}`,
              sellerOrderId: soId,
              orderId,
              variantId: line.variantId,
              productId: line.productId,
              nameSnapshot: line.name,
              skuSnapshot: line.sku,
              attrsJson: JSON.stringify(line.attrs),
              unitPriceVnd: line.unitPriceVnd,
              qty: line.qty,
              itemDiscountVnd: line.itemDiscountVnd,
              voucherDiscountVnd: line.voucherDiscountVnd,
              lineTotalVnd: line.lineTotalVnd,
            })
            .run();
        }
      }

      for (const b of priced.breakdown) {
        tx.insert(orderPricingBreakdowns)
          .values({
            id: `opb_${ulid()}`,
            orderId,
            lineType: b.lineType,
            amountVnd: b.amountVnd,
            metaJson: JSON.stringify(b.meta),
          })
          .run();
      }

      for (const line of priced.lines) {
        const reservation = reserveStock(
          tx,
          line.variantId,
          line.qty,
          lineKey(input.idempotencyKey, line.variantId),
        );
        if (input.paymentMethod === "COD") {
          // COD stock converts reserved → sold immediately; cancel restores on_hand.
          consumeReservation(tx, reservation.id);
        }
      }

      const paymentId = `pay_${ulid()}`;
      tx.insert(payments)
        .values({
          id: paymentId,
          orderId,
          method: input.paymentMethod,
          status: "PENDING",
          amountVnd: priced.grandTotalVnd,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const attemptId = `att_${ulid()}`;
      tx.insert(paymentAttempts)
        .values({
          id: attemptId,
          paymentId,
          status: "PENDING",
          simulate: input.simulate ?? null,
          idempotencyKey: `${input.idempotencyKey}:pay:1`,
          createdAt: now,
        })
        .run();

      tx.insert(auditLogs)
        .values({
          id: `aud_${ulid()}`,
          actorId: actor.userId,
          action: "order.created",
          targetType: "order",
          targetId: orderId,
          metaJson: JSON.stringify({ paymentMethod: input.paymentMethod, sellerOrderIds }),
          createdAt: now,
        })
        .run();

      notify(tx, actor.userId, "order", {
        title: "order.created",
        body: { orderId },
        href: `/account/orders/${orderId}`,
      });

      // Record inserted COMPLETED inside the tx: SQLite serializes writers, so no
      // observable IN_PROGRESS window; a failed tx leaves no record → retry-allowed.
      tx.insert(idempotencyRecords)
        .values({
          key: input.idempotencyKey,
          userId: actor.userId,
          requestHash: hash,
          status: "COMPLETED",
          responseJson: JSON.stringify({ orderId, sellerOrderIds }),
          createdAt: now,
        })
        .run();

      return {
        orderId,
        sellerOrderIds,
        paymentId,
        attemptId,
        status,
        amountVnd: priced.grandTotalVnd,
      };
    },
  );

  if (input.paymentMethod === "STRIPE" || input.paymentMethod === "FINIX") {
    const { redirectUrl, orderStatus } = await dispatchHostedPayment(
      db,
      input.paymentMethod,
      orderId,
      paymentId,
      attemptId,
      amountVnd,
      opts.origin!,
      opts.locale ?? "en",
    );
    return { orderId, sellerOrderIds, status: orderStatus, redirectUrl };
  }
  if (input.paymentMethod !== "COD") {
    const outcome = await dispatchMockPayment(
      db,
      input.paymentMethod,
      orderId,
      paymentId,
      attemptId,
      input.simulate,
    );
    return { orderId, sellerOrderIds, status: outcome.orderStatus };
  }
  return { orderId, sellerOrderIds, status };
}

export const placeOrder = trace("orders.placeOrder", placeOrderImpl);
