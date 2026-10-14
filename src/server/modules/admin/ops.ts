import "server-only";

import { and, desc, eq, like, lt, or } from "drizzle-orm";
import { ulid } from "ulidx";
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

/** Ops-tunable keys — anything else is refused before touching the table.
 *  Also the key list the settings page renders. */
export const ADMIN_SETTING_KEYS: Record<string, true> = {
  commission_rate_bps: true,
  shipping_fees: true,
  return_window_days: true,
  auto_complete_days: true,
  reservation_ttl_minutes: true,
};

/** Upsert `application_settings[key] = JSON.stringify(value)` + settings.update audit. */
export function setSetting(db: DB, actor: Actor | null, key: string, value: unknown): void {
  const a = requirePermission(actor, "admin:*");
  if (!ADMIN_SETTING_KEYS[key]) invalid(`unknown setting ${key}`);
  db.transaction((tx) => {
    tx.insert(applicationSettings)
      .values({ key, value: JSON.stringify(value) })
      .onConflictDoUpdate({
        target: applicationSettings.key,
        set: { value: JSON.stringify(value) },
      })
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
  for (const [name, n] of [
    ["minSpendVnd", input.minSpendVnd],
    ["maxDiscountVnd", input.maxDiscountVnd],
    ["totalLimit", input.totalLimit],
    ["perUserLimit", input.perUserLimit],
  ] as const) {
    if (n !== undefined && (!Number.isInteger(n) || n < 1)) {
      invalid(`${name} must be a positive integer`);
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
