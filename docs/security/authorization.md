# Authorization

**Status: Implemented**

Enforcer: `requirePermission(actor, permission, ctx?)` in
`src/server/auth/permissions.ts`. Entry points: `getActor()` (session cookie →
`Actor`), `requireAdmin()`, `requireSeller()` in `src/server/auth/actor.ts`.

## Actor

```ts
type Actor = {
  userId: string;
  roles: ("CUSTOMER" | "SELLER" | "ADMIN")[];            // from user_roles
  memberships: { shopId: string; role: "OWNER" | "STAFF"; permissions: string[] }[];
};
```

`Actor` is resolved per request from the session; membership `permissions` are a
JSON array of grant strings stored on `shop_memberships`. Grants support `exact`,
`prefix:*`, and `*` wildcards (`product:*` covers `product:read`).

## Permission matrix

| Permission | CUSTOMER | SELLER | Shop STAFF | Shop OWNER | ADMIN |
|---|---|---|---|---|---|
| `seller:apply` (global) | ✔ (any authenticated customer) | — | — | — | ✔ |
| `admin:*` (global) | ✘ | ✘ | ✘ | ✘ | ✔ |
| `product:read`, `product:write`, `order:read`, `order:write`, `shop:manage` (shop-scoped) | ✘ | ✘ | ✔ only if the membership's `permissions` grant covers it | ✔ (implicit all) | ✔ |

**ADMIN bypass ruling (ADR-0001):** `ADMIN` returns early in
`requirePermission` — it bypasses global *and* shop-scoped checks, no membership
required. The admin console manages all shops; requiring per-shop memberships
for admins adds denial paths with no security benefit. `sellerActor()` applies
the same bypass for the seller shell.

## Failure semantics

- No actor (logged out / expired session / suspended user) → `UNAUTHORIZED` 401.
- Authenticated but unauthorized → `FORBIDDEN` 403.

## Enforcement locations (implemented)

- Shells: `src/app/[locale]/admin/layout.tsx` → `requireAdmin()`;
  `src/app/[locale]/seller/layout.tsx` → `requireSeller()`.
- Server actions: `src/features/auth/actions.ts` re-checks actor state inside
  mutations (e.g. verify resend requires an active session).

## Row-level safety (Planned)

Repo queries will scope by `shop_id`/`user_id` predicates as domain modules
land; `requirePermission` alone is not a substitute for query scoping.
