import { describe, expect, it } from "vitest";

describe("env", () => {
  it("parses injected test env", async () => {
    // await import keeps module load inside the test, after vitest injects env vars.
    const { env } = await import("@/env");
    expect(env.DATABASE_URL).toContain("file:");
    expect(env.APP_ENV).toBe("test");
  });
});
