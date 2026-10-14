import { beforeEach, describe, expect, it } from "vitest";
import { useGuestCart } from "@/features/cart/use-guest-cart";

const line = (variantId: string, qty = 1) => ({
  variantId,
  qty,
  name: `P · ${variantId}`,
  sku: `SKU-${variantId}`,
  unitPriceVnd: 1000,
  shopName: "Shop",
});

describe("useGuestCart", () => {
  beforeEach(() => useGuestCart.setState({ items: [] }));

  it("adds a new line and merges repeats of the same variant", () => {
    useGuestCart.getState().add(line("var_1", 2));
    useGuestCart.getState().add(line("var_1", 3));
    useGuestCart.getState().add(line("var_2"));
    expect(useGuestCart.getState().items).toEqual([
      expect.objectContaining({ variantId: "var_1", qty: 5 }),
      expect.objectContaining({ variantId: "var_2", qty: 1 }),
    ]);
  });

  it("clamps merged qty at 999", () => {
    useGuestCart.getState().add(line("var_1", 998));
    useGuestCart.getState().add(line("var_1", 5));
    expect(useGuestCart.getState().items[0].qty).toBe(999);
  });

  it("setQty(0) removes the line; remove() drops it", () => {
    useGuestCart.getState().add(line("var_1"));
    useGuestCart.getState().add(line("var_2"));
    useGuestCart.getState().setQty("var_1", 0);
    useGuestCart.getState().remove("var_2");
    expect(useGuestCart.getState().items).toEqual([]);
  });

  it("setQty clamps above the 999 max so a bad line can't poison the merge", () => {
    useGuestCart.getState().add(line("var_1"));
    useGuestCart.getState().setQty("var_1", 5000);
    expect(useGuestCart.getState().items[0].qty).toBe(999);
  });

  it("clear() empties the cart after merge", () => {
    useGuestCart.getState().add(line("var_1"));
    useGuestCart.getState().clear();
    expect(useGuestCart.getState().items).toEqual([]);
  });
});
