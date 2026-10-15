export const instant = false;

import { getTranslations } from "next-intl/server";
import { SettingsForm } from "@/features/admin/settings-form";
import { requireAdmin } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { ADMIN_SETTING_KEYS, getSettings } from "@/server/modules/admin/ops";

export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const actor = await requireAdmin(); // layout already guards; throws if regressed
  const values = getSettings(getDb(), actor);
  const t = await getTranslations({ locale, namespace: "admin" });

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("settingsTitle")}</h1>
      <p className="text-sm text-muted-foreground">{t("settingsHint")}</p>
      <SettingsForm keys={Object.keys(ADMIN_SETTING_KEYS)} values={values} />
    </div>
  );
}
