import { describe, expect, it } from "vitest";

describe("env", () => {
  it("parses defaults", async () => {
    // dynamic import intentional: env parses process.env at module load, so
    // import after vitest injects test env vars.
    const { env } = await import("@/env");
    expect(env.DATABASE_URL).toContain("file:");
    expect(env.APP_ENV).toBe("test");
  });
});
