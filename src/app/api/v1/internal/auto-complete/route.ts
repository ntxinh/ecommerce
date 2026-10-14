import { env } from "@/env";
import { AuthError, toErrorResponse } from "@/server/api/errors";
import { getDb } from "@/server/db/client";
import { autoCompleteSellerOrders } from "@/server/modules/orders/fulfillment";

/**
 * POST /api/v1/internal/auto-complete — cron sweep: DELIVERED seller orders
 * past `auto_complete_days` become COMPLETED. Bearer INTERNAL_CRON_TOKEN.
 */
export async function POST(req: Request) {
  try {
    if (req.headers.get("authorization") !== `Bearer ${env.INTERNAL_CRON_TOKEN}`) {
      throw new AuthError("UNAUTHORIZED", 401);
    }
    return Response.json({ data: { completed: autoCompleteSellerOrders(getDb()) } });
  } catch (e) {
    return toErrorResponse(e);
  }
}
