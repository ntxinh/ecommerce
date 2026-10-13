import { describe, expect, it } from "vitest";
import { formatVnd } from "@/lib/format";

describe("formatVnd", () => {
  it("formats whole dong with no decimals", () => {
    expect(formatVnd(150000, "en-US")).toMatch(/150,000/);
    expect(formatVnd(150000, "en-US")).not.toContain(".00");
  });
});
