export const instant = false;

import { getTranslations } from "next-intl/server";
import { ProductGrid } from "@/features/catalog/product-card";
import { redirect } from "@/i18n/navigation";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { listWishlistCards } from "@/server/modules/cart/wishlist";

export default async function WishlistPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const actor = (await getActor()) ?? redirect({ href: "/login", locale });
  const cards = listWishlistCards(getDb(), actor.userId);
  const t = await getTranslations({ locale, namespace: "storefront" });

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("wishlist.title")}</h1>
      {cards.length ? (
        <ProductGrid products={cards} />
      ) : (
        <p className="text-muted-foreground text-sm">{t("wishlist.empty")}</p>
      )}
    </section>
  );
}
