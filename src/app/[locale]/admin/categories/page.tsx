export const instant = false;

import { getTranslations } from "next-intl/server";
import { CategoryTable } from "@/features/admin/category-table";
import { requireAdmin } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { listAdminCategories } from "@/server/modules/catalog/moderation";

export default async function AdminCategoriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const actor = await requireAdmin(); // layout already guards; throws if regressed
  const categories = listAdminCategories(getDb(), actor);
  const t = await getTranslations({ locale, namespace: "admin" });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("categoriesTitle")}</h1>
      <CategoryTable categories={categories} />
    </div>
  );
}
