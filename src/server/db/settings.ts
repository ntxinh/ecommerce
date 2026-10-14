import "server-only";

import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { applicationSettings } from "@/server/db/schema";

/** Reads a numeric `application_settings` key (JSON-encoded), falling back
 *  when the row is missing or doesn't parse to a finite number. */
export function settingNumber(db: Pick<DB, "select">, key: string, fallback: number): number {
  const row = db.select().from(applicationSettings).where(eq(applicationSettings.key, key)).get();
  const n = row ? (JSON.parse(row.value) as number) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
