export const instant = false;

import { desc, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PromotionForm } from "@/features/admin/promotion-form";
import { redirect } from "@/i18n/navigation";
import { formatDate, formatVnd } from "@/lib/format";
import { AuthError } from "@/server/api/errors";
import { requireSeller } from "@/server/auth/actor";
import type { Actor } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import { promotions, shops } from "@/server/db/schema";

export default async function SellerPromotionsPage({
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
  const db = getDb();
  const shopIds = actor.memberships.map((m) => m.shopId);
  const myShops = shopIds.length
    ? db.select().from(shops).where(inArray(shops.id, shopIds)).all()
    : [];
  const rows = shopIds.length
    ? db
        .select()
        .from(promotions)
        .where(inArray(promotions.shopId, shopIds))
        .orderBy(desc(promotions.id))
        .limit(50)
        .all()
    : [];
  const t = await getTranslations({ locale, namespace: "seller" });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("promotions.title")}</h1>
      {myShops.length > 0 ? <PromotionForm scopes={["SHOP"]} shops={myShops} /> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("promotions.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("promotions.colKind")}</TableHead>
              <TableHead className="text-right">{t("promotions.fieldValue")}</TableHead>
              <TableHead>{t("promotions.colWindow")}</TableHead>
              <TableHead>{t("promotions.colStatus")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{t(`promotions.kind.${p.kind}`)}</TableCell>
                <TableCell className="text-right">
                  {p.kind === "PERCENT" ? `${p.value / 100}%` : formatVnd(p.value, locale)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(p.startsAt, locale)} – {formatDate(p.endsAt, locale)}
                </TableCell>
                <TableCell>
                  <Badge variant={p.status === "ACTIVE" ? "default" : "secondary"}>
                    {p.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
