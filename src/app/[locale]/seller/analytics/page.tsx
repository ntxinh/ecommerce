export const instant = false;

import { inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AnalyticsCharts } from "@/features/seller/analytics-charts";
import { Link, redirect } from "@/i18n/navigation";
import { formatVnd } from "@/lib/format";
import { AuthError } from "@/server/api/errors";
import { requireSeller } from "@/server/auth/actor";
import type { Actor } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import { shops } from "@/server/db/schema";
import { sellerAnalytics } from "@/server/modules/finance/analytics";

export default async function SellerAnalyticsPage({
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
  const d = sellerAnalytics(getDb(), actor, shopId);

  const t = await getTranslations({ locale, namespace: "seller" });
  const tf = await getTranslations({ locale, namespace: "finance" });
  const vnd = (n: number) => formatVnd(n, locale === "vi" ? "vi-VN" : "en-US");

  const metrics: { key: string; value: string; finance?: boolean }[] = [
    { key: "gmvVnd", value: vnd(d.gmvVnd) },
    { key: "netSalesVnd", value: vnd(d.netSalesVnd) },
    { key: "orderCount", value: String(d.orderCount) },
    { key: "unitsSold", value: String(d.unitsSold) },
    { key: "avgOrderValueVnd", value: vnd(d.avgOrderValueVnd) },
    { key: "cancelRatePct", value: `${d.cancelRatePct}%` },
    { key: "returnRatePct", value: `${d.returnRatePct}%` },
    { key: "lowStockCount", value: String(d.lowStockCount) },
    { key: "estimatedCommissionsVnd", value: vnd(d.estimatedCommissionsVnd), finance: true },
    { key: "pendingSettlementVnd", value: vnd(d.pendingSettlementVnd), finance: true },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("analyticsTitle")}</h1>
      {myShops.length > 1 ? (
        <nav className="flex gap-3 text-sm">
          {myShops.map((s) => (
            <Link
              key={s.id}
              href={`/seller/analytics?shop=${s.id}`}
              className={s.id === shopId ? "font-semibold underline" : "text-muted-foreground"}
            >
              {s.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {metrics.map((m) => (
          <Card key={m.key}>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                {(m.finance ? tf : t)(`metric.${m.key}`)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("revenueTrendTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsCharts daily={d.daily} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("bestSellersTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {d.bestSellers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("bestSellersEmpty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("colProduct")}</TableHead>
                  <TableHead className="text-right">{t("colUnits")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.bestSellers.map((b) => (
                  <TableRow key={b.productId}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell className="text-right">{b.units}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
