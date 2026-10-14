// Homepage reads the DB at request time; block instead of instant-shell.
export const instant = false;

import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { Countdown } from "@/features/catalog/countdown";
import { ProductCard, ProductGrid } from "@/features/catalog/product-card";
import { RecentlyViewedRail } from "@/features/catalog/recently-viewed";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/server/db/client";
import { type CategoryNode, getHomepageData } from "@/server/modules/catalog/service";

function flatten(nodes: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  for (const n of nodes) out.push(n, ...flatten(n.children));
  return out;
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await connection(); // flash-sale windows use Date.now() — request-time render
  const t = await getTranslations({ locale, namespace: "storefront" });
  const { categories, flashSale, featuredShops, trending, newest } = getHomepageData(getDb());
  const catName = (c: CategoryNode) => (locale === "vi" ? c.nameVi : c.nameEn);
  const flashEnds = flashSale.length ? Math.min(...flashSale.map((f) => f.flashEndsAt)) : null;

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">{t("categories")}</h2>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {flatten(categories).map((c) => (
            <Link
              key={c.id}
              href={`/categories/${c.slug}`}
              className="shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              {catName(c)}
            </Link>
          ))}
        </div>
      </section>

      {flashSale.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-lg text-destructive">{t("flashSale")}</h2>
            {flashEnds && <Countdown endsAt={flashEnds} />}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {flashSale.map((f) => (
              <ProductCard key={f.productId} product={f.card} flashPriceVnd={f.flashPriceVnd} />
            ))}
          </div>
        </section>
      )}

      {featuredShops.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-lg">{t("featuredShops")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featuredShops.map((s) => (
              <Card key={s.id}>
                <CardContent className="space-y-1 px-4">
                  <Link
                    href={`/shops/${s.slug}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {s.name}
                  </Link>
                  {s.description && (
                    <p className="line-clamp-2 text-muted-foreground text-sm">{s.description}</p>
                  )}
                  <p className="text-muted-foreground text-xs">
                    {t("productCount", { count: s.productCount })}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {trending.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-lg">{t("trending")}</h2>
          <ProductGrid products={trending} />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">{t("newest")}</h2>
        <ProductGrid products={newest.items} />
      </section>

      <RecentlyViewedRail />
    </div>
  );
}
