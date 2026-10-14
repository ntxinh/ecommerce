export const instant = false;

import { inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link, redirect } from "@/i18n/navigation";
import { AuthError } from "@/server/api/errors";
import { requireSeller } from "@/server/auth/actor";
import type { Actor } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import { shops } from "@/server/db/schema";

export default async function SellerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Layout already guards; redirect defensively if this ever renders without one.
  let actor: Actor;
  try {
    actor = await requireSeller();
  } catch (e) {
    if (e instanceof AuthError && e.status === 403) redirect({ href: "/", locale });
    if (e instanceof AuthError) redirect({ href: "/login", locale });
    throw e;
  }
  const shopIds = actor.memberships.map((m) => m.shopId);
  const ownedShops =
    shopIds.length > 0 ? getDb().select().from(shops).where(inArray(shops.id, shopIds)).all() : [];

  const tn = await getTranslations({ locale, namespace: "nav" });
  const tSeller = await getTranslations({ locale, namespace: "seller" });
  const ts = await getTranslations({ locale, namespace: "shell" });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{tn("sellerCenter")}</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {ownedShops.map((shop) => (
          <Card key={shop.id}>
            <CardHeader>
              <CardTitle>{shop.name}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {shop.slug} — {shop.status}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        <Badge variant="outline">
          <Link href="/seller/products">{tSeller("productsTitle")}</Link>
        </Badge>
        <Badge variant="outline">{ts("ordersPlanned")}</Badge>
      </div>
    </div>
  );
}
