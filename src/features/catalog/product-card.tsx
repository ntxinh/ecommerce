import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { RatingStars } from "@/features/catalog/rating-stars";
import { Link } from "@/i18n/navigation";
import { formatVnd } from "@/lib/format";
import type { ProductCard as ProductCardT } from "@/server/modules/catalog/service";

/** Product card; `flashPriceVnd` replaces the card price (homepage flash grid). */
export function ProductCard({
  product,
  flashPriceVnd,
}: {
  product: ProductCardT;
  flashPriceVnd?: number;
}) {
  const locale = useLocale();
  const t = useTranslations("storefront");
  const name = locale === "vi" ? product.nameVi : product.nameEn;
  return (
    <Card className="overflow-hidden pt-0">
      <Link href={`/products/${product.slug}`} className="block">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.imageAlt || name}
            className="aspect-square w-full object-cover"
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-muted text-muted-foreground text-xs">
            {name}
          </div>
        )}
      </Link>
      <CardContent className="space-y-1.5 px-3">
        <Link
          href={`/products/${product.slug}`}
          className="line-clamp-2 text-sm leading-snug underline-offset-2 hover:underline"
        >
          {name}
        </Link>
        <div className="flex items-baseline gap-2">
          {flashPriceVnd != null ? (
            <>
              <span className="font-semibold text-destructive">
                {formatVnd(flashPriceVnd, locale)}
              </span>
              <span className="text-muted-foreground text-xs line-through">
                {formatVnd(product.priceVnd, locale)}
              </span>
            </>
          ) : (
            <span className="font-semibold">{formatVnd(product.priceVnd, locale)}</span>
          )}
          {!product.inStock && (
            <span className="text-muted-foreground text-xs">{t("outOfStock")}</span>
          )}
        </div>
        <RatingStars avg={product.ratingAvg} count={product.ratingCount} />
        <p className="truncate text-muted-foreground text-xs">{product.shop.name}</p>
      </CardContent>
    </Card>
  );
}

export function ProductGrid({ products }: { products: ProductCardT[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
