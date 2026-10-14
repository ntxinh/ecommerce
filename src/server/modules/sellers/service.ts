import "server-only";

import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { ulid } from "ulidx";
import { ApplyInput } from "@/server/api/contracts/seller";
import { AuthError } from "@/server/api/errors";
import { type Actor, requirePermission } from "@/server/auth/permissions";
import type { DB } from "@/server/db/client";
import {
  auditLogs,
  sellerApplications,
  shopMemberships,
  shops,
  userRoles,
  users,
} from "@/server/db/schema";
import { notify } from "@/server/modules/notifications/service";

export type Application = typeof sellerApplications.$inferSelect;
export type ApplicationStatus = Application["status"];

export type ApplicationRow = Application & {
  userName: string;
  userEmail: string;
  /** Applicant's owned shop once APPROVED (first membership); null otherwise. */
  shopId: string | null;
  shopStatus: "ACTIVE" | "SUSPENDED" | null;
};

const invalid = (msg: string): never => {
  throw new AuthError("INVALID_INPUT", 400, msg);
};

/** Lowercase, non-alnum → `-`, dashes trimmed; "shop" when nothing survives. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "shop";
}

/**
 * Customer applies to sell. One live application at a time: PENDING blocks a
 * second try; CHANGES_REQUESTED resubmits onto the same row (decision fields
 * cleared so it queues fresh). Returns the application id.
 */
export function applyToSell(db: DB, actor: Actor | null, input: unknown): string {
  const a = requirePermission(actor, "seller:apply");
  const parsed = ApplyInput.safeParse(input);
  if (!parsed.success) return invalid("check shop name (2–80) and field lengths");
  const { shopName, description, businessInfo } = parsed.data;
  // Description has no column of its own — it rides in businessInfo so
  // decideApplication can seed the shop's description on approval.
  const info =
    businessInfo.description === undefined ? { ...businessInfo, description } : businessInfo;

  const rows = db
    .select()
    .from(sellerApplications)
    .where(eq(sellerApplications.userId, a.userId))
    .orderBy(desc(sellerApplications.createdAt), desc(sellerApplications.id))
    .all();
  // Any PENDING row blocks — a later APPROVED application doesn't lift it.
  if (rows.some((r) => r.status === "PENDING")) {
    return invalid("application already pending");
  }
  const resubmit = rows.find((r) => r.status === "CHANGES_REQUESTED");
  if (resubmit) {
    db.update(sellerApplications)
      .set({
        shopName,
        businessInfo: JSON.stringify(info),
        status: "PENDING",
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
      })
      .where(eq(sellerApplications.id, resubmit.id))
      .run();
    return resubmit.id;
  }

  const id = `sapp_${ulid()}`;
  db.insert(sellerApplications)
    .values({
      id,
      userId: a.userId,
      shopName,
      businessInfo: JSON.stringify(info),
      createdAt: Date.now(),
    })
    .run();
  return id;
}

/** The actor's most recent application, or null. */
export function myApplication(db: DB, actor: Actor | null): Application | null {
  if (!actor) throw new AuthError("UNAUTHORIZED", 401);
  return (
    db
      .select()
      .from(sellerApplications)
      .where(eq(sellerApplications.userId, actor.userId))
      .orderBy(desc(sellerApplications.createdAt), desc(sellerApplications.id))
      .limit(1)
      .get() ?? null
  );
}

/** Admin list, newest first; ULID-desc keyset cursor, max 50. */
export function listApplications(
  db: DB,
  actor: Actor | null,
  opts: { status?: ApplicationStatus; cursor?: string; limit?: number } = {},
): { items: ApplicationRow[]; nextCursor: string | null } {
  requirePermission(actor, "admin:*");
  const limit = opts.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return invalid("limit must be an integer in 1..50");
  }
  const rows = db
    .select({ app: sellerApplications, userName: users.name, userEmail: users.email })
    .from(sellerApplications)
    .innerJoin(users, eq(users.id, sellerApplications.userId))
    .where(
      and(
        opts.status ? eq(sellerApplications.status, opts.status) : undefined,
        opts.cursor ? lt(sellerApplications.id, opts.cursor) : undefined,
      ),
    )
    .orderBy(desc(sellerApplications.id))
    .limit(limit + 1)
    .all();

  const page = rows.slice(0, limit);
  // An approved applicant owns a shop — surface the first one so the admin can
  // suspend/reactivate straight from the row. Small page → no N+1 concern.
  const memberRows = page.length
    ? db
        .select({
          userId: shopMemberships.userId,
          shopId: shopMemberships.shopId,
          status: shops.status,
        })
        .from(shopMemberships)
        .innerJoin(shops, eq(shops.id, shopMemberships.shopId))
        .where(
          and(
            inArray(
              shopMemberships.userId,
              page.map((r) => r.app.userId),
            ),
            eq(shopMemberships.role, "OWNER"),
          ),
        )
        .all()
    : [];
  const shopOf = new Map(memberRows.map((m) => [m.userId, m]));

  const items = page.map(({ app, userName, userEmail }) => {
    const m = app.status === "APPROVED" ? shopOf.get(app.userId) : undefined;
    return {
      ...app,
      userName,
      userEmail,
      shopId: m?.shopId ?? null,
      shopStatus: m?.status ?? null,
    };
  });
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? last.id : null };
}

/**
 * Admin decision. Approving creates the applicant's shop (slug from shopName,
 * UNIQUE collisions get "-2", "-3", …), an OWNER membership and the SELLER
 * role — all in one tx. Re-deciding an APPROVED row skips provisioning so a
 * raced double-approve stays idempotent. Always audits and notifies.
 */
export function decideApplication(
  db: DB,
  actor: Actor | null,
  appId: string,
  d: { decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED"; note?: string },
): void {
  const a = requirePermission(actor, "admin:*");
  db.transaction((tx) => {
    const app = tx.select().from(sellerApplications).where(eq(sellerApplications.id, appId)).get();
    if (!app) throw new AuthError("NOT_FOUND", 404, "application not found");

    if (app.status !== d.decision) {
      tx.update(sellerApplications)
        .set({
          status: d.decision,
          decidedBy: a.userId,
          decidedAt: Date.now(),
          decisionNote: d.note ?? null,
        })
        .where(eq(sellerApplications.id, appId))
        .run();
    }

    if (d.decision === "APPROVED" && app.status !== "APPROVED") {
      let info: Record<string, string> = {};
      try {
        info = JSON.parse(app.businessInfo);
      } catch {
        // Malformed businessInfo must not block the decision.
      }
      const base = slugify(app.shopName);
      let slug = base;
      for (
        let n = 2;
        tx.select({ id: shops.id }).from(shops).where(eq(shops.slug, slug)).get();
        n += 1
      ) {
        slug = `${base}-${n}`;
      }
      const shopId = `shop_${ulid()}`;
      tx.insert(shops)
        .values({
          id: shopId,
          slug,
          name: app.shopName,
          description: typeof info.description === "string" ? info.description : "",
          createdAt: Date.now(),
        })
        .run();
      tx.insert(shopMemberships)
        .values({ shopId, userId: app.userId, role: "OWNER" })
        .onConflictDoNothing()
        .run();
      tx.insert(userRoles)
        .values({ userId: app.userId, role: "SELLER" })
        .onConflictDoNothing()
        .run();
    }

    tx.insert(auditLogs)
      .values({
        id: `aud_${ulid()}`,
        actorId: a.userId,
        action: "seller_application.decide",
        targetType: "seller_application",
        targetId: appId,
        metaJson: JSON.stringify({ from: app.status, to: d.decision, note: d.note ?? null }),
        createdAt: Date.now(),
      })
      .run();
    notify(tx, app.userId, "seller_application", {
      title: `seller_application.${d.decision.toLowerCase()}`,
      body: { shopName: app.shopName },
      href: "/sell",
    });
  });
}

/** Admin suspend/reactivate; suspended shops drop out of all public reads. */
export function setShopStatus(
  db: DB,
  actor: Actor | null,
  shopId: string,
  status: "ACTIVE" | "SUSPENDED",
): void {
  const a = requirePermission(actor, "admin:*");
  db.transaction((tx) => {
    const shop = tx.select().from(shops).where(eq(shops.id, shopId)).get();
    if (!shop) throw new AuthError("NOT_FOUND", 404, "shop not found");
    if (shop.status !== status) {
      tx.update(shops).set({ status }).where(eq(shops.id, shopId)).run();
    }
    tx.insert(auditLogs)
      .values({
        id: `aud_${ulid()}`,
        actorId: a.userId,
        action: "shop.status",
        targetType: "shop",
        targetId: shopId,
        metaJson: JSON.stringify({ from: shop.status, to: status }),
        createdAt: Date.now(),
      })
      .run();
  });
}

/** Seller edits their shop's public profile (shop:manage scoped to the shop). */
export function updateShopProfile(
  db: DB,
  actor: Actor | null,
  shopId: string,
  patch: { name?: string; description?: string },
): void {
  requirePermission(actor, "shop:manage", { shopId });
  const set: Partial<{ name: string; description: string }> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name || name.length > 80) invalid("name must be 1–80 characters");
    set.name = name;
  }
  if (patch.description !== undefined) {
    if (patch.description.length > 500) invalid("description must be ≤500 characters");
    set.description = patch.description;
  }
  if (!Object.keys(set).length) return;
  const changed = db.update(shops).set(set).where(eq(shops.id, shopId)).run();
  if (!changed.changes) {
    if (!db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).get()) {
      throw new AuthError("NOT_FOUND", 404, "shop not found");
    }
  }
}
