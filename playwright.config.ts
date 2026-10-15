import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
// Outside the project tree: Turbopack watches the repo and WAL churn on a
// repo-local DB would force-reload pages mid-test.
export const E2E_DB = `file:${join(tmpdir(), "marketflow-e2e.db")}`;
export const PORT = 3100;

// A local .env may carry real STRIPE_* keys; empty-string env vars win over
// .env files (Next never overwrites an existing process.env entry) and read
// falsy at every gate — the e2e suite exercises the unconfigured path
// (hidden payment method, webhook 404) no matter what the developer has set.
export default defineConfig({
  // test-results/ sits inside the watched repo: Playwright writes artifacts
  // mid-run, Turbopack sees the churn, Fast Refresh reloads the page under the
  // test mid-action. Keep output outside the tree like the DB above.
  outputDir: join(tmpdir(), "marketflow-e2e-artifacts"),
  // One worker: Turbopack compiles on demand, and a compile triggered by any
  // page load broadcasts a Fast Refresh reload to every connected browser —
  // parallel workers knock each other over mid-click. The seeded SQLite e2e
  // DB is single-writer anyway.
  workers: 1,
  // Generous test budget: first-hit Turbopack compiles and hydration-retry
  // loops on controlled inputs can stall a test for tens of seconds.
  timeout: 120_000,
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    // Probe a route that never touches the DB: the web server starts before
    // globalSetup reseeds the e2e DB, so a page-backed URL 500s on fresh runs
    // ("no such table: products") and would leave the server holding a handle
    // to a deleted file.
    url: `http://localhost:${PORT}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DB,
      STRIPE_SECRET_KEY: "",
      STRIPE_PUBLISHABLE_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
    },
  },
});
