import "server-only";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./identity";

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "account"|"seller_application"|"order"|"payment"|"shipment"|"return"|"voucher"
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    href: text("href"),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("notifications_user_read_idx").on(t.userId, t.readAt)],
);

export const notificationPreferences = sqliteTable(
  "notification_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type] })],
);
