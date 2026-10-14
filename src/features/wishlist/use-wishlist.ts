"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type WishlistState = {
  productIds: string[];
  /** Server ids loaded for the signed-in user; false until the first fetch resolves. */
  hydrated: boolean;
  toggle: (productId: string) => void;
  hydrate: (productIds: string[]) => void;
  clear: () => void;
};

// One store backs both modes: guests persist to localStorage; on login the
// header-hydrated server set replaces it, and login merges + clears the local
// copy. persist() tolerates a missing localStorage (SSR/test envs).
export const useWishlist = create<WishlistState>()(
  persist(
    (set) => ({
      productIds: [],
      hydrated: false,
      toggle: (productId) =>
        set((s) => ({
          productIds: s.productIds.includes(productId)
            ? s.productIds.filter((id) => id !== productId)
            : [...s.productIds, productId],
        })),
      hydrate: (productIds) => set({ productIds, hydrated: true }),
      clear: () => set({ productIds: [], hydrated: false }),
    }),
    {
      name: "marketflow-wishlist",
      // Only ids persist — `hydrated` must reset per load so the server list is fetched.
      partialize: (s) => ({ productIds: s.productIds }),
    },
  ),
);
