import "server-only";

import { eq } from "drizzle-orm";
import { AuthError } from "@/server/api/errors";
import type { DB } from "@/server/db/client";
import { applicationSettings } from "@/server/db/schema";

/** Flat per-order fee table (VND) from `application_settings.shipping_fees`
 *  (`{"standard":15000,"express":30000}` — seeded). Full ShippingProvider
 *  tracking is a later slice; checkout only needs quotes. */
function feeTable(db: Pick<DB, "select">): Record<string, number> {
  const row = db
    .select()
    .from(applicationSettings)
    .where(eq(applicationSettings.key, "shipping_fees"))
    .get();
  const parsed: unknown = row ? JSON.parse(row.value) : {};
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, number>) : {};
}

export function shippingMethods(db: Pick<DB, "select">): string[] {
  return Object.keys(feeTable(db));
}

/** Method name is case-insensitive; unknown method → INVALID_INPUT. */
export function quoteShippingFee(db: Pick<DB, "select">, method: string): number {
  const fee = feeTable(db)[method.toLowerCase()];
  if (typeof fee !== "number" || fee < 0) {
    throw new AuthError("INVALID_INPUT", 422, `unknown shipping method ${method}`);
  }
  return fee;
}
