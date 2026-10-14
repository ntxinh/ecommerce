export const instant = false;

import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UsersTable } from "@/features/admin/users-table";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { listUsers } from "@/server/modules/admin/service";

const STATUSES = ["ACTIVE", "SUSPENDED"] as const;

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  const actor = await requireAdmin(); // layout already guards; throws if regressed
  const q = sp.q?.trim() || undefined;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number])
    ? (sp.status as (typeof STATUSES)[number])
    : undefined;
  const { items, nextCursor } = listUsers(getDb(), actor, { q, status, cursor: sp.cursor });
  const t = await getTranslations({ locale, namespace: "admin" });

  const href = (over: { status?: string; cursor?: string }) => ({
    pathname: "/admin/users" as const,
    query: {
      ...(q ? { q } : {}),
      ...((over.status ?? status) ? { status: over.status ?? status } : {}),
      ...(over.cursor ? { cursor: over.cursor } : {}),
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("usersTitle")}</h1>
      <div className="flex flex-wrap items-center gap-2">
        {/* No action → submits to the current localized URL. */}
        <form className="flex gap-2">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <Input name="q" defaultValue={q} placeholder={t("searchUsers")} className="w-64" />
          <Button type="submit" variant="secondary" size="sm">
            {t("search")}
          </Button>
        </form>
        <nav className="flex gap-2 text-sm">
          <Link
            href={href({ status: "" })}
            className={status ? "text-muted-foreground hover:underline" : "font-medium"}
          >
            {t("filterAll")}
          </Link>
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={href({ status: s })}
              className={status === s ? "font-medium" : "text-muted-foreground hover:underline"}
            >
              {t(`userStatus.${s}`)}
            </Link>
          ))}
        </nav>
      </div>
      <UsersTable rows={items} />
      {nextCursor ? (
        <Link href={href({ cursor: nextCursor })} className="text-sm underline underline-offset-2">
          {t("nextPage")}
        </Link>
      ) : null}
    </div>
  );
}
