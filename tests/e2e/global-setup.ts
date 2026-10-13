import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import type { FullConfig } from "@playwright/test";
import { E2E_DB } from "../../playwright.config";

/**
 * Fresh e2e database per run: drop the file, then run the repo's own
 * migrate+seed script against it (react-server condition stubs `server-only`).
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
