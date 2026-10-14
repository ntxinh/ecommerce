export const instant = false;

import { inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { ProductForm } from "@/features/seller/product-form";
import { redirect } from "@/i18n/navigation";
import { AuthError } from "@/server/api/errors";
import { requireSeller } from "@/server/auth/actor";
import type { Actor } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import { shops } from "@/server/db/schema";
import { listFormOptions } from "@/server/modules/catalog/manage";

export default async function NewProductPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
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
  const db = getDb();
  const myShops = db.select().from(shops).where(inArray(shops.id, shopIds)).all();
  const { categories, brands } = listFormOptions(db, locale);
  const t = await getTranslations({ locale, namespace: "seller" });

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("newProductTitle")}</h1>
      <ProductForm shops={myShops} categories={categories} brands={brands} />
    </div>
  );
}
