// cacheComponents: params access must not block the instant shell; this
// placeholder renders only after navigation completes.
export const instant = false;

import { getTranslations } from "next-intl/server";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-3xl font-semibold">{t("appName")}</h1>
    </main>
  );
}
