// Search reads the DB at request time; block instead of instant-shell.
export const instant = false;

import { getTranslations } from "next-intl/server";
import { FiltersBar } from "@/features/catalog/filters-bar";
import { ProductList } from "@/features/catalog/product-list";
import { getDb } from "@/server/db/client";
import { type SearchSort, search } from "@/server/modules/search/service";

const SORTS: SearchSort[] = ["relevance", "price_asc", "price_desc", "rating", "newest", "popular"];

function num(v: string | undefined): number | undefined {
  if (!v?.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  const t = await getTranslations({ locale, namespace: "storefront" });
  const q = sp.q?.trim() ?? "";

  if (!q) {
    return (
      <div className="space-y-4">
        <h1 className="font-semibold text-2xl">{t("searchTitle")}</h1>
        <p className="text-muted-foreground">{t("searchPrompt")}</p>
      </div>
    );
  }

  const sort = SORTS.includes(sp.sort as SearchSort) ? (sp.sort as SearchSort) : undefined;
  const minPriceVnd = num(sp.minPriceVnd);
  const maxPriceVnd = num(sp.maxPriceVnd);
  const minRating = num(sp.minRating);
  const inStock = sp.inStock === "true" ? true : sp.inStock === "false" ? false : undefined;
  // Load-more echoes normalized params — raw values could 400 the API route.
  const query: Record<string, string> = { q };
  if (sort) query.sort = sort;
  if (minPriceVnd != null) query.minPriceVnd = String(minPriceVnd);
  if (maxPriceVnd != null) query.maxPriceVnd = String(maxPriceVnd);
  if (minRating != null) query.minRating = String(minRating);
  if (inStock != null) query.inStock = String(inStock);
  let result: { items: Parameters<typeof ProductList>[0]["initial"]; nextCursor: string | null };
  try {
    result = search(getDb(), {
      q,
      minPriceVnd,
      maxPriceVnd,
      minRating,
      inStock,
      sort,
      cursor: sp.cursor,
      limit: 12,
    });
  } catch {
    // malformed/mismatched cursor → refetch without it
    result = search(getDb(), { q, minPriceVnd, maxPriceVnd, minRating, inStock, sort, limit: 12 });
  }

  return (
    <div className="space-y-6">
      <h1 className="font-semibold text-2xl">{t("resultsFor", { q })}</h1>
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <FiltersBar mode="search" />
        <ProductList
          key={JSON.stringify(sp)}
          initial={result.items}
          nextCursor={result.nextCursor}
          endpoint="/api/v1/search"
          query={query}
        />
      </div>
    </div>
  );
}
