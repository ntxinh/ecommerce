// Guard reads the session cookie; block instead of instant-shell.
export const instant = false;

import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { ThemeSwitcher } from "@/components/shared/theme-switcher";
import { Link, redirect } from "@/i18n/navigation";
import { AuthError } from "@/server/api/errors";
import { requireSeller } from "@/server/auth/actor";

export default async function SellerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  try {
    await requireSeller();
  } catch (e) {
    if (e instanceof AuthError && e.status === 403) redirect({ href: "/", locale });
    if (e instanceof AuthError) redirect({ href: "/login", locale });
    throw e;
  }

  const tSeller = await getTranslations({ locale, namespace: "seller" });
  const tn = await getTranslations({ locale, namespace: "nav" });

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r p-4">
        <Link href="/seller" className="text-lg font-semibold">
          {tn("sellerCenter")}
        </Link>
        <nav className="mt-6 space-y-2 text-sm">
          <Link href="/seller/products" className="block hover:underline">
            {tSeller("productsTitle")}
          </Link>
          <Link href="/seller/orders" className="block hover:underline">
            {tSeller("ordersTitle")}
          </Link>
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-2 border-b px-4">
          <Link href="/" className="mr-auto text-sm text-muted-foreground">
            {tn("storefront")}
          </Link>
          <LocaleSwitcher />
          <ThemeSwitcher />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
