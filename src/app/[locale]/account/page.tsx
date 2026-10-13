export const instant = false;

import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { LogoutButton } from "@/features/auth/logout-button";
import { VerifyEmailButton } from "@/features/auth/verify-email-button";
import { redirect } from "@/i18n/navigation";
import { currentActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const userId = (await currentActor())?.userId ?? redirect({ href: "/login", locale });

  const user = getDb().select().from(users).where(eq(users.id, userId)).get();
  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <main className="mx-auto max-w-sm space-y-6 p-6">
      <h1 className="text-2xl font-semibold">{t("accountTitle")}</h1>
      <p className="text-sm text-zinc-500">
        {user?.name} — {user?.email}
      </p>
      <p className="text-sm">
        {t("verifyStatus")}: {user?.emailVerifiedAt ? t("verifyOk") : t("verifyPending")}
      </p>
      {!user?.emailVerifiedAt ? <VerifyEmailButton /> : null}
      <LogoutButton />
    </main>
  );
}
