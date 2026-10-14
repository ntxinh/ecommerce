import { ShoppingCartIcon, UserIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { CartBadge } from "@/features/cart/cart-badge";
import { SearchBox } from "@/features/catalog/search-box";
import { NotificationBell } from "@/features/notifications/bell";
import { Link } from "@/i18n/navigation";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getCart } from "@/server/modules/cart/service";
import { listCategories } from "@/server/modules/catalog/service";
import { listNotifications } from "@/server/modules/notifications/service";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeSwitcher } from "./theme-switcher";

export async function SiteHeader({ locale }: { locale: string }) {
  const tc = await getTranslations({ locale, namespace: "common" });
  const tn = await getTranslations({ locale, namespace: "nav" });

  const actor = await getActor();
  const cartCount = actor ? getCart(getDb(), actor.userId).items.reduce((n, i) => n + i.qty, 0) : 0;
  const unread = actor ? listNotifications(getDb(), actor, { limit: 1 }).unread : 0;
  const topCategories = listCategories(getDb());

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
        <Link href="/" className="text-lg font-semibold">
          {tc("appName")}
        </Link>
        <SearchBox />
        <nav className="hidden items-center gap-1 text-sm md:flex">
          <Link href="/seller" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {tn("sellerCenter")}
          </Link>
          <Link href="/admin" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {tn("admin")}
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {actor && <NotificationBell initialUnread={unread} />}
          <Link
            href="/cart"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            aria-label={tn("cart")}
          >
            <span className="relative inline-flex">
              <ShoppingCartIcon />
              <CartBadge serverCount={cartCount} loggedIn={!!actor} />
            </span>
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
      {topCategories.length > 0 && (
        <nav className="border-t">
          <div className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-4 py-1 text-sm">
            {topCategories.map((c) => (
              <Link
                key={c.id}
                href={`/categories/${c.slug}`}
                className="shrink-0 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {locale === "vi" ? c.nameVi : c.nameEn}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
