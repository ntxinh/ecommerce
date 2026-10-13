# Local Development

**Status: Implemented**

## Prerequisites

- Node 22 and pnpm 9 — `mise.toml` pins `[tools] node = "22" pnpm = "9"`
  (`mise install` if you use mise).
- Copy `.env.example` to `.env` (all values have safe dev defaults).

## Boot

```bash
make setup        # pnpm install + next typegen
make db-reset     # rm data/marketflow.db, migrate, seed
make dev          # http://localhost:3000 — redirects to /en
```

DB scripts run with `NODE_OPTIONS="--conditions=react-server"` so
`server-only` resolves to the empty module outside the RSC bundler — keep that
flag if you invoke tsx/drizzle-kit by hand.

## Tooling

- **Lint/format:** Biome 2 (`make lint` / `make format`). Editor integration
  via the official Biome LSP/VS Code extension; `.editorconfig` covers
  indentation/EOL for everything else.
- **Typecheck:** `make typecheck` (`next typegen` + `tsc --noEmit`).
- **i18n:** add keys to both `messages/en.json` and `messages/vi.json` — the
  parity test fails otherwise.
- **Dev mailbox:** reset/verify "emails" land as JSON files in `mailbox/`
  (gitignored) and are logged by pino.

## `lsp.json` — deliberate omission

Spec §24 calls for `lsp.json` *only if* the target tool recognizes the format.
No documented consumer schema exists for `lsp.json` in this toolchain (mise,
pnpm, Biome, Next.js, omp). Rather than invent a schema and claim it works,
the file is omitted — language-server integration is provided by the Biome
extension and TypeScript's own server, configured via `biome.json` and
`tsconfig.json` respectively. Revisit if a chosen agent/tool publishes a real
`lsp.json` schema.

## Troubleshooting

- **`server-only` errors in scripts/tests** — you ran a DB script without the
  `react-server` condition; use the Makefile targets.
- **Stale generated route types** — `pnpm next typegen`.
- **Locked/missing SQLite** — `make db-reset` recreates `data/marketflow.db`
  (destructive; dev only).
- **`ERR_PNPM_*` on install** — confirm `pnpm -v` is 9.x (`mise install`).
