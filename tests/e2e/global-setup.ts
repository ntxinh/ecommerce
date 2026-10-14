import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import type { FullConfig } from "@playwright/test";
import { E2E_DB } from "../../playwright.config";

/**
 * Reseed the e2e database: drop the file, then run the repo's own
 * migrate+seed script against it (react-server condition stubs `server-only`).
 * Runs before tests but after webServer startup — so the readiness probe must
 * not touch the DB (see playwright.config.ts).
 */
export default async function globalSetup(_config: FullConfig) {
  const path = E2E_DB.replace("file:", "");
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${path}${suffix}`, { force: true });
  execSync("pnpm tsx scripts/db-seed.ts", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: E2E_DB,
      NODE_OPTIONS: "--conditions=react-server",
    },
  });
}
