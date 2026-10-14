"use client";

import { create } from "zustand";

export const CHECKOUT_STEPS = ["address", "shipping", "payment", "review"] as const;
export type CheckoutStep = (typeof CHECKOUT_STEPS)[number];

/** Step position only — all field values stay in the form's FormData. */
export const useCheckoutStep = create<{
  step: number;
  goTo: (step: number) => void;
}>()((set) => ({ step: 0, goTo: (step) => set({ step }) }));
