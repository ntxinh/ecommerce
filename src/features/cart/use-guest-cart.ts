"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Snapshot fields needed to render a guest cart line; the server re-prices
 *  everything at merge/checkout, so these are display-only. */
export type GuestCartLine = {
  variantId: string;
  qty: number;
  name: string;
  sku: string;
  unitPriceVnd: number;
  shopName: string;
};

type GuestCartState = {
  items: GuestCartLine[];
  add: (line: GuestCartLine) => void;
  setQty: (variantId: string, qty: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
};

// persist() tolerates a missing localStorage (SSR/test envs) via its default
// storage fallback, so the store is safe to import anywhere.
export const useGuestCart = create<GuestCartState>()(
  persist(
    (set) => ({
      items: [],
      add: (line) =>
        set((s) => {
          const existing = s.items.find((i) => i.variantId === line.variantId);
          if (existing) {
            return {
              items: s.items.map((i) =>
                i.variantId === line.variantId ? { ...i, qty: Math.min(999, i.qty + line.qty) } : i,
              ),
            };
          }
          return { items: [...s.items, line] };
        }),
      setQty: (variantId, qty) =>
        set((s) => ({
          items:
            qty <= 0
              ? s.items.filter((i) => i.variantId !== variantId)
              : s.items.map((i) => (i.variantId === variantId ? { ...i, qty } : i)),
        })),
      remove: (variantId) =>
        set((s) => ({ items: s.items.filter((i) => i.variantId !== variantId) })),
      clear: () => set({ items: [] }),
    }),
    { name: "marketflow-guest-cart" },
  ),
);
