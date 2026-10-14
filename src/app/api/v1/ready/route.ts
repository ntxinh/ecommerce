import { sql } from "drizzle-orm";
import { toErrorResponse } from "@/server/api/errors";
import { getDb } from "@/server/db/client";

/** GET /api/v1/ready — readiness probe: 200 only when the DB answers. */
export async function GET() {
  try {
    getDb().run(sql`select 1`);
    return Response.json({ data: { status: "ready" } });
  } catch (e) {
    return toErrorResponse(e);
  }
}
