import "server-only";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@/server/observability/logger";

const mailLogger = logger.child({ component: "dev-mailbox" });

/** Dev mail adapter: drops a JSON file per message instead of sending email. */
export function deliverMail(kind: "reset" | "verify", to: string, payload: object): void {
  mkdirSync("mailbox", { recursive: true });
  const file = join("mailbox", `${Date.now()}-${to.replaceAll("/", "_")}.json`);
  writeFileSync(file, JSON.stringify({ kind, to, payload }, null, 2));
  // Never log payload — it may contain tokens.
  mailLogger.info({ kind, to }, "dev mail");
}
