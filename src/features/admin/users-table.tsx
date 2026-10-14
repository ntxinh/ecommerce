"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link, useRouter } from "@/i18n/navigation";
import type { AdminUserRow } from "@/server/modules/admin/service";
import { revokeUserSessionsAction, setUserStatusAction } from "./actions";

const ERROR_KEYS = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_INPUT",
  "INVALID_STATE",
]);

function Row({ row }: { row: AdminUserRow }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await action();
      if (res.ok) router.refresh();
      else
        toast.error(
          t(ERROR_KEYS.has(res.error ?? "") ? `errors.${res.error}` : "errors.INVALID_INPUT"),
        );
    });

  const setStatus = (status: "ACTIVE" | "SUSPENDED") => {
    const fd = new FormData();
    fd.set("userId", row.id);
    fd.set("status", status);
    run(() => setUserStatusAction(fd));
  };
  const revoke = () => {
    const fd = new FormData();
    fd.set("userId", row.id);
    run(() => revokeUserSessionsAction(fd));
  };

  return (
    <TableRow>
      <TableCell className="font-medium">
        {row.name}
        <p className="text-xs text-muted-foreground">{row.email}</p>
      </TableCell>
      <TableCell>
        <Badge variant={row.status === "SUSPENDED" ? "destructive" : "secondary"}>
          {t(`userStatus.${row.status}`)}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{row.roles.join(", ")}</TableCell>
      <TableCell className="text-muted-foreground">
        {new Date(row.createdAt).toLocaleDateString()}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button type="button" variant="ghost" size="sm" asChild>
            <Link href={`/admin/users/${row.id}`}>{t("view")}</Link>
          </Button>
          {row.status === "SUSPENDED" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setStatus("ACTIVE")}
            >
              {t("reactivate")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setStatus("SUSPENDED")}
            >
              {t("suspend")}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={revoke}>
            {t("revokeSessions")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/** Admin user table: status badge, suspend/reactivate, revoke sessions, detail link. */
export function UsersTable({ rows }: { rows: AdminUserRow[] }) {
  const t = useTranslations("admin");
  if (rows.length === 0) return <p className="text-muted-foreground">{t("usersEmpty")}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("colUser")}</TableHead>
          <TableHead>{t("colStatus")}</TableHead>
          <TableHead>{t("colRoles")}</TableHead>
          <TableHead>{t("colCreated")}</TableHead>
          <TableHead className="text-right">{t("colActions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <Row key={r.id} row={r} />
        ))}
      </TableBody>
    </Table>
  );
}
