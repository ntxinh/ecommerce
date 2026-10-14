import "server-only";

import { and, count, desc, eq, gte, inArray, like, lt, ne, or, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import { type Actor, requirePermission } from "@/server/auth/permissions";
import { revokeAllSessions } from "@/server/auth/sessions";
import type { DB } from "@/server/db/client";
import {
  auditLogs,
  inventory,
  orders,
  products,
  returnRequests,
  sellerApplications,
  shopMemberships,
  shops,
  userRoles,
  users,
} from "@/server/db/schema";

const invalid = (msg: string): never => {
  throw new AuthError("INVALID_INPUT", 400, msg);
};

const LIMIT_MAX = 50;
function pageLimit(limit: number | undefined): number {
  const n = limit ?? 20;
  if (!Number.isInteger(n) || n < 1 || n > LIMIT_MAX) invalid(`limit must be 1..${LIMIT_MAX}`);
  return n;
}

export type AdminDashboard = {
  ordersToday: number;
  gmvVnd: number;
  customerCount: number;
  sellerCount: number;
  pendingApplications: number;
  moderationQueue: number;
  pendingReturns: number;
  lowStock: number;
};

/** Headline counts + queues for the admin dashboard. GMV = Σ orders.total_vnd minus CANCELLED. */
export function adminDashboard(db: DB, actor: Actor | null): AdminDashboard {
  requirePermission(actor, "admin:*");
  // ponytail: UTC day boundary; a store-local timezone bucket only matters if ops cares.
  const dayStart = new Date().setUTCHours(0, 0, 0, 0);
  const single = (q: { all: () => { n: number }[] }) => q.all()[0]?.n ?? 0;

  return {
    ordersToday: single(
      db.select({ n: count() }).from(orders).where(gte(orders.createdAt, dayStart)),
    ),
    gmvVnd: single(
      db
        .select({ n: sql<number>`coalesce(sum(${orders.totalVnd}), 0)` })
        .from(orders)
        .where(ne(orders.status, "CANCELLED")),
    ),
    customerCount: single(
      db.select({ n: count() }).from(userRoles).where(eq(userRoles.role, "CUSTOMER")),
    ),
    sellerCount: single(
      db.select({ n: count() }).from(userRoles).where(eq(userRoles.role, "SELLER")),
    ),
    pendingApplications: single(
      db
        .select({ n: count() })
        .from(sellerApplications)
        .where(eq(sellerApplications.status, "PENDING")),
    ),
    moderationQueue: single(
      db.select({ n: count() }).from(products).where(eq(products.moderationStatus, "SUBMITTED")),
    ),
    pendingReturns: single(
      db
        .select({ n: count() })
        .from(returnRequests)
        .where(inArray(returnRequests.status, ["PENDING", "DISPUTED"])),
    ),
    lowStock: single(
      db
        .select({ n: count() })
        .from(inventory)
        .where(sql`${inventory.onHand} - ${inventory.reserved} <= 5`),
    ),
  };
}

/** Everything except the credential — admin rows cross the RSC→client boundary. */
export type SafeUser = Omit<typeof users.$inferSelect, "passwordHash">;
const safeUserCols = {
  id: users.id,
  email: users.email,
  name: users.name,
  status: users.status,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  emailVerifiedAt: users.emailVerifiedAt,
};

export type AdminUserRow = SafeUser & { roles: string[] };

/** Admin user list, id-desc keyset cursor; `q` matches email or name. */
export function listUsers(
  db: DB,
  actor: Actor | null,
  opts: { q?: string; status?: "ACTIVE" | "SUSPENDED"; cursor?: string; limit?: number } = {},
): { items: AdminUserRow[]; nextCursor: string | null } {
  requirePermission(actor, "admin:*");
  const limit = pageLimit(opts.limit);
  const rows = db
    .select(safeUserCols)
    .from(users)
    .where(
      and(
        opts.q ? or(like(users.email, `%${opts.q}%`), like(users.name, `%${opts.q}%`)) : undefined,
        opts.status ? eq(users.status, opts.status) : undefined,
        opts.cursor ? lt(users.id, opts.cursor) : undefined,
      ),
    )
    .orderBy(desc(users.id))
    .limit(limit + 1)
    .all();

  const page = rows.slice(0, limit);
  const roles = page.length
    ? db
        .select()
        .from(userRoles)
        .where(
          inArray(
            userRoles.userId,
            page.map((r) => r.id),
          ),
        )
        .all()
    : [];
  const rolesOf = new Map<string, string[]>();
  for (const r of roles) {
    const list = rolesOf.get(r.userId) ?? [];
    list.push(r.role);
    rolesOf.set(r.userId, list);
  }

  const items = page.map((u) => ({ ...u, roles: rolesOf.get(u.id) ?? [] }));
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? last.id : null };
}

export type UserDetail = {
  user: SafeUser;
  roles: string[];
  memberships: { shopId: string; shopName: string; role: string }[];
  recentAudit: (typeof auditLogs.$inferSelect)[];
};

/** User profile + roles + shops + last 20 audit rows touching the user. */
export function getUserDetail(db: DB, actor: Actor | null, userId: string): UserDetail {
  requirePermission(actor, "admin:*");
  const user = db.select(safeUserCols).from(users).where(eq(users.id, userId)).get();
  if (!user) throw new AuthError("NOT_FOUND", 404, "user not found");

  const roles = db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId))
    .all()
    .map((r) => r.role);
  const memberships = db
    .select({ shopId: shops.id, shopName: shops.name, role: shopMemberships.role })
    .from(shopMemberships)
    .innerJoin(shops, eq(shops.id, shopMemberships.shopId))
    .where(eq(shopMemberships.userId, userId))
    .all();
  const recentAudit = db
    .select()
    .from(auditLogs)
    .where(
      or(
        eq(auditLogs.actorId, userId),
        and(eq(auditLogs.targetType, "user"), eq(auditLogs.targetId, userId)),
      ),
    )
    .orderBy(desc(auditLogs.id))
    .limit(20)
    .all();

  return { user, roles, memberships, recentAudit };
}

/** Suspend/reactivate; suspend revokes all sessions in the same tx + writes user.status audit. */
export function setUserStatus(
  db: DB,
  actor: Actor | null,
  userId: string,
  status: "ACTIVE" | "SUSPENDED",
): void {
  const a = requirePermission(actor, "admin:*");
  db.transaction((tx) => {
    const user = tx.select().from(users).where(eq(users.id, userId)).get();
    if (!user) throw new AuthError("NOT_FOUND", 404, "user not found");
    if (userId === a.userId && status === "SUSPENDED") invalid("cannot suspend yourself");
    if (user.status !== status) {
      tx.update(users).set({ status, updatedAt: Date.now() }).where(eq(users.id, userId)).run();
      // Same tx: better-sqlite3 runs statements on the transaction's connection.
      if (status === "SUSPENDED") void revokeAllSessions(db, userId);
    }
    tx.insert(auditLogs)
      .values({
        id: `aud_${ulid()}`,
        actorId: a.userId,
        action: "user.status",
        targetType: "user",
        targetId: userId,
        metaJson: JSON.stringify({ from: user.status, to: status }),
        createdAt: Date.now(),
      })
      .run();
  });
}

/** Force sign-out everywhere for a user without changing their status. */
export function revokeUserSessions(db: DB, actor: Actor | null, userId: string): void {
  const a = requirePermission(actor, "admin:*");
  db.transaction((tx) => {
    const user = tx.select().from(users).where(eq(users.id, userId)).get();
    if (!user) throw new AuthError("NOT_FOUND", 404, "user not found");
    void revokeAllSessions(db, userId);
    tx.insert(auditLogs)
      .values({
        id: `aud_${ulid()}`,
        actorId: a.userId,
        action: "user.sessions_revoked",
        targetType: "user",
        targetId: userId,
        metaJson: "{}",
        createdAt: Date.now(),
      })
      .run();
  });
}

/** Audit log list, newest first; id-desc keyset cursor, filterable by target. */
export function listAuditLogs(
  db: DB,
  actor: Actor | null,
  opts: { targetType?: string; targetId?: string; cursor?: string; limit?: number } = {},
): { items: (typeof auditLogs.$inferSelect)[]; nextCursor: string | null } {
  requirePermission(actor, "admin:*");
  const limit = pageLimit(opts.limit);
  const rows = db
    .select()
    .from(auditLogs)
    .where(
      and(
        opts.targetType ? eq(auditLogs.targetType, opts.targetType) : undefined,
        opts.targetId ? eq(auditLogs.targetId, opts.targetId) : undefined,
        opts.cursor ? lt(auditLogs.id, opts.cursor) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.id))
    .limit(limit + 1)
    .all();
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? last.id : null };
}
