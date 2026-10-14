import "server-only";

import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import {
  addresses,
  applicationSettings,
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
  stockReservations,
} from "@/server/db/schema";
import {
  consumeReservation,
  type Tx as InventoryTx,
  reserveStock,
} from "@/server/modules/inventory/service";
import { paymentProviderFor } from "@/server/modules/payments/providers";
import {
  type PricedOrder,
  priceOrder,
  type ShippingByShop,
} from "@/server/modules/pricing/price-order";
import { consumeRedemptions } from "@/server/modules/pricing/vouchers";
import { quoteShippingFee } from "@/server/modules/shipping/providers";
import { transitionOrder } from "./transitions";

export type CheckoutInput = {
  cartItemIds: string[];
  addressId: string;
  /** shopId → method name (validated + priced from settings server-side). */
  shippingByShop: Record<string, string>;
  voucherCodes: string[];
  paymentMethod: "COD" | "MOCK_WALLET";
  idempotencyKey: string;
  simulate?: "success" | "failure";
};

export type PlaceOrderResult = {
  orderId: string;
  sellerOrderIds: string[];
  status: string;
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

function settingNumber(db: Pick<DB, "select">, key: string, fallback: number): number {
  const row = db.select().from(applicationSettings).where(eq(applicationSettings.key, key)).get();
  const n = row ? (JSON.parse(row.value) as number) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Reservation idempotency key per order line — shared-order-key variants would
 *  collide on reserveStock's param check, so the variant disambiguates. */
const lineKey = (orderKey: string, variantId: string) => `${orderKey}:${variantId}`;

type PaymentOutcome = { paymentStatus: "PAID" | "FAILED"; orderStatus: "PAID" | "PAYMENT_FAILED" };

/** Post-commit wallet dispatch: create attempt → confirm → persist outcome in a
 *  short second transaction (payment + attempt status, order transition,
 *  reservation consume on success). Outside the checkout tx by design. */
export async function dispatchWalletPayment(
  db: DB,
  orderId: string,
  paymentId: string,
  attemptId: string,
  simulate: string | undefined,
): Promise<PaymentOutcome> {
  const provider = paymentProviderFor("MOCK_WALLET");
  const amountVnd = db
    .select({ amountVnd: payments.amountVnd })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .get()!.amountVnd;
  const { ref } = provider.createAttempt({ amountVnd, simulate });
  const paymentStatus: "PAID" | "FAILED" =
    (await provider.confirm({ ref })) === "PAID" ? "PAID" : "FAILED";

  // A reservation gone non-ACTIVE (swept/expired/released while the payment
  // was pending) means the stock is lost — the order must still commit a
  // terminal-for-now state, never roll back into a stuck PENDING_PAYMENT.
  const outcome = db.transaction((tx): "PAID" | "PAYMENT_FAILED" => {
    const now = Date.now();
    tx.update(paymentAttempts)
      .set({ status: paymentStatus })
      .where(eq(paymentAttempts.id, attemptId))
      .run();
    // A failed retry must never downgrade an already-captured payment —
    // money captured once stays PAID until refunded, or cancelOrder misses it.
    tx.update(payments)
      .set({
        status:
          paymentStatus === "PAID"
            ? "PAID"
            : sql`case when ${payments.status} = 'PAID' then 'PAID' else 'FAILED' end`,
        updatedAt: now,
      })
      .where(eq(payments.id, paymentId))
      .run();
    if (paymentStatus !== "PAID") {
      transitionOrder(tx, orderId, "PAYMENT_FAILED", null);
      return "PAYMENT_FAILED";
    }
    const orderKey = tx
      .select({ k: orders.idempotencyKey })
      .from(orders)
      .where(eq(orders.id, orderId))
      .get()!.k;
    let stockLost: string | null = null;
    for (const line of tx
      .select({ variantId: orderItems.variantId })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .all()) {
      const res = tx
        .select()
        .from(stockReservations)
        .where(eq(stockReservations.idempotencyKey, lineKey(orderKey, line.variantId)))
        .get();
      // CONSUMED is fine (already converted); RELEASED/EXPIRED/missing → stock lost.
      if (!res || res.status === "RELEASED" || res.status === "EXPIRED") {
        stockLost = `${line.variantId} reservation ${res?.id ?? "missing"} (${res?.status ?? "none"})`;
        break;
      }
      if (res.status === "ACTIVE") consumeReservation(tx, res.id);
    }
    if (stockLost) {
      // Payment captured but stock is gone — flag PAYMENT_FAILED so the order
      // is retryable/cancellable instead of wedged (payment stays PAID; cancel
      // refunds it via the adapter).
      transitionOrder(tx, orderId, "PAYMENT_FAILED", null);
      tx.insert(auditLogs)
        .values({
          id: `aud_${ulid()}`,
          actorId: null,
          action: "payment.stock_lost",
          targetType: "order",
          targetId: orderId,
          metaJson: JSON.stringify({ detail: stockLost }),
          createdAt: now,
        })
        .run();
      return "PAYMENT_FAILED";
    }
    transitionOrder(tx, orderId, "PAID", null);
    return "PAID";
  });
  return {
    paymentStatus,
    orderStatus: outcome,
  };
}

/**
 * Atomic checkout (spec §5): idempotency replay → one transaction covering
 * pricing, voucher consume, stock reserve, and all order/payment/idempotency
 * rows → post-commit payment dispatch for the mock wallet.
 */
export async function placeOrder(
  db: DB,
  actor: Actor,
  input: CheckoutInput,
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
      return { orderId, sellerOrderIds, status: live?.s ?? "PENDING_PAYMENT" };
    }
    // FAILED → fall through and retry under the same key.
  }

  const { orderId, sellerOrderIds, paymentId, attemptId, status } = db.transaction((tx) => {
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

    return { orderId, sellerOrderIds, paymentId, attemptId, status };
  });

  if (input.paymentMethod === "MOCK_WALLET") {
    const outcome = await dispatchWalletPayment(db, orderId, paymentId, attemptId, input.simulate);
    return { orderId, sellerOrderIds, status: outcome.orderStatus };
  }
  return { orderId, sellerOrderIds, status };
}
