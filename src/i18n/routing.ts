import { defineRouting } from "next-intl/routing";

export const LOCALES = ["en", "vi"] as const;
export type Locale = (typeof LOCALES)[number];

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: "en",
});
