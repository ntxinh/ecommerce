// Shop reads the DB at request time; block instead of instant-shell.
export const instant = false;

import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FiltersBar } from "@/features/catalog/filters-bar";
import { ProductList } from "@/features/catalog/product-list";
import { getDb } from "@/server/db/client";
import {
  getShopBySlug,
  listShopProducts,
  type ProductCard,
  type ProductSort,
  type ShopCard,
} from "@/server/modules/catalog/service";

const SORTS: ProductSort[] = ["newest", "price_asc", "price_desc", "rating"];

function num(v: string | undefined): number | undefined {
  if (!v?.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale, slug }, sp] = await Promise.all([params, searchParams]);
  const t = await getTranslations({ locale, namespace: "storefront" });
  const db = getDb();

  let shop: ShopCard;
  try {
    shop = getShopBySlug(db, slug);
  } catch {
    notFound();
  }

  const sort = SORTS.includes(sp.sort as ProductSort) ? (sp.sort as ProductSort) : undefined;
  const query: Record<string, string> = { shopId: shop.id };
  for (const k of ["minPriceVnd", "maxPriceVnd", "minRating", "inStock", "sort"] as const) {
    if (sp[k]) query[k] = sp[k]!;
  }
  let page: { items: ProductCard[]; nextCursor: string | null };
  try {
    page = listShopProducts(db, shop.id, {
      minPriceVnd: num(sp.minPriceVnd),
      maxPriceVnd: num(sp.maxPriceVnd),
      minRating: num(sp.minRating),
      inStock: sp.inStock === "true" ? true : sp.inStock === "false" ? false : undefined,
      sort,
      cursor: sp.cursor,
      limit: 12,
    });
  } catch {
    page = listShopProducts(db, shop.id, { sort, limit: 12 });
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2 rounded-md bg-muted px-6 py-8">
        <h1 className="font-semibold text-2xl">{shop.name}</h1>
        {shop.description && <p className="text-muted-foreground">{shop.description}</p>}
        <p className="text-muted-foreground text-sm">
          {t("productCount", { count: shop.productCount })}
        </p>
      </header>
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
