# Observability

**Status: Implemented (logging + OTel hook); custom spans Planned**

## Logging — `src/server/observability/logger.ts`

Pino structured JSON logging:

- `logger` — base logger. Fields on every line: `level`, `time`, `service:
  "marketflow"`, `env` (`APP_ENV`), `msg`. Level from `LOG_LEVEL` (default
  `info`).
- `getRequestLogger(requestId)` — child logger bound to a request id; add
  trace ids once OTel context propagation is wired into handlers.
- `createLogger(stream?)` — factory used by tests to capture output
  (`tests/unit/logger.test.ts`).
- **Redaction** (never log secrets): `password`, `passwordHash`, `token`,
  `secret`, `session`, `cookie`, `headers.cookie`, `headers.authorization` —
  each censored to `"[redacted]"`. Extend `redact.paths` when new sensitive
  fields appear; the unit test guards the contract.
- Dev mail adapter logs through a child (`component: "dev-mailbox"`) and never
  logs message payloads (they contain tokens).
- Dev-pretty printing (pino-pretty) is not wired; stdout JSON is the single
  format today — add a `pino-pretty` transport under `APP_ENV=development` if
  desired.

## Tracing — `instrumentation.ts`

Next.js calls `register()` at boot. When `NEXT_RUNTIME=nodejs` **and**
`OTEL_EXPORTER_OTLP_ENDPOINT` is set, `@vercel/otel` registers with
`serviceName: "marketflow"`. Otherwise it's a no-op — local dev needs no
collector, and the SDK is never imported on other runtimes.

To run with a local collector: start an OTLP endpoint (e.g.
`otelcol`/`jaeger` on `http://localhost:4318`) and set
`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` before `pnpm dev`.

Planned: custom spans on checkout, payment confirm, and the reservation sweep
once those modules land.

## Operational endpoints

- `GET /api/v1/health` — liveness, returns `{data: {status: "ok"}}`, no
  internals.
- `GET /api/v1/ready` — Planned: DB ping returning only `{status}`.
