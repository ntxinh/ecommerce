import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    // `server-only` throws outside an RSC bundler; stub it out in tests.
    alias: { "server-only": new URL("./tests/server-only.stub.ts", import.meta.url).pathname },
  },
  test: {
    passWithNoTests: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts?(x)", "tests/integration/**/*.test.ts?(x)"],
    env: { APP_ENV: "test", DATABASE_URL: "file:./tests/.tmp/test.db" },
    coverage: {
      provider: "v8",
      include: ["src/server/modules/**"],
      reporter: ["text", "json-summary", "json"],
      // Pinned at the measured floors (phases 7–9 baseline, rounded down to
      // 2dp so float edges can't flake). Docs: docs/testing/testing-strategy.md.
      thresholds: {
        "src/server/modules/pricing/**": { lines: 98.28, functions: 100 },
        "src/server/modules/orders/**": { lines: 92.2, functions: 90.27 },
        "src/server/modules/inventory/**": { lines: 100, functions: 100 },
        "src/server/modules/payments/**": { lines: 95.83, functions: 91.22 },
        "src/server/modules/finance/**": { lines: 100, functions: 100 },
      },
    },
  },
});
