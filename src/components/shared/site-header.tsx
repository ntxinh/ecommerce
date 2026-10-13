import { ShoppingCartIcon, UserIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeSwitcher } from "./theme-switcher";

export async function SiteHeader({ locale }: { locale: string }) {
  const tc = await getTranslations({ locale, namespace: "common" });
  const tn = await getTranslations({ locale, namespace: "nav" });
  const ts = await getTranslations({ locale, namespace: "shell" });

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
        <Link href="/" className="text-lg font-semibold">
          {tc("appName")}
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/seller" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {tn("sellerCenter")}
          </Link>
          <Link href="/admin" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {tn("admin")}
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative hidden sm:block">
            <Input
              type="search"
              placeholder={ts("searchPlaceholder")}
              disabled
              className="w-48"
              aria-label={ts("searchPlaceholder")}
            />
            <Badge variant="secondary" className="absolute top-1/2 right-1 -translate-y-1/2">
              {ts("planned")}
            </Badge>
          </div>
          <Link
            href="/cart"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            aria-label={tn("cart")}
          >
            <ShoppingCartIcon />
          </Link>
          <Link
            href="/account"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            aria-label={tn("account")}
          >
            <UserIcon />
          </Link>
          <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {tc("signIn")}
          </Link>
          <LocaleSwitcher />
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  );
}
