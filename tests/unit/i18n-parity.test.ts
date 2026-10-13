import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import vi from "../../messages/vi.json";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("i18n parity", () => {
  it("en and vi have identical key sets", () => {
    expect(keys(vi).sort()).toEqual(keys(en).sort());
  });
});
