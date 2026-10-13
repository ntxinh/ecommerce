import "server-only";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { productVariants } from "./catalog";
import { users } from "./identity";

export const inventory = sqliteTable("inventory", {
  variantId: text("variant_id")
    .primaryKey()
    .references(() => productVariants.id, { onDelete: "cascade" }),
  onHand: integer("on_hand").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

// Append-only ledger; never UPDATE/DELETE rows.
export const inventoryMovements = sqliteTable(
  "inventory_movements",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    actorId: text("actor_id").references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("inventory_movements_variant_idx").on(t.variantId)],
);

export const stockReservations = sqliteTable(
  "stock_reservations",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id),
    qty: integer("qty").notNull(),
    status: text("status", { enum: ["ACTIVE", "CONSUMED", "RELEASED", "EXPIRED"] })
      .notNull()
      .default("ACTIVE"),
    idempotencyKey: text("idempotency_key").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("stock_reservations_expiry_idx").on(t.expiresAt, t.status),
    index("stock_reservations_variant_idx").on(t.variantId),
    index("stock_reservations_idem_idx").on(t.idempotencyKey),
  ],
);
