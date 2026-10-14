// Guard reads the session cookie; block instead of instant-shell.
export const instant = false;

import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { ThemeSwitcher } from "@/components/shared/theme-switcher";
import { Link, redirect } from "@/i18n/navigation";
import { AuthError } from "@/server/api/errors";
import { requireAdmin } from "@/server/auth/actor";

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) redirect({ href: "/login", locale });
    throw e;
  }

  const tn = await getTranslations({ locale, namespace: "nav" });
  const ts = await getTranslations({ locale, namespace: "shell" });
  const tr = await getTranslations({ locale, namespace: "returns" });

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r p-4">
        <Link href="/admin" className="text-lg font-semibold">
          {tn("admin")}
        </Link>
        <nav className="mt-6 space-y-2 text-sm">
          <Link href="/admin/moderation" className="block hover:underline">
            {ts("moderation")}
          </Link>
          <Link href="/admin/categories" className="block hover:underline">
            {ts("categories")}
          </Link>
          <Link href="/admin/refunds" className="block hover:underline">
            {tr("refundsTitle")}
          </Link>
          <Link href="/admin/applications" className="block hover:underline">
            {ts("applications")}
          </Link>
          <Link href="/admin/users" className="block hover:underline">
            {ts("users")}
          </Link>
          <Link href="/admin/audit" className="block hover:underline">
            {ts("audit")}
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
