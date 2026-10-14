export const instant = false;

import { inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShopProfileForm } from "@/features/sellers/apply-form";
import { redirect } from "@/i18n/navigation";
import { AuthError } from "@/server/api/errors";
import { requireSeller } from "@/server/auth/actor";
import type { Actor } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import { shops } from "@/server/db/schema";

export default async function SellerSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
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
  const myShops = shopIds.length
    ? getDb().select().from(shops).where(inArray(shops.id, shopIds)).all()
    : [];
  const t = await getTranslations({ locale, namespace: "seller" });

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("settingsTitle")}</h1>
      {myShops.map((shop) => (
        <Card key={shop.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {shop.name} <span className="text-muted-foreground">({shop.slug})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ShopProfileForm shop={shop} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
