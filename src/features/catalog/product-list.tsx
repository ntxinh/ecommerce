"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ProductGrid } from "@/features/catalog/product-card";
import type { ProductCard } from "@/server/modules/catalog/service";

type Page = { items: ProductCard[]; nextCursor: string | null };

/** SSR'd grid + cursor "load more" appended via GET on `endpoint`
 *  (`/api/v1/products` or `/api/v1/search`). Parent must key this component by
 *  its query params so filter changes reset state. */
export function ProductList({
  initial,
  nextCursor,
  endpoint,
  query,
}: {
  initial: ProductCard[];
  nextCursor: string | null;
  endpoint: "/api/v1/products" | "/api/v1/search";
  /** Query params the server used (minus cursor/limit) — echoed on fetch. */
  query: Record<string, string>;
}) {
  const t = useTranslations("storefront");
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(nextCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadMore = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ ...query, cursor, limit: "12" });
      const res = await fetch(`${endpoint}?${params}`);
      if (!res.ok) throw new Error(String(res.status));
      const page: { data: Page } = await res.json();
      setItems((prev) => [...prev, ...page.data.items]);
      setCursor(page.data.nextCursor);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {items.length ? (
        <ProductGrid products={items} />
      ) : (
        <p className="py-8 text-center text-muted-foreground text-sm">{t("noResults")}</p>
      )}
      {cursor && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loading}>
            {loading ? "…" : t("loadMore")}
          </Button>
        </div>
      )}
      {failed && <p className="text-center text-destructive text-sm">{t("loadFailed")}</p>}
    </div>
  );
}
