// Params access is runtime data; block instead of instant-shell.
export const instant = false;

import { getTranslations } from "next-intl/server";
import { ResetRequestForm } from "@/features/auth/reset-request-form";
import { Link } from "@/i18n/navigation";

export default async function ResetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("resetTitle")}</h1>
      <ResetRequestForm />
      <Link href="/login" className="block text-sm text-zinc-500 underline">
        {t("backToSignIn")}
      </Link>
    </div>
  );
}
