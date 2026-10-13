// Params (token) access is runtime data; block instead of instant-shell.
export const instant = false;

import { getTranslations } from "next-intl/server";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";
import { Link } from "@/i18n/navigation";

export default async function ResetTokenPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("resetTitle")}</h1>
      <ResetPasswordForm token={token} />
      <Link href="/login" className="block text-sm text-zinc-500 underline">
        {t("backToSignIn")}
      </Link>
    </div>
  );
}
