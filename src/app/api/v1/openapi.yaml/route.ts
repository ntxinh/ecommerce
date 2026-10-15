import { readFileSync } from "node:fs";
import { join } from "node:path";

/** GET /api/v1/openapi.yaml — serves the hand-maintained spec as YAML. */
export function GET() {
  return new Response(readFileSync(join(process.cwd(), "docs/api/openapi.yaml"), "utf8"), {
    headers: { "content-type": "application/yaml; charset=utf-8" },
  });
}
