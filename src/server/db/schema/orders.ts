import "server-only";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { products, productVariants } from "./catalog";
import { users } from "./identity";
import { shops } from "./sellers";

export const carts = sqliteTable(
  "carts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("carts_user_unique").on(t.userId)],
);

export const cartItems = sqliteTable(
  "cart_items",
  {
    id: text("id").primaryKey(),
    cartId: text("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id),
    qty: integer("qty").notNull(),
  },
  (t) => [uniqueIndex("cart_items_unique").on(t.cartId, t.variantId)],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    addressSnapshotJson: text("address_snapshot_json").notNull(),
    status: text("status", {
      enum: [
        "PENDING_PAYMENT",
        "PAID",
        "PROCESSING",
        "SHIPPED",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
        "PAYMENT_FAILED",
        "PARTIALLY_REFUNDED",
        "REFUNDED",
      ],
    })
      .notNull()
      .default("PENDING_PAYMENT"),
    totalVnd: integer("total_vnd").notNull(),
    subtotalVnd: integer("subtotal_vnd").notNull(),
    shippingVnd: integer("shipping_vnd").notNull().default(0),
    discountVnd: integer("discount_vnd").notNull().default(0),
    currency: text("currency").notNull().default("VND"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("orders_idempotency_key_unique").on(t.idempotencyKey),
    index("orders_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export const sellerOrders = sqliteTable(
  "seller_orders",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    status: text("status", {
      enum: [
        "NEW",
        "CONFIRMED",
        "PACKING",
        "READY_TO_SHIP",
        "SHIPPED",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
        "RETURN_REQUESTED",
        "RETURNED",
      ],
    })
      .notNull()
      .default("NEW"),
    subtotalVnd: integer("subtotal_vnd").notNull(),
    shippingVnd: integer("shipping_vnd").notNull().default(0),
    commissionRateBps: integer("commission_rate_bps").notNull(),
    trackingNumber: text("tracking_number"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("seller_orders_shop_status_idx").on(t.shopId, t.status),
    index("seller_orders_order_idx").on(t.orderId),
  ],
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    sellerOrderId: text("seller_order_id")
      .notNull()
      .references(() => sellerOrders.id),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    nameSnapshot: text("name_snapshot").notNull(),
    skuSnapshot: text("sku_snapshot").notNull(),
    attrsJson: text("attrs_json").notNull().default("{}"),
    unitPriceVnd: integer("unit_price_vnd").notNull(),
    qty: integer("qty").notNull(),
    itemDiscountVnd: integer("item_discount_vnd").notNull().default(0),
    voucherDiscountVnd: integer("voucher_discount_vnd").notNull().default(0),
    lineTotalVnd: integer("line_total_vnd").notNull(),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    index("order_items_product_idx").on(t.productId),
  ],
);

export const orderPricingBreakdowns = sqliteTable(
  "order_pricing_breakdowns",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    lineType: text("line_type").notNull(),
    amountVnd: integer("amount_vnd").notNull(),
    metaJson: text("meta_json").notNull().default("{}"),
  },
  (t) => [index("order_pricing_order_idx").on(t.orderId)],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    method: text("method", { enum: ["COD", "MOCK_WALLET", "MOCK_BANK"] }).notNull(),
    status: text("status", {
      enum: ["PENDING", "AUTHORIZED", "PAID", "FAILED", "REFUNDED", "EXPIRED"],
    })
      .notNull()
      .default("PENDING"),
    amountVnd: integer("amount_vnd").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("payments_order_unique").on(t.orderId)],
);

export const paymentAttempts = sqliteTable(
  "payment_attempts",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    status: text("status", {
      enum: ["PENDING", "AUTHORIZED", "PAID", "FAILED", "REFUNDED", "EXPIRED"],
    }).notNull(),
    simulate: text("simulate"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("payment_attempts_payment_idx").on(t.paymentId)],
);

export const shipments = sqliteTable(
  "shipments",
  {
    id: text("id").primaryKey(),
    sellerOrderId: text("seller_order_id")
      .notNull()
      .references(() => sellerOrders.id),
    provider: text("provider").notNull(),
    status: text("status", {
      enum: ["CREATED", "PICKED", "IN_TRANSIT", "DELIVERED", "FAILED", "RETURNED"],
    })
      .notNull()
      .default("CREATED"),
    trackingNumber: text("tracking_number").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("shipments_seller_order_unique").on(t.sellerOrderId),
    uniqueIndex("shipments_tracking_unique").on(t.trackingNumber),
  ],
);

export const trackingEvents = sqliteTable(
  "tracking_events",
  {
    id: text("id").primaryKey(),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    detail: text("detail").notNull().default(""),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("tracking_events_shipment_idx").on(t.shipmentId)],
);

export const idempotencyRecords = sqliteTable("idempotency_records", {
  key: text("key").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  requestHash: text("request_hash").notNull(),
  status: text("status", { enum: ["IN_PROGRESS", "COMPLETED", "FAILED"] })
    .notNull()
    .default("IN_PROGRESS"),
  responseJson: text("response_json"),
  createdAt: integer("created_at").notNull(),
});

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metaJson: text("meta_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("audit_logs_target_idx").on(t.targetType, t.targetId)],
);
