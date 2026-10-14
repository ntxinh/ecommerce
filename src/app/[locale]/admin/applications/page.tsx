export const instant = false;

import { getTranslations } from "next-intl/server";
import { ApplicationTable } from "@/features/admin/application-table";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { type ApplicationStatus, listApplications } from "@/server/modules/sellers/service";

const STATUSES: ApplicationStatus[] = ["PENDING", "CHANGES_REQUESTED", "APPROVED", "REJECTED"];

export default async function AdminApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  const actor = await requireAdmin(); // layout already guards; throws if regressed
  const status = STATUSES.includes(sp.status as ApplicationStatus)
    ? (sp.status as ApplicationStatus)
    : undefined;
  const { items, nextCursor } = listApplications(getDb(), actor, {
    status,
    cursor: sp.cursor,
    limit: 20,
  });
  const t = await getTranslations({ locale, namespace: "admin" });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("applicationsTitle")}</h1>
      <nav className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/admin/applications"
          className={status ? "text-muted-foreground hover:underline" : "font-medium"}
        >
          {t("filterAll")}
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={{ pathname: "/admin/applications", query: { status: s } }}
            className={status === s ? "font-medium" : "text-muted-foreground hover:underline"}
          >
            {t(`appStatus.${s}`)}
          </Link>
        ))}
      </nav>
      <ApplicationTable rows={items} />
      {nextCursor ? (
        <Link
          href={{
            pathname: "/admin/applications",
            query: { ...(status ? { status } : {}), cursor: nextCursor },
          }}
          className="text-sm underline underline-offset-2"
        >
          {t("nextPage")}
        </Link>
      ) : null}
    </div>
  );
}
