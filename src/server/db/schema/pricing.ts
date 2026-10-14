import "server-only";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { products } from "./catalog";
import { users } from "./identity";
import { orders } from "./orders";
import { shops } from "./sellers";

export const vouchers = sqliteTable(
  "vouchers",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    scope: text("scope", { enum: ["PLATFORM", "SHOP"] }).notNull(),
    shopId: text("shop_id").references(() => shops.id),
    kind: text("kind", { enum: ["PERCENT", "FIXED", "SHIPPING"] }).notNull(),
    value: integer("value").notNull(), // PERCENT: bps; FIXED/SHIPPING: VND
    minSpendVnd: integer("min_spend_vnd").notNull().default(0),
    maxDiscountVnd: integer("max_discount_vnd"),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    totalLimit: integer("total_limit"),
    perUserLimit: integer("per_user_limit"),
    usedCount: integer("used_count").notNull().default(0),
    status: text("status", { enum: ["ACTIVE", "DISABLED"] })
      .notNull()
      .default("ACTIVE"),
  },
  (t) => [uniqueIndex("vouchers_code_unique").on(t.code)],
);

export const promotions = sqliteTable(
  "promotions",
  {
    id: text("id").primaryKey(),
    scope: text("scope", { enum: ["PRODUCT", "SHOP", "FLASH"] }).notNull(),
    productId: text("product_id").references(() => products.id),
    shopId: text("shop_id").references(() => shops.id),
    kind: text("kind", { enum: ["PERCENT", "FIXED", "FLASH_PRICE"] }).notNull(),
    value: integer("value").notNull(), // PERCENT: bps; FIXED/FLASH_PRICE: VND
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    status: text("status", { enum: ["ACTIVE", "SCHEDULED", "ENDED", "DISABLED"] })
      .notNull()
      .default("ACTIVE"),
  },
  (t) => [
    index("promotions_shop_idx").on(t.shopId),
    index("promotions_product_idx").on(t.productId),
  ],
);

// One row per voucher consumed at checkout — backs per-user limits and the
// consume-once-per-order guarantee (UNIQUE voucher+order; orderId NULL only for
// rows written ahead of order creation).
export const voucherRedemptions = sqliteTable(
  "voucher_redemptions",
  {
    id: text("id").primaryKey(),
    voucherId: text("voucher_id")
      .notNull()
      .references(() => vouchers.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    orderId: text("order_id").references(() => orders.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("voucher_redemptions_voucher_user_idx").on(t.voucherId, t.userId),
    uniqueIndex("voucher_redemptions_voucher_order_unique").on(t.voucherId, t.orderId),
  ],
);
