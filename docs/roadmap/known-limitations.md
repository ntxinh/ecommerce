# Known Limitations

**Status: Living document** — deliberate simplifications and accepted gaps in
the current implementation. Each entry names its ceiling and upgrade path.

## Current

1. **In-memory rate limiter** (`src/server/auth/rate-limit.ts`) — per-process
   sliding-window Map; resets on restart and does not coordinate across
   replicas. Keys are pruned only when touched (lazy pruning). Upgrade:
   shared store (Redis/PG) when multi-instance.
2. **`login:{email}` rate-limit keying** — login attempts are keyed on the
   target email, so an attacker can deliberately lock a victim out of logging
   in for the 60s window. Accepted for the demo; key on `ip+email` or add
   backoff when hardening.
3. **Dev mailbox delivery** (`src/server/auth/dev-mailbox.ts`) — reset/verify
   links are written to `mailbox/*.json` and logged, never emailed. Upgrade:
   real SMTP/transactional provider behind the same `deliverMail` seam.
4. **Verify-token consume on render** — `/verify/[token]` consumes the token
   during page render. Handled idempotently today (consumed token +
   `emailVerifiedAt` both checked); a link-scanner prefetch could still burn
   a fresh token. Upgrade: POST-confirm button if scanners prove to matter.
5. **Register TOCTOU** — registration relies on the `users.email` unique
   index; under a race a loser can see a raw unique-constraint error instead
   of `EMAIL_TAKEN`. Window is tiny at SQLite scale; map the constraint error
   explicitly if it shows up.
6. **Ledger simplification (planned design)** — `financial_ledger_entries`
   will be append-only signed entries on named accounts, not full
   double-entry bookkeeping; balances derive from SUM per account. Upgrade:
   journal + lines tables if real accounting is required.
7. **Uploads = URL references** — product images are validated URL/local-path
   references; no storage service, no binary upload validation.
8. **Middleware deprecation** — `src/middleware.ts` prints the Next.js
   "middleware" deprecation notice (rename to `proxy.ts` per Next 16
   guidance); kept as middleware for next-intl compat pending a verified
   migration.
9. **Admin redirect has no feedback** — non-admin users hitting `/admin` are
   redirected away with no "not allowed" message; add a toast/interstitial
   when the admin console gains screens.
10. **Timestamp unit drift** — `sessions.expiresAt`, `password_reset_tokens.*`,
    and `users.*_at` store **milliseconds** (`Date.now()`) while the stated
    convention is unixepoch **seconds**. Normalize on the PostgreSQL port.
11. **`lsp.json` omitted** — no documented consumer schema in this toolchain;
    decision recorded in `docs/operations/local-development.md`.
12. **`/api/v1/ready` not implemented** — only liveness exists today.

## Deferred hardening (by phase)

- CSP header + HSTS env flag (Phase 9).
- OpenAPI contract test + Scalar UI (Phase 9).
- Coverage thresholds on money/stock modules (after Phase 5).
