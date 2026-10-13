import "server-only";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./identity";

export const shops = sqliteTable(
  "shops",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: ["ACTIVE", "SUSPENDED"] })
      .notNull()
      .default("ACTIVE"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("shops_slug_unique").on(t.slug)],
);

export const shopMemberships = sqliteTable(
  "shop_memberships",
  {
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["OWNER", "STAFF"] }).notNull(),
    permissions: text("permissions").notNull().default("[]"), // JSON array of permission keys
  },
  (t) => [uniqueIndex("shop_memberships_unique").on(t.shopId, t.userId)],
);

export const sellerApplications = sqliteTable(
  "seller_applications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    shopName: text("shop_name").notNull(),
    businessInfo: text("business_info").notNull().default("{}"),
    status: text("status", {
      enum: ["PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED"],
    })
      .notNull()
      .default("PENDING"),
    decidedBy: text("decided_by"),
    decidedAt: integer("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("seller_apps_status_idx").on(t.status)],
);
