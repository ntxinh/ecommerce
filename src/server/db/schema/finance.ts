import "server-only";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sellerOrders } from "./orders";
import { shops } from "./sellers";

export const financialLedgerEntries = sqliteTable(
  "financial_ledger_entries",
  {
    id: text("id").primaryKey(),
    account: text("account", {
      enum: ["CUSTOMER_PAYABLE", "PLATFORM_REVENUE", "SELLER_PAYABLE", "REFUNDS_PAYABLE"],
    }).notNull(),
    shopId: text("shop_id").references(() => shops.id),
    amountVnd: integer("amount_vnd").notNull(), // signed
    refType: text("ref_type").notNull(), // "ORDER" | "REFUND" | "SETTLEMENT"
    refId: text("ref_id").notNull(),
    metaJson: text("meta_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("ledger_account_idx").on(t.account, t.shopId),
    index("ledger_ref_idx").on(t.refType, t.refId),
  ],
);

export const sellerSettlements = sqliteTable(
  "seller_settlements",
  {
    id: text("id").primaryKey(),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    status: text("status", { enum: ["PENDING", "PAID"] })
      .notNull()
      .default("PENDING"),
    grossVnd: integer("gross_vnd").notNull(),
    commissionVnd: integer("commission_vnd").notNull(),
    refundVnd: integer("refund_vnd").notNull().default(0),
    netVnd: integer("net_vnd").notNull(),
    createdAt: integer("created_at").notNull(),
    paidAt: integer("paid_at"),
  },
  (t) => [index("settlements_shop_idx").on(t.shopId, t.status)],
);

export const settlementItems = sqliteTable(
  "settlement_items",
  {
    id: text("id").primaryKey(),
    settlementId: text("settlement_id")
      .notNull()
      .references(() => sellerSettlements.id, { onDelete: "cascade" }),
    sellerOrderId: text("seller_order_id")
      .notNull()
      .references(() => sellerOrders.id),
    grossVnd: integer("gross_vnd").notNull(),
    commissionVnd: integer("commission_vnd").notNull(),
    netVnd: integer("net_vnd").notNull(),
  },
  (t) => [uniqueIndex("settlement_items_so_uidx").on(t.sellerOrderId)],
); // leg settles at most once
