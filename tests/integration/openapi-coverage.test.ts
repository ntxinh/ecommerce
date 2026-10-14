import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SPEC = "docs/api/openapi.yaml";
const HTTP_METHODS: Record<string, true> = {
  get: true,
  put: true,
  post: true,
  delete: true,
  patch: true,
  head: true,
  options: true,
};

/** App-router path for a route file: src/app/api/v1/cart/route.ts → /api/v1/cart */
function routePath(file: string): string {
  return `/${file.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "")}`;
}

/** Exported HTTP methods: `export [async] function GET` or
 *  `export const GET = async (…)` — both are legal handler styles. */
function routeMethods(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const found = new Set<string>();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Z]+)/g)) {
    if (m[1].toLowerCase() in HTTP_METHODS) found.add(m[1].toUpperCase());
  }
  return [...found];
}

/**
 * Minimal scan of the spec's `paths:` block — `{  /path:` keys and their
 * `{    method:` children. Deliberately not a YAML parser: the coverage test
 * only needs path+operation names; a full parser would be a new dependency for
 * one indented map.
 */
function specOperations(yaml: string): Map<string, Set<string>> {
  const ops = new Map<string, Set<string>>();
  let inPaths = false;
  let current: string | null = null;
  for (const line of yaml.split("\n")) {
    if (/^paths:/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^\S/.test(line)) break; // next top-level key ends paths:
    if (!inPaths) continue;
    const pathMatch = line.match(/^ {2}(\/\S+):/);
    if (pathMatch) {
      current = pathMatch[1];
      ops.set(current, new Set());
      continue;
    }
    const methodMatch = line.match(/^ {4}([a-z]+):/);
    if (current && methodMatch && methodMatch[1] in HTTP_METHODS) {
      ops.get(current)?.add(methodMatch[1].toUpperCase());
    }
  }
  return ops;
}

const routeFiles = globSync("src/app/api/**/route.ts");
const spec = specOperations(readFileSync(SPEC, "utf8"));

describe("openapi.yaml ↔ route handlers", () => {
  it("documents every route file's exported methods", () => {
    const missing: string[] = [];
    for (const file of routeFiles) {
      const path = routePath(file);
      const documented = spec.get(path);
      for (const method of routeMethods(file)) {
        if (!documented?.has(method)) missing.push(`${method} ${path} (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every spec path+method exists on disk", () => {
    const onDisk = new Map<string, Set<string>>();
    for (const file of routeFiles) {
      onDisk.set(routePath(file), new Set(routeMethods(file)));
    }
    const phantom: string[] = [];
    for (const [path, methods] of spec) {
      for (const method of methods) {
        if (!onDisk.get(path)?.has(method)) phantom.push(`${method} ${path}`);
      }
    }
    expect(phantom).toEqual([]);
  });
});

describe("method regex", () => {
  it("matches const-exported handlers, not just function exports", () => {
    // A route written `export const DELETE = async () => …` must be caught —
    // the guard only covers what the pattern sees.
    const src = [
      "export async function GET() {}",
      "export const DELETE = async () => Response.json({})",
      "const PUT = () => {}", // not exported → ignored
      "export const title = 'x'", // lowercase → ignored
    ].join("\n");
    const found = new Set<string>();
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Z]+)/g)) {
      if (m[1].toLowerCase() in HTTP_METHODS) found.add(m[1]);
    }
    expect([...found].sort()).toEqual(["DELETE", "GET"]);
  });
});
