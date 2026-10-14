// getActor reads the session cookie at request time; block instead of instant-shell.
export const instant = false;

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { AddToCart, type ProductVariantOption } from "@/features/cart/add-to-cart";
import { formatVnd } from "@/lib/format";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { products, productVariants, shops } from "@/server/db/schema";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const db = getDb();

  const product = db
    .select({ p: products, shopName: shops.name })
    .from(products)
    .innerJoin(shops, eq(shops.id, products.shopId))
    .where(eq(products.slug, slug))
    .get();
  if (product?.p.status !== "ACTIVE") notFound();

  const variants: ProductVariantOption[] = db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, product.p.id))
    .all()
    .map((v) => ({
      id: v.id,
      name: locale === "vi" ? v.nameVi : v.nameEn,
      sku: v.sku,
      priceVnd: v.salePriceVnd ?? v.basePriceVnd,
    }));

  const t = await getTranslations({ locale, namespace: "catalog" });
  const actor = await getActor();

  return (
    <article className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <Badge variant="secondary">{product.shopName}</Badge>
        <h1 className="text-2xl font-semibold">
          {locale === "vi" ? product.p.nameVi : product.p.nameEn}
        </h1>
        <p className="text-muted-foreground">
          {locale === "vi" ? product.p.descriptionVi : product.p.descriptionEn}
        </p>
      </header>
      <p className="text-lg font-medium">
        {t("fromPrice")} {formatVnd(variants[0]?.priceVnd ?? 0, locale)}
      </p>
      <AddToCart
        productName={locale === "vi" ? product.p.nameVi : product.p.nameEn}
        shopName={product.shopName}
        variants={variants}
        loggedIn={!!actor}
      />
    </article>
  );
}
