import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Outside the project tree: Turbopack watches the repo and WAL churn on a
// repo-local DB would force-reload pages mid-test.
export const E2E_DB = `file:${join(tmpdir(), "marketflow-e2e.db")}`;
export const PORT = 3100;

export default defineConfig({
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
    env: { DATABASE_URL: E2E_DB },
  },
});
