// Session read + params access are runtime data; block instead of instant-shell.
export const instant = false;

import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/features/auth/login-form";
import { Link, redirect } from "@/i18n/navigation";
import { currentActor } from "@/server/auth/actor";

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (await currentActor()) redirect({ href: "/", locale });

  const t = await getTranslations({ locale, namespace: "auth" });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("loginTitle")}</h1>
      <LoginForm />
      <div className="space-y-1 text-sm">
        <Link href="/reset" className="block text-zinc-500 underline">
          {t("forgot")}
        </Link>
        <Link href="/register" className="block text-zinc-500 underline">
          {t("noAccount")}
        </Link>
      </div>
    </div>
  );
}
