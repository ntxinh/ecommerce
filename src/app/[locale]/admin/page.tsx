export const instant = false;

import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatVnd } from "@/lib/format";
import { requireAdmin } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { adminDashboard } from "@/server/modules/admin/service";

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const actor = await requireAdmin(); // layout already guards; throws if regressed
  const d = adminDashboard(getDb(), actor);
  const t = await getTranslations({ locale, namespace: "admin" });
  const tn = await getTranslations({ locale, namespace: "nav" });

  const metrics: { key: string; value: string }[] = [
    { key: "ordersToday", value: String(d.ordersToday) },
    { key: "gmvVnd", value: formatVnd(d.gmvVnd, locale === "vi" ? "vi-VN" : "en-US") },
    { key: "customers", value: String(d.customerCount) },
    { key: "sellers", value: String(d.sellerCount) },
    { key: "pendingApplications", value: String(d.pendingApplications) },
    { key: "moderationQueue", value: String(d.moderationQueue) },
    { key: "pendingReturns", value: String(d.pendingReturns) },
    { key: "lowStock", value: String(d.lowStock) },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{tn("admin")}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => (
          <Card key={m.key}>
            <CardHeader>
              <CardTitle className="text-sm font-medium">{t(`metric.${m.key}`)}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
