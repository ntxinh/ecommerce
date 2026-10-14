import "server-only";

import { and, desc, eq, like, lt, or } from "drizzle-orm";
import { ulid } from "ulidx";
import { z } from "zod";
import { AuthError } from "@/server/api/errors";
import { type Actor, requirePermission } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import { applicationSettings, auditLogs, orders, users, vouchers } from "@/server/db/schema";
import { getOrder, type OrderDetail } from "@/server/modules/orders/service";

const invalid = (msg: string): never => {
  throw new AuthError("INVALID_INPUT", 400, msg);
};

export type AdminOrderRow = typeof orders.$inferSelect & { buyerEmail: string };

/** All orders newest first; id-desc keyset cursor. `q` matches order id or buyer email. */
export function listAdminOrders(
  db: DB,
  actor: Actor | null,
  opts: {
    q?: string;
    status?: (typeof orders.$inferSelect)["status"];
    cursor?: string;
    limit?: number;
  } = {},
): { items: AdminOrderRow[]; nextCursor: string | null } {
  requirePermission(actor, "admin:*");
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const rows = db
    .select({ order: orders, buyerEmail: users.email })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(
      and(
        opts.q ? or(like(orders.id, `%${opts.q}%`), like(users.email, `%${opts.q}%`)) : undefined,
        opts.status ? eq(orders.status, opts.status) : undefined,
        opts.cursor ? lt(orders.id, opts.cursor) : undefined,
      ),
    )
    .orderBy(desc(orders.id))
    .limit(limit + 1)
    .all();

  const items = rows.slice(0, limit).map((r) => ({ ...r.order, buyerEmail: r.buyerEmail }));
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? last.id : null };
}

/** Admin order detail — getOrder already lets ADMIN through. */
export function getAdminOrder(db: DB, actor: Actor | null, orderId: string): OrderDetail {
  const a = requirePermission(actor, "admin:*");
  return getOrder(db, a, orderId);
}

/** Whole settings table, values JSON-parsed — keys not present simply absent. */
export function getSettings(db: DB, actor: Actor | null): Record<string, unknown> {
  requirePermission(actor, "admin:*");
  const out: Record<string, unknown> = {};
  for (const row of db.select().from(applicationSettings).all()) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value; // unparseable row surfaces raw rather than breaking the page
    }
  }
  return out;
}

/** Ops-tunable keys and the shape each accepts — anything else is refused
 *  before touching the table. Keys double as the settings-page row list. */
const SETTING_VALUE_SCHEMAS: Record<string, z.ZodType> = {
  commission_rate_bps: z.number().int().min(0).max(10_000),
  return_window_days: z.number().int().positive(),
  auto_complete_days: z.number().int().positive(),
  reservation_ttl_minutes: z.number().int().positive(),
  shipping_fees: z
    .record(z.string(), z.number().int().min(0))
    .refine((m) => Object.keys(m).length > 0),
};
export const ADMIN_SETTING_KEYS: Record<string, true> = Object.fromEntries(
  Object.keys(SETTING_VALUE_SCHEMAS).map((k) => [k, true]),
);

/** Upsert `application_settings[key] = JSON.stringify(value)` + settings.update audit. */
export function setSetting(db: DB, actor: Actor | null, key: string, value: unknown): void {
  const a = requirePermission(actor, "admin:*");
  const schema = SETTING_VALUE_SCHEMAS[key];
  if (!schema) invalid(`unknown setting ${key}`);
  const parsed = schema.safeParse(value);
  if (!parsed.success) invalid(`invalid value for ${key}`);
  const json = JSON.stringify(parsed.data);
  db.transaction((tx) => {
    tx.insert(applicationSettings)
      .values({ key, value: json })
      .onConflictDoUpdate({ target: applicationSettings.key, set: { value: json } })
      .run();
    tx.insert(auditLogs)
      .values({
        id: `aud_${ulid()}`,
        actorId: a.userId,
        action: "settings.update",
        targetType: "setting",
        targetId: key,
        metaJson: JSON.stringify({ key }),
        createdAt: Date.now(),
      })
      .run();
  });
}

export type PlatformVoucherInput = {
  code: string;
  kind: "PERCENT" | "FIXED" | "SHIPPING";
  /** PERCENT: basis points; FIXED/SHIPPING: VND. */
  value: number;
  minSpendVnd?: number;
  maxDiscountVnd?: number;
  startsAt: number;
  endsAt: number;
  totalLimit?: number;
  perUserLimit?: number;
};

/** Inserts a PLATFORM voucher (mirrors the vch_* seed shape). Returns the new id. */
export function createPlatformVoucher(
  db: DB,
  actor: Actor | null,
  input: PlatformVoucherInput,
): string {
  const a = requirePermission(actor, "admin:*");
  const code = input.code.trim().toUpperCase();
  if (!code || code.length > 64) invalid("voucher code required");
  if (!Number.isInteger(input.value) || input.value <= 0) {
    invalid("value must be a positive integer");
  }
  if (input.kind === "PERCENT" && input.value > 10_000) {
    invalid("percent is basis points ≤ 10000");
  }
  if (
    !Number.isFinite(input.startsAt) ||
    !Number.isFinite(input.endsAt) ||
    input.endsAt <= input.startsAt
  ) {
    invalid("endsAt must be after startsAt");
  }
  // minSpendVnd: 0 is a real value ("no minimum") — the column default.
  for (const [name, n, min] of [
    ["minSpendVnd", input.minSpendVnd, 0],
    ["maxDiscountVnd", input.maxDiscountVnd, 1],
    ["totalLimit", input.totalLimit, 1],
    ["perUserLimit", input.perUserLimit, 1],
  ] as const) {
    if (n !== undefined && (!Number.isInteger(n) || n < min)) {
      invalid(`${name} must be an integer ≥ ${min}`);
    }
  }
  if (db.select({ id: vouchers.id }).from(vouchers).where(eq(vouchers.code, code)).get()) {
    invalid(`code ${code} already exists`);
  }

  const id = `vch_${ulid()}`;
  db.transaction((tx) => {
    tx.insert(vouchers)
      .values({
        id,
        code,
        scope: "PLATFORM",
        kind: input.kind,
        value: input.value,
        minSpendVnd: input.minSpendVnd ?? 0,
        maxDiscountVnd: input.maxDiscountVnd ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        totalLimit: input.totalLimit ?? null,
        perUserLimit: input.perUserLimit ?? null,
      })
      .run();
    tx.insert(auditLogs)
      .values({
        id: `aud_${ulid()}`,
        actorId: a.userId,
        action: "voucher.create",
        targetType: "voucher",
        targetId: id,
        metaJson: JSON.stringify({ code }),
        createdAt: Date.now(),
      })
      .run();
  });
  return id;
}
