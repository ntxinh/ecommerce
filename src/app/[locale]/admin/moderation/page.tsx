export const instant = false;

import { getTranslations } from "next-intl/server";
import { ModerationTable } from "@/features/admin/moderation-table";
import { ReviewModerationTable } from "@/features/admin/review-moderation-table";
import { requireAdmin } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { listModerationQueue } from "@/server/modules/catalog/moderation";
import { listReviewModerationQueue } from "@/server/modules/reviews/service";

export default async function AdminModerationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const actor = await requireAdmin(); // layout already guards; throws if regressed
  const rows = listModerationQueue(getDb(), actor);
  const reviewRows = listReviewModerationQueue(getDb(), actor);
  const t = await getTranslations({ locale, namespace: "admin" });
  const tr = await getTranslations({ locale, namespace: "reviews" });

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{t("moderationTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("moderationHint")}</p>
        <ModerationTable rows={rows} />
      </div>
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">{tr("moderationTitle")}</h2>
        <p className="text-sm text-muted-foreground">{tr("moderationHint")}</p>
        <ReviewModerationTable rows={reviewRows} locale={locale} />
      </div>
    </div>
  );
}
