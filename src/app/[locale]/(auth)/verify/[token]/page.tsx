// Token consumption is a runtime mutation; block instead of instant-shell.
export const instant = false;

import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/server/db/client";
import { verifyEmail } from "@/server/modules/identity/service";

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  const verified = await verifyEmail(getDb(), token);
  const t = await getTranslations({ locale, namespace: "auth" });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("verifyTitle")}</h1>
      <p className={verified ? "text-green-700 dark:text-green-400" : "text-red-600"}>
        {t(verified ? "verifyOk" : "verifyFailed")}
      </p>
      <Link href="/account" className="block text-sm text-zinc-500 underline">
        {t("toAccount")}
      </Link>
    </div>
  );
}
