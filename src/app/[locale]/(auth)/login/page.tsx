// Session read + params access are runtime data; block instead of instant-shell.
export const instant = false;

import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/features/auth/login-form";
import { Link, redirect } from "@/i18n/navigation";
import { getActor } from "@/server/auth/actor";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  // Post-login target: honor the same validated `next` the action returns —
  // this page re-renders with a live session during the action round-trip.
  const dest = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (await getActor()) redirect({ href: dest, locale });

  const t = await getTranslations({ locale, namespace: "auth" });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("loginTitle")}</h1>
      <LoginForm next={next} />
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
