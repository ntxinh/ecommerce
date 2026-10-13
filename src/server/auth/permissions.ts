import "server-only";

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

export class AuthError extends Error {
  constructor(
    public code: "UNAUTHORIZED" | "FORBIDDEN" | "EMAIL_TAKEN",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AuthError";
  }
}

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
  if (!actor) throw new AuthError("UNAUTHORIZED");
  if (actor.roles.includes("ADMIN")) return actor;

  if (GLOBAL_PERMS.includes(perm)) {
    // seller:apply: any authenticated customer may apply to become a seller.
    if (perm === "seller:apply" && actor.roles.includes("CUSTOMER")) return actor;
    throw new AuthError("FORBIDDEN");
  }

  // Shop-scoped perms require a matching membership.
  const shopId = ctx?.shopId;
  if (!shopId) throw new AuthError("FORBIDDEN");
  const membership = actor.memberships.find((m) => m.shopId === shopId);
  if (!membership) throw new AuthError("FORBIDDEN");
  if (membership.role === "OWNER") return actor;
  if (membership.permissions.some((g) => covers(g, perm))) return actor;
  throw new AuthError("FORBIDDEN");
}
