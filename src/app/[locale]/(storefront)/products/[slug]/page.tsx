// Product reads the DB + session cookie at request time; block instead of instant-shell.
export const instant = false;

import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { AddToCart, type ProductVariantOption } from "@/features/cart/add-to-cart";
import { Countdown } from "@/features/catalog/countdown";
import { Gallery } from "@/features/catalog/gallery";
import { ProductCard } from "@/features/catalog/product-card";
import { RatingStars } from "@/features/catalog/rating-stars";
import { RecordView } from "@/features/catalog/record-view";
import { Link } from "@/i18n/navigation";
import { formatDate, formatVnd } from "@/lib/format";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import {
  getProductBySlug,
  listProductReviews,
  listProducts,
  type ProductDetail,
  type ReviewView,
} from "@/server/modules/catalog/service";

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale, slug }, sp] = await Promise.all([params, searchParams]);
  await connection(); // flash-sale window uses Date.now() — request-time render
  const t = await getTranslations({ locale, namespace: "storefront" });
  const db = getDb();
  let product: ProductDetail;
  try {
    product = getProductBySlug(db, slug);
  } catch {
    notFound();
  }
  const name = locale === "vi" ? product.nameVi : product.nameEn;
  const description = locale === "vi" ? product.descriptionVi : product.descriptionEn;

  const variants: ProductVariantOption[] = product.variants.map((v) => ({
    id: v.id,
    name: locale === "vi" ? v.nameVi : v.nameEn,
    sku: v.sku,
    priceVnd: product.flashSale ? product.flashSale.priceVnd : v.priceVnd,
    available: v.available,
  }));

  let reviews: { items: ReviewView[]; nextCursor: string | null } = {
    items: [],
    nextCursor: null,
  };
  try {
    reviews = listProductReviews(db, product.id, { cursor: sp.rc, limit: 10 });
  } catch {
    reviews = listProductReviews(db, product.id, { limit: 10 });
  }
  const related = listProducts(db, {
    categoryId: product.categoryId,
    sort: "newest",
    limit: 5,
  })
    .items.filter((p) => p.id !== product.id)
    .slice(0, 4);
  const actor = await getActor();
  const minPrice = Math.min(...product.variants.map((v) => v.priceVnd));

  return (
    <article className="space-y-10">
      <RecordView productId={product.id} />
      <div className="grid gap-8 md:grid-cols-2">
        <Gallery images={product.images} fallbackAlt={name} />
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Link href={`/shops/${product.shop.slug}`}>
                <Badge variant="secondary">{product.shop.name}</Badge>
              </Link>
              {product.flashSale && <Countdown endsAt={product.flashSale.endsAt} />}
            </div>
            <h1 className="font-semibold text-2xl">{name}</h1>
            <RatingStars avg={product.rating.avg} count={product.rating.count} />
          </div>
          {product.flashSale ? (
            <p className="text-lg">
              <span className="font-semibold text-destructive">
                {formatVnd(product.flashSale.priceVnd, locale)}
              </span>{" "}
              <span className="text-muted-foreground text-sm line-through">
                {formatVnd(minPrice, locale)}
              </span>
            </p>
          ) : (
            <p className="font-medium text-lg">
              {t("fromPrice")} {formatVnd(minPrice, locale)}
            </p>
          )}
          <AddToCart
            productName={name}
            shopName={product.shop.name}
            variants={variants}
            loggedIn={!!actor}
          />
        </div>
      </div>

      {description && (
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">{t("description")}</h2>
          <p className="whitespace-pre-line text-muted-foreground text-sm">{description}</p>
        </section>
      )}

      {product.attributes.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold text-lg">{t("attributes")}</h2>
          <Table>
            <TableBody>
              {product.attributes.map((a) => (
                <TableRow key={`${a.name}:${a.value}`}>
                  <TableCell className="w-48 text-muted-foreground">{a.name}</TableCell>
                  <TableCell>{a.value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">{t("reviews")}</h2>
        {product.rating.count > 0 && (
          <p className="text-muted-foreground text-sm">
            {t("ratingSummary", {
              avg: product.rating.avg?.toFixed(1) ?? "–",
              count: product.rating.count,
            })}
          </p>
        )}
        {reviews.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noReviews")}</p>
        ) : (
          <ul className="space-y-3">
            {reviews.items.map((r) => (
              <Card key={r.id}>
                <CardContent className="space-y-1 px-4">
                  <div className="flex items-center gap-2">
                    <RatingStars avg={r.rating} />
                    <span className="font-medium text-sm">{r.authorName}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatDate(r.createdAt, locale)}
                    </span>
                  </div>
                  {r.title && <p className="font-medium text-sm">{r.title}</p>}
                  {r.body && <p className="text-muted-foreground text-sm">{r.body}</p>}
                </CardContent>
              </Card>
            ))}
          </ul>
        )}
        {reviews.nextCursor && (
          <Link
            href={`/products/${product.slug}?rc=${reviews.nextCursor}`}
            className="inline-block text-sm underline-offset-2 hover:underline"
          >
            {t("moreReviews")}
          </Link>
        )}
      </section>

      <Card>
        <CardContent className="flex items-center justify-between gap-4 px-4">
          <div className="min-w-0">
            <p className="font-medium">{product.shop.name}</p>
            {product.shop.description && (
              <p className="line-clamp-2 text-muted-foreground text-sm">
                {product.shop.description}
              </p>
            )}
          </div>
          <Link
            href={`/shops/${product.shop.slug}`}
            className="shrink-0 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            {t("visitShop")}
          </Link>
        </CardContent>
      </Card>

      {related.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-lg">{t("relatedProducts")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
