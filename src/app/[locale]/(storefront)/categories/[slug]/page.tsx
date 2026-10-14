// Category reads the DB at request time; block instead of instant-shell.
export const instant = false;

import { notFound } from "next/navigation";
import { FiltersBar } from "@/features/catalog/filters-bar";
import { ProductList } from "@/features/catalog/product-list";
import { getDb } from "@/server/db/client";
import {
  getCategoryBySlug,
  listProducts,
  type ProductSort,
} from "@/server/modules/catalog/service";

const SORTS: ProductSort[] = ["newest", "price_asc", "price_desc", "rating"];

function num(v: string | undefined): number | undefined {
  if (!v?.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale, slug }, sp] = await Promise.all([params, searchParams]);
  const db = getDb();
  let category: { id: string; slug: string; nameEn: string; nameVi: string };
  try {
    category = getCategoryBySlug(db, slug);
  } catch {
    notFound();
  }

  const sort = SORTS.includes(sp.sort as ProductSort) ? (sp.sort as ProductSort) : undefined;
  const minPriceVnd = num(sp.minPriceVnd);
  const maxPriceVnd = num(sp.maxPriceVnd);
  const minRating = num(sp.minRating);
  const inStock = sp.inStock === "true" ? true : sp.inStock === "false" ? false : undefined;
  // Load-more echoes normalized params — raw values could 400 the API route.
  const query: Record<string, string> = { categoryId: category.id };
  if (sort) query.sort = sort;
  if (minPriceVnd != null) query.minPriceVnd = String(minPriceVnd);
  if (maxPriceVnd != null) query.maxPriceVnd = String(maxPriceVnd);
  if (minRating != null) query.minRating = String(minRating);
  if (inStock != null) query.inStock = String(inStock);
  let page: { items: Parameters<typeof ProductList>[0]["initial"]; nextCursor: string | null };
  try {
    page = listProducts(db, {
      categoryId: category.id,
      minPriceVnd,
      maxPriceVnd,
      minRating,
      inStock,
      sort,
      cursor: sp.cursor,
      limit: 12,
    });
  } catch {
    // malformed/mismatched cursor → refetch clean
    page = listProducts(db, {
      categoryId: category.id,
      minPriceVnd,
      maxPriceVnd,
      minRating,
      inStock,
      sort,
      limit: 12,
    });
  }

  return (
    <div className="space-y-6">
      <h1 className="font-semibold text-2xl">
        {locale === "vi" ? category.nameVi : category.nameEn}
      </h1>
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <FiltersBar mode="category" />
        <ProductList
          key={JSON.stringify(sp)}
          initial={page.items}
          nextCursor={page.nextCursor}
          endpoint="/api/v1/products"
          query={query}
        />
      </div>
    </div>
  );
}
