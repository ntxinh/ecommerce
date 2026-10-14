import { describe, expect, it } from "vitest";
import {
  CartAddInput,
  CartMergeInput,
  CartRemoveInput,
  CartUpdateInput,
} from "@/server/api/contracts/cart";

describe("cart contracts", () => {
  it("coerces qty strings from FormData and accepts JSON numbers", () => {
    expect(CartAddInput.parse({ variantId: "var_1", qty: "3" })).toEqual({
      variantId: "var_1",
      qty: 3,
    });
    expect(CartAddInput.parse({ variantId: "var_1", qty: 2 }).qty).toBe(2);
  });

  it("rejects missing ids and non-positive/non-integer qty on add", () => {
    for (const bad of [
      { variantId: "", qty: 1 },
      { variantId: "var_1", qty: 0 },
      { variantId: "var_1", qty: -2 },
      { variantId: "var_1", qty: 1.5 },
      { variantId: "var_1", qty: "abc" },
      { variantId: "var_1", qty: "" }, // "" must not coerce to 0
      { variantId: "var_1" },
    ]) {
      expect(CartAddInput.safeParse(bad).success).toBe(false);
    }
  });

  it('allows qty 0 on update (line delete) but rejects ""/negatives', () => {
    expect(CartUpdateInput.parse({ cartItemId: "ci_1", qty: "0" }).qty).toBe(0);
    expect(CartUpdateInput.parse({ cartItemId: "ci_1", qty: 0 }).qty).toBe(0);
    expect(CartUpdateInput.safeParse({ cartItemId: "ci_1", qty: "" }).success).toBe(false);
    expect(CartUpdateInput.safeParse({ cartItemId: "ci_1", qty: " \t" }).success).toBe(false);
    expect(CartUpdateInput.safeParse({ cartItemId: "ci_1", qty: -1 }).success).toBe(false);
  });
  it("requires cartItemId on remove", () => {
    expect(CartRemoveInput.safeParse({ cartItemId: "ci_1" }).success).toBe(true);
    expect(CartRemoveInput.safeParse({}).success).toBe(false);
  });

  it("validates merge item lists", () => {
    expect(CartMergeInput.safeParse({ items: [{ variantId: "var_1", qty: 2 }] }).success).toBe(
      true,
    );
    expect(CartMergeInput.safeParse({ items: [{ variantId: "var_1", qty: 0 }] }).success).toBe(
      false,
    );
    expect(CartMergeInput.safeParse({ items: [{ qty: 1 }] }).success).toBe(false);
  });
});
