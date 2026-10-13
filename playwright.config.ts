import { defineConfig } from "@playwright/test";

export const E2E_DB = "file:./tests/.tmp/e2e.db";
export const PORT = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: `http://localhost:${PORT}/en`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: E2E_DB },
  },
});
