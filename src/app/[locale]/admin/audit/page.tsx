export const instant = false;

import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { requireAdmin } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { listAuditLogs } from "@/server/modules/admin/service";

export default async function AdminAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  const actor = await requireAdmin(); // layout already guards; throws if regressed
  const targetType = sp.targetType?.trim() || undefined;
  const targetId = sp.targetId?.trim() || undefined;
  const { items, nextCursor } = listAuditLogs(getDb(), actor, {
    targetType,
    targetId,
    cursor: sp.cursor,
    limit: 50,
  });
  const t = await getTranslations({ locale, namespace: "admin" });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("auditTitle")}</h1>
      {/* No action → submits to the current localized URL. */}
      <form className="flex flex-wrap gap-2">
        <Input
          name="targetType"
          defaultValue={targetType}
          placeholder={t("targetType")}
          className="w-44"
        />
        <Input
          name="targetId"
          defaultValue={targetId}
          placeholder={t("targetId")}
          className="w-64"
        />
        <Button type="submit" variant="secondary" size="sm">
          {t("filter")}
        </Button>
        {targetType || targetId ? (
          <Link href="/admin/audit" className="self-center text-sm hover:underline">
            {t("filterAll")}
          </Link>
        ) : null}
      </form>
      {items.length === 0 ? (
        <p className="text-muted-foreground">{t("auditEmpty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colWhen")}</TableHead>
              <TableHead>{t("colAction")}</TableHead>
              <TableHead>{t("colActor")}</TableHead>
              <TableHead>{t("colTarget")}</TableHead>
              <TableHead>{t("colMeta")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-muted-foreground">
                  {formatDate(r.createdAt, locale)}
                </TableCell>
                <TableCell className="font-medium">{r.action}</TableCell>
                <TableCell className="text-muted-foreground">{r.actorId ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">
                  <Link
                    href={{
                      pathname: "/admin/audit",
                      query: { targetType: r.targetType, targetId: r.targetId },
                    }}
                    className="hover:underline"
                  >
                    {r.targetType}:{r.targetId}
                  </Link>
                </TableCell>
                <TableCell className="max-w-64 truncate font-mono text-xs text-muted-foreground">
                  {r.metaJson}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {nextCursor ? (
        <Link
          href={{
            pathname: "/admin/audit",
            query: {
              ...(targetType ? { targetType } : {}),
              ...(targetId ? { targetId } : {}),
              cursor: nextCursor,
            },
          }}
          className="text-sm underline underline-offset-2"
        >
          {t("nextPage")}
        </Link>
      ) : null}
    </div>
  );
}
