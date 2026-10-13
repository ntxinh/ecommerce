// Token consumption is a runtime mutation; block instead of instant-shell.
export const instant = false;

import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/server/db/client";
import { isConsumedVerifyToken, verifyEmail } from "@/server/modules/identity/service";

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  // One-shot token: a refresh after first consumption still shows success if the user is verified.
  const verified = (await verifyEmail(getDb(), token)) || isConsumedVerifyToken(getDb(), token);
  const t = await getTranslations({ locale, namespace: "auth" });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("verifyTitle")}</h1>
      <p className={verified ? "text-primary" : "text-destructive"}>
        {t(verified ? "verifyOk" : "verifyFailed")}
      </p>
      <Link href="/account" className="block text-sm text-muted-foreground underline">
        {t("toAccount")}
      </Link>
    </div>
  );
}
