import "server-only";
import { AuthError } from "@/server/api/errors";

export type Role = "CUSTOMER" | "SELLER" | "ADMIN";

export type Permission =
  | "product:read"
  | "product:write"
  | "order:read"
  | "order:write"
  | "shop:manage"
  | "admin:*"
  | "seller:apply";

export type Actor = {
  userId: string;
  roles: Role[];
  memberships: { shopId: string; role: "OWNER" | "STAFF"; permissions: string[] }[];
};

/** `product:*` grants cover `product:read`/`product:write`; `*` covers all. */
function covers(grant: string, perm: Permission): boolean {
  if (grant === "*" || grant === perm) return true;
  return grant.endsWith(":*") && perm.startsWith(`${grant.slice(0, -1)}`);
}

const GLOBAL_PERMS: Permission[] = ["admin:*", "seller:apply"];

export function requirePermission(
  actor: Actor | null,
  perm: Permission,
  ctx?: { shopId?: string },
): Actor {
  if (!actor) throw new AuthError("UNAUTHORIZED", 401);
  if (actor.roles.includes("ADMIN")) return actor;

  if (GLOBAL_PERMS.includes(perm)) {
    // seller:apply: any authenticated customer may apply to become a seller.
    if (perm === "seller:apply" && actor.roles.includes("CUSTOMER")) return actor;
    throw new AuthError("FORBIDDEN", 403);
  }

  // Shop-scoped perms require a matching membership.
  const shopId = ctx?.shopId;
  if (!shopId) throw new AuthError("FORBIDDEN", 403);
  const membership = actor.memberships.find((m) => m.shopId === shopId);
  if (!membership) throw new AuthError("FORBIDDEN", 403);
  if (membership.role === "OWNER") return actor;
  if (membership.permissions.some((g) => covers(g, perm))) return actor;
  throw new AuthError("FORBIDDEN", 403);
}

/**
 * Seller-shell check on an Actor: passes when any membership grants
 * `shop:manage` for that shop (OWNER implicitly). Throws UNAUTHORIZED when
 * logged out, FORBIDDEN when no membership qualifies. ADMIN bypasses via
 * requirePermission's global rule.
 */
export function sellerActor(actor: Actor | null): Actor {
  if (!actor) throw new AuthError("UNAUTHORIZED", 401);
  if (actor.roles.includes("ADMIN")) return actor; // same bypass as requirePermission
  for (const m of actor.memberships) {
    try {
      return requirePermission(actor, "shop:manage", { shopId: m.shopId });
    } catch (e) {
      if (!(e instanceof AuthError && e.status === 403)) throw e;
    }
  }
  throw new AuthError("FORBIDDEN", 403);
}
