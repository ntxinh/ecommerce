"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ProductCard } from "@/features/catalog/product-card";
import { useRecentlyViewed } from "@/features/catalog/use-recently-viewed";
import type { ProductCard as ProductCardT } from "@/server/modules/catalog/service";

/** Horizontal rail of recently-viewed products; fetch hydrates cards from ids.
 *  Renders nothing until mounted and hydrated (persist store + fetch). */
export function RecentlyViewedRail({ excludeId }: { excludeId?: string }) {
  const t = useTranslations("storefront");
  const ids = useRecentlyViewed((s) => s.ids)
    .filter((id) => id !== excludeId)
    .slice(0, 8);
  const [items, setItems] = useState<ProductCardT[] | null>(null);
  const key = ids.join(",");

  useEffect(() => {
    if (!key) {
      setItems([]);
      return;
    }
    let live = true;
    setItems(null);
    fetch(`/api/v1/products?ids=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b: { data: { items: ProductCardT[] } }) => live && setItems(b.data.items))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [key]);

  if (!key || !items?.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-lg">{t("recentlyViewed")}</h2>
      <div className="flex snap-x gap-3 overflow-x-auto pb-2">
        {items.map((p) => (
          <div key={p.id} className="w-40 shrink-0 snap-start">
            <ProductCard product={p} />
          </div>
        ))}
      </div>
    </section>
  );
}
