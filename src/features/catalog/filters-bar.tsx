"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SORTS = {
  category: ["newest", "price_asc", "price_desc", "rating"],
  search: ["relevance", "price_asc", "price_desc", "rating", "newest", "popular"],
} as const;

/** Filter + sort controls; pushes a fresh querystring (cursor resets). */
export function FiltersBar({ mode }: { mode: keyof typeof SORTS }) {
  const t = useTranslations("storefront");
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [min, setMin] = useState(params.get("minPriceVnd") ?? "");
  const [max, setMax] = useState(params.get("maxPriceVnd") ?? "");

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("cursor"); // filter/sort changes start a fresh list
    startTransition(() => router.push(`?${next.toString()}`));
  };

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="space-y-1.5">
        <Label>{t("sortLabel")}</Label>
        <select
          value={params.get("sort") ?? (mode === "search" ? "relevance" : "newest")}
          onChange={(e) => push({ sort: e.target.value })}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {SORTS[mode].map((s) => (
            <option key={s} value={s}>
              {t(`sort.${s}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label>{t("priceRange")}</Label>
        <div className="flex items-center gap-2">
          <Input
            inputMode="numeric"
            placeholder={t("min")}
            value={min}
            onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))}
          />
          <span className="text-muted-foreground">–</span>
          <Input
            inputMode="numeric"
            placeholder={t("max")}
            value={max}
            onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>{t("minRating")}</Label>
        <select
          value={params.get("minRating") ?? ""}
          onChange={(e) => push({ minRating: e.target.value || null })}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="">{t("anyRating")}</option>
          {[4, 3, 2, 1].map((r) => (
            <option key={r} value={r}>
              {t("starsUp", { rating: r })}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={params.get("inStock") === "true"}
          onChange={(e) => push({ inStock: e.target.checked ? "true" : null })}
          className="size-4"
        />
        {t("inStockOnly")}
      </label>
      <Button
        className="w-full"
        onClick={() => push({ minPriceVnd: min || null, maxPriceVnd: max || null })}
      >
        {t("apply")}
      </Button>
      <Button
        variant="ghost"
        className="w-full"
        onClick={() => {
          const q = params.get("q");
          startTransition(() => router.push(q ? `?q=${encodeURIComponent(q)}` : "?"));
        }}
      >
        {t("clearFilters")}
      </Button>
    </div>
  );
}
