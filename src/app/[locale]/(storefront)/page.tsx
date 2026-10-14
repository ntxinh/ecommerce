// cacheComponents: params access must not block the instant shell; this
// placeholder renders only after navigation completes.
export const instant = false;

import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { formatVnd } from "@/lib/format";
import { getDb } from "@/server/db/client";
import { products, productVariants, shops } from "@/server/db/schema";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const tc = await getTranslations({ locale, namespace: "common" });
  const t = await getTranslations({ locale, namespace: "catalog" });

  const rows = getDb()
    .select({
      slug: products.slug,
      nameEn: products.nameEn,
      nameVi: products.nameVi,
      shopName: shops.name,
      salePrice: productVariants.salePriceVnd,
      basePrice: productVariants.basePriceVnd,
    })
    .from(products)
    .innerJoin(shops, eq(shops.id, products.shopId))
    .innerJoin(productVariants, eq(productVariants.productId, products.id))
    .where(eq(products.status, "ACTIVE"))
    .all();

  const cards = new Map<string, { slug: string; name: string; shop: string; price: number }>();
  for (const r of rows) {
    const name = locale === "vi" ? r.nameVi : r.nameEn;
    const price = r.salePrice ?? r.basePrice;
    const prev = cards.get(r.slug);
    if (!prev || price < prev.price) {
      cards.set(r.slug, { slug: r.slug, name, shop: r.shopName, price });
    }
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("products")}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...cards.values()].map((p) => (
          <Card key={p.slug}>
            <CardHeader>
              <CardTitle className="text-base">
                <Link href={`/products/${p.slug}`} className="underline-offset-2 hover:underline">
                  {p.name}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="text-muted-foreground">{p.shop}</p>
              <p className="font-medium">
                {t("fromPrice")} {formatVnd(p.price, locale)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{tc("appName")}</p>
    </section>
  );
}
