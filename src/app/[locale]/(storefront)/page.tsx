// cacheComponents: params access must not block the instant shell; this
// placeholder renders only after navigation completes.
export const instant = false;

import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const tc = await getTranslations({ locale, namespace: "common" });
  const ts = await getTranslations({ locale, namespace: "shell" });
  return (
    <section className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-3xl font-semibold">{tc("appName")}</h1>
      <Badge variant="secondary">{ts("catalogPlanned")}</Badge>
    </section>
  );
}
