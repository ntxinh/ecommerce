"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

const MAX = 12;

type RecentlyViewedState = {
  /** Product ids, most recent first, capped at MAX. */
  ids: string[];
  record: (productId: string) => void;
};

// persist() tolerates a missing localStorage (SSR/test envs) via its default
// storage fallback — same convention as the guest cart.
export const useRecentlyViewed = create<RecentlyViewedState>()(
  persist(
    (set) => ({
      ids: [],
      record: (productId) =>
        set((s) => ({
          ids: [productId, ...s.ids.filter((id) => id !== productId)].slice(0, MAX),
        })),
    }),
    { name: "marketflow-recently-viewed" },
  ),
);
