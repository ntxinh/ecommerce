export const instant = false;

import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { redirect } from "@/i18n/navigation";
import { AuthError } from "@/server/api/errors";
import { requireAdmin } from "@/server/auth/actor";

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Layout already guards; redirect defensively if this ever renders without one.
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) redirect({ href: "/login", locale });
    throw e;
  }
  const tn = await getTranslations({ locale, namespace: "nav" });
  const ts = await getTranslations({ locale, namespace: "shell" });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{tn("admin")}</h1>
      <Badge variant="secondary">{ts("metricsPlanned")}</Badge>
      <div className="grid gap-4 sm:grid-cols-3">
        {["usersPlanned", "ordersPlanned", "productsPlanned"].map((key) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="text-sm font-medium">{ts(key)}</CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
