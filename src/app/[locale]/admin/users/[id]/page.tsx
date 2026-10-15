export const instant = false;

import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/format";
import { AuthError } from "@/server/api/errors";
import { requireAdmin } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getUserDetail } from "@/server/modules/admin/service";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const actor = await requireAdmin(); // layout already guards; throws if regressed
  let detail: ReturnType<typeof getUserDetail>;
  try {
    detail = getUserDetail(getDb(), actor, id);
  } catch (e) {
    if (e instanceof AuthError && e.status === 404) notFound();
    throw e;
  }
  const t = await getTranslations({ locale, namespace: "admin" });
  const { user, roles, memberships, recentAudit } = detail;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/users" className="text-sm text-muted-foreground hover:underline">
          ← {t("usersTitle")}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{user.name}</h1>
        <p className="text-sm text-muted-foreground">{user.email}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant={user.status === "SUSPENDED" ? "destructive" : "secondary"}>
          {t(`userStatus.${user.status}`)}
        </Badge>
        {roles.map((r) => (
          <Badge key={r} variant="outline">
            {r}
          </Badge>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">
          {t("memberships")} ({memberships.length})
        </h2>
        {memberships.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noMemberships")}</p>
        ) : (
          <ul className="text-sm">
            {memberships.map((m) => (
              <li key={m.shopId}>
                {m.shopName} — {m.role}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">{t("recentAudit")}</h2>
        {recentAudit.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("auditEmpty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colWhen")}</TableHead>
                <TableHead>{t("colAction")}</TableHead>
                <TableHead>{t("colActor")}</TableHead>
                <TableHead>{t("colMeta")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentAudit.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground">
                    {formatDate(r.createdAt, locale)}
                  </TableCell>
                  <TableCell className="font-medium">{r.action}</TableCell>
                  <TableCell className="text-muted-foreground">{r.actorId ?? "—"}</TableCell>
                  <TableCell className="max-w-64 truncate font-mono text-xs text-muted-foreground">
                    {r.metaJson}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
