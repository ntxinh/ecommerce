import "server-only";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { products } from "./catalog";
import { users } from "./identity";
import { orderItems } from "./orders";

// One review per purchased item (UNIQUE order_item_id). Nullable so reviews can
// be seeded/held before a purchase record exists; SQLite/Postgres unique
// indexes ignore NULLs, so real purchases still enforce the one-review rule.
export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    orderItemId: text("order_item_id").references(() => orderItems.id, {
      onDelete: "set null",
    }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(), // 1-5, validated by the service
    title: text("title"),
    body: text("body"),
    status: text("status", { enum: ["PUBLISHED", "HIDDEN"] })
      .notNull()
      .default("PUBLISHED"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("reviews_order_item_unique").on(t.orderItemId),
    index("reviews_product_idx").on(t.productId, t.status),
  ],
);
