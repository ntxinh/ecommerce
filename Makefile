.PHONY: setup dev build lint format typecheck test test-unit test-integration test-e2e \
        db-generate db-migrate db-seed db-reset check verify

setup: ; pnpm install && pnpm next typegen
dev: ; pnpm dev
build: ; pnpm build
lint: ; pnpm biome check .
format: ; pnpm biome check --write .
typecheck: ; pnpm next typegen && pnpm tsc --noEmit
test: test-unit test-integration
test-unit: ; pnpm vitest run tests/unit
test-integration: ; pnpm vitest run tests/integration
test-e2e: ; pnpm playwright test
db-generate: ; pnpm drizzle-kit generate
db-migrate: ; pnpm tsx scripts/db-migrate.ts
db-seed: ; pnpm tsx scripts/db-seed.ts
db-reset: ; rm -f data/marketflow.db && $(MAKE) db-migrate db-seed
check: lint typecheck test
verify: check build test-e2e
