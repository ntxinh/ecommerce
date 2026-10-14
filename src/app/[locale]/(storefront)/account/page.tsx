export const instant = false;

import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { LogoutButton } from "@/features/auth/logout-button";
import { VerifyEmailButton } from "@/features/auth/verify-email-button";
import { Link, redirect } from "@/i18n/navigation";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const userId = (await getActor())?.userId ?? redirect({ href: "/login", locale });

  const user = getDb().select().from(users).where(eq(users.id, userId)).get();
  const t = await getTranslations({ locale, namespace: "auth" });
  const to = await getTranslations({ locale, namespace: "orders" });

  return (
    <section className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold">{t("accountTitle")}</h1>
      <p className="text-sm text-zinc-500">
        {user?.name} — {user?.email}
      </p>
      <p className="text-sm">
        {t("verifyStatus")}: {user?.emailVerifiedAt ? t("verifyOk") : t("verifyPending")}
      </p>
      <Link href="/account/orders" className="block text-sm underline underline-offset-2">
        {to("title")}
      </Link>
      {!user?.emailVerifiedAt ? <VerifyEmailButton /> : null}
      <LogoutButton />
    </section>
  );
}
