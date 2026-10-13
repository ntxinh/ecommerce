// Session read + params access are runtime data; block instead of instant-shell.
export const instant = false;

import { getTranslations } from "next-intl/server";
import { RegisterForm } from "@/features/auth/register-form";
import { Link, redirect } from "@/i18n/navigation";
import { currentActor } from "@/server/auth/actor";

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (await currentActor()) redirect({ href: "/", locale });

  const t = await getTranslations({ locale, namespace: "auth" });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("registerTitle")}</h1>
      <RegisterForm />
      <Link href="/login" className="block text-sm text-zinc-500 underline">
        {t("haveAccount")}
      </Link>
    </div>
  );
}
