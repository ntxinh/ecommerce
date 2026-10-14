export const instant = false;

import { inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { ProductTable } from "@/features/seller/product-table";
import { Link, redirect } from "@/i18n/navigation";
import { AuthError } from "@/server/api/errors";
import { requireSeller } from "@/server/auth/actor";
import type { Actor } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import { shops } from "@/server/db/schema";
import { listSellerProducts } from "@/server/modules/catalog/manage";

export default async function SellerProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ shop?: string }>;
}) {
  const { locale } = await params;
  const { shop } = await searchParams;
  let actor: Actor;
  try {
    actor = await requireSeller();
  } catch (e) {
    if (e instanceof AuthError && e.status === 403) redirect({ href: "/", locale });
    if (e instanceof AuthError) redirect({ href: "/login", locale });
    throw e;
  }

  const shopIds = actor.memberships.map((m) => m.shopId);
  if (shopIds.length === 0) redirect({ href: "/seller", locale });
  const myShops = getDb().select().from(shops).where(inArray(shops.id, shopIds)).all();
  const shopId = shop && shopIds.includes(shop) ? shop : shopIds[0];
  const items = listSellerProducts(getDb(), actor, shopId);

  const t = await getTranslations({ locale, namespace: "seller" });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("productsTitle")}</h1>
        <Button asChild>
          <Link href="/seller/products/new">{t("newProduct")}</Link>
        </Button>
      </div>
      {myShops.length > 1 ? (
        <nav className="flex gap-3 text-sm">
          {myShops.map((s) => (
            <Link
              key={s.id}
              href={`/seller/products?shop=${s.id}`}
              className={s.id === shopId ? "font-semibold underline" : "text-muted-foreground"}
            >
              {s.name}
            </Link>
          ))}
        </nav>
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("productsEmpty")}</p>
      ) : (
        <ProductTable items={items} t={t} locale={locale} />
      )}
    </div>
  );
}
