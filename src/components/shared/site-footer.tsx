import { getTranslations } from "next-intl/server";
import { Separator } from "@/components/ui/separator";

export async function SiteFooter({ locale }: { locale: string }) {
  const tc = await getTranslations({ locale, namespace: "common" });
  const ts = await getTranslations({ locale, namespace: "shell" });

  return (
    <footer className="mt-auto">
      <Separator />
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 text-sm text-muted-foreground">
        <span>© {tc("appName")}</span>
        <span>{ts("footerTagline")}</span>
      </div>
    </footer>
  );
}
