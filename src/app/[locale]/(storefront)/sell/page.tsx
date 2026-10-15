export const instant = false;

import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApplyForm } from "@/features/sellers/apply-form";
import { redirect } from "@/i18n/navigation";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { myApplication } from "@/server/modules/sellers/service";

export default async function SellPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const actor = await getActor();
  if (!actor) redirect({ href: "/login", locale });

  const app = myApplication(getDb(), actor);
  const t = await getTranslations({ locale, namespace: "sellers" });

  // Editable when no live decision blocks it; the form doubles as resubmit.
  const editable = !app || app.status === "CHANGES_REQUESTED" || app.status === "REJECTED";
  let defaults: { shopName: string; description: string; registration: string } | undefined;
  if (editable && app) {
    let info: Record<string, string> = {};
    try {
      info = JSON.parse(app.businessInfo);
    } catch {
      // Malformed JSON — the form just starts empty.
    }
    defaults = {
      shopName: app.shopName,
      description: info.description ?? "",
      registration: info.registration ?? "",
    };
  }

  return (
    <section className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {app ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {t("currentStatus")}
              <Badge variant="outline">{t(`status.${app.status}`)}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{app.shopName}</p>
            <p className="text-muted-foreground">{t(`statusHint.${app.status}`)}</p>
            {app.decisionNote ? (
              <p className="text-muted-foreground">
                {t("decisionNote")}: {app.decisionNote}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {editable ? <ApplyForm defaults={defaults} /> : null}
    </section>
  );
}
