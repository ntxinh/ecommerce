import { env } from "@/env";

const HTML = `<!doctype html>
<html>
  <head>
    <title>Marketflow API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/api/v1/openapi.yaml"
      src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"
    ></script>
  </body>
</html>
`;

/** GET /api/docs — Scalar UI for docs/api/openapi.yaml. 404 unless API_DOCS_ENABLED=true. */
export function GET() {
  if (env.API_DOCS_ENABLED !== "true") {
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
}
