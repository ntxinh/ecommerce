export const instant = false;

import { inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProductForm } from "@/features/seller/product-form";
import { redirect } from "@/i18n/navigation";
import { AuthError } from "@/server/api/errors";
import { requireSeller } from "@/server/auth/actor";
import type { Actor } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import { shops } from "@/server/db/schema";
import {
  getSellerProduct,
  listFormOptions,
  type SellerProductDetail,
} from "@/server/modules/catalog/manage";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  let actor: Actor;
  try {
    actor = await requireSeller();
  } catch (e) {
    if (e instanceof AuthError && e.status === 403) redirect({ href: "/", locale });
    if (e instanceof AuthError) redirect({ href: "/login", locale });
    throw e;
  }
  const db = getDb();
  let product: SellerProductDetail;
  try {
    product = getSellerProduct(db, actor, id);
  } catch (e) {
    // Cross-shop product reads are FORBIDDEN — same 404 surface as missing.
    if (e instanceof AuthError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const shopIds = actor.memberships.map((m) => m.shopId);
  const myShops = db.select().from(shops).where(inArray(shops.id, shopIds)).all();
  const { categories, brands } = listFormOptions(db, locale);
  const t = await getTranslations({ locale, namespace: "seller" });

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("editProductTitle")}</h1>
      <ProductForm
        shops={myShops}
        categories={categories}
        brands={brands}
        product={{
          id: product.id,
          nameEn: product.nameEn,
          nameVi: product.nameVi,
          descriptionEn: product.descriptionEn,
          descriptionVi: product.descriptionVi,
          categoryId: product.categoryId,
          brandId: product.brandId,
          variants: product.variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            nameEn: v.nameEn,
            nameVi: v.nameVi,
            attrsJson: JSON.stringify(v.attrs),
            basePriceVnd: String(v.basePriceVnd),
            salePriceVnd: v.salePriceVnd == null ? "" : String(v.salePriceVnd),
            stock: String(v.onHand),
            baseline: String(v.onHand),
          })),
        }}
      />
    </div>
  );
}
