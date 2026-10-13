# Security Model

**Status: Implemented (identity layer); domain-layer items Planned**

## Implemented

| Control | Where | Notes |
|---|---|---|
| Password hashing | `src/server/auth/passwords.ts` | argon2id via `@node-rs/argon2` |
| Password reset / verify tokens | `src/server/auth/tokens.ts`, `src/server/modules/identity/service.ts` | sha256'd, single-use (`usedAt`), 30-minute expiry; reset response is indistinguishable whether the email exists |
| Rate limiting | `src/server/auth/rate-limit.ts` | in-memory sliding window; login `login:{email}` 5/60s, reset `reset:{email}` 3/hr, verify resend `verify:{userId}` 3/hr |
| Authorization | see [authorization.md](authorization.md) | role + membership matrix, ADMIN bypass |
| Error hygiene | `src/server/api/errors.ts` | typed codes; unknown errors → `INTERNAL` 500, no internals |
| Security headers | `next.config.ts` | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` |
| Env validation | `src/env.ts` | Zod-parsed at boot; `.env.example` has placeholders only |
| Log redaction | `src/server/observability/logger.ts` | pino `redact` on password/token/secret/session/cookie/authorization paths |
| SQL injection | Drizzle parameterized queries everywhere | no raw SQL in services |
| Email verification | `verify/[token]` page | idempotent consume; `emailVerifiedAt` set once |

## Deliberate simplifications / gaps

See [known-limitations](../roadmap/known-limitations.md). Highlights: in-memory
rate limiter is single-instance; `login:{email}` keying allows an attacker to
lock out a victim's email for the window; dev "mailbox" writes reset links to
`mailbox/*.json` instead of sending email; uploads are validated URL references
only.

## Planned

- CSP header (dev-relaxed policy documented), HSTS behind env flag.
- CSRF: server actions are POST-only with SameSite=Lax cookies; re-verify when
  REST routes land.
- `audit_logs` for admin/financial actions; mass-assignment guards via Zod
  contracts on every input; safe redirect-URL handling.
