# ADR-0001: ADMIN bypasses shop-scoped permissions

**Status: Accepted (implemented)** · Date: 2026-10-13

## Context

Two candidate rulings existed for how `ADMIN` interacts with shop-scoped
permissions (`product:write`, `order:read`, `shop:manage`, …): bypass only
`admin:*` (admins need a membership like everyone else for shop actions), or
bypass everything.

## Decision

`ADMIN` bypasses **all** permission checks, including shop-scoped ones. In
`requirePermission`, the `actor.roles.includes("ADMIN")` check returns before
any global-vs-scoped branching, and `sellerActor` applies the same bypass for
the seller shell.

## Rationale

The admin console is required to manage every shop — moderation, seller
suspension, order disputes. Requiring admins to hold a `shop_memberships` row
per shop would force a synthetic membership on every shop creation and add a
denial path with no security benefit: the ADMIN role is already the highest
trust level.

## Consequences

- A compromised admin account is total; keep the ADMIN role tightly issued.
- `sellerActor` treats an admin as a valid seller-shell actor even with zero
  memberships.
- Shop-scoped audit trails (Planned, `audit_logs`) become the compensating
  control for accountability.
