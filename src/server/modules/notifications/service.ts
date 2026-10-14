import "server-only";

import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import { notificationPreferences, notifications } from "@/server/db/schema";

export type Notification = typeof notifications.$inferSelect;
export type NType =
  | "account"
  | "seller_application"
  | "order"
  | "payment"
  | "shipment"
  | "return"
  | "voucher";

/** Query surface shared by the DB handle and a drizzle tx. */
export type Tx = Pick<DB, "select" | "insert" | "update">;

/**
 * Inserts one notification row for the user — suppressed when a
 * notification_preferences row disables this type (absent row = enabled).
 * `title` is an i18n key under the `notifications` namespace (rendered
 * client-side by the bell); `body` is either a literal string or a params
 * record serialized to JSON for interpolation ({orderId} etc.). `href` is a
 * locale-free app path — the client prepends the locale.
 */
export function notify(
  tx: Tx,
  userId: string,
  type: NType,
  n: { title: string; body?: string | Record<string, string | number>; href?: string },
): void {
  const pref = tx
    .select({ enabled: notificationPreferences.enabled })
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.type, type)))
    .get();
  if (pref && !pref.enabled) return;
  tx.insert(notifications)
    .values({
      id: `ntf_${ulid()}`,
      userId,
      type,
      title: n.title,
      body: typeof n.body === "string" ? n.body : JSON.stringify(n.body ?? {}),
      href: n.href ?? null,
      createdAt: Date.now(),
    })
    .run();
}

/** Actor's notifications, newest first; ULID-desc keyset cursor, max 50. */
export function listNotifications(
  db: DB,
  actor: Actor,
  opts: { cursor?: string; limit?: number } = {},
): { items: Notification[]; nextCursor: string | null; unread: number } {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const conds = [eq(notifications.userId, actor.userId)];
  if (opts.cursor) conds.push(lt(notifications.id, opts.cursor));
  const rows = db
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.id))
    .limit(limit + 1)
    .all();
  const items = rows.slice(0, limit);
  const unread =
    db
      .select({ n: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)))
      .get()?.n ?? 0;
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null, unread };
}

/** Marks one notification read. Owner only — FORBIDDEN on another user's id. */
export function markRead(db: DB, actor: Actor, id: string): void {
  const n = db.select().from(notifications).where(eq(notifications.id, id)).get();
  if (!n) throw new AuthError("NOT_FOUND", 404, "notification not found");
  if (n.userId !== actor.userId) throw new AuthError("FORBIDDEN", 403);
  if (n.readAt) return;
  db.update(notifications).set({ readAt: Date.now() }).where(eq(notifications.id, id)).run();
}

/** Marks every unread notification of the actor read; returns the count marked. */
export function markAllRead(db: DB, actor: Actor): number {
  return db
    .update(notifications)
    .set({ readAt: Date.now() })
    .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)))
    .run().changes;
}
