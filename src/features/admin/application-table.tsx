"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { useRouter } from "@/i18n/navigation";
import type { ApplicationRow } from "@/server/modules/sellers/service";
import { decideApplicationAction, setShopStatusAction } from "./actions";

const ERROR_KEYS = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_INPUT",
  "INVALID_STATE",
]);

function Row({ row }: { row: ApplicationRow }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  const formId = `app-${row.id}`;
  const decided = row.status === "APPROVED" || row.status === "REJECTED";

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await action();
      if (res.ok) router.refresh();
      else
        toast.error(
          t(ERROR_KEYS.has(res.error ?? "") ? `errors.${res.error}` : "errors.INVALID_INPUT"),
        );
    });

  const decide = (decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED") => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    const fd = new FormData(form ?? undefined);
    fd.set("applicationId", row.id);
    fd.set("decision", decision);
    run(() => decideApplicationAction(fd));
  };

  const shopStatus = (status: "ACTIVE" | "SUSPENDED") => {
    const fd = new FormData();
    fd.set("shopId", row.shopId ?? "");
    fd.set("status", status);
    run(() => setShopStatusAction(fd));
  };

  return (
    <TableRow>
      <TableCell className="font-medium">
        <form id={formId} />
        {row.shopName}
        <p className="text-xs text-muted-foreground">
          {row.userName} — {row.userEmail}
        </p>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{t(`appStatus.${row.status}`)}</Badge>
        {row.shopId ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t(`shopStatus.${row.shopStatus ?? "ACTIVE"}`)}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {new Date(row.createdAt).toLocaleString()}
      </TableCell>
      <TableCell>
        <Input
          form={formId}
          name="note"
          placeholder={t("notePlaceholder")}
          defaultValue={row.decisionNote ?? ""}
          disabled={pending}
          className="min-w-40"
        />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {!decided ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => decide("APPROVED")}
              >
                {t("approve")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => decide("REJECTED")}
              >
                {t("reject")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => decide("CHANGES_REQUESTED")}
              >
                {t("requestChanges")}
              </Button>
            </>
          ) : null}
          {row.shopId ? (
            row.shopStatus === "SUSPENDED" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => shopStatus("ACTIVE")}
              >
                {t("reactivate")}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => shopStatus("SUSPENDED")}
              >
                {t("suspend")}
              </Button>
            )
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

/** Admin seller-application table: decisions on pending rows, shop lifecycle on approved. */
export function ApplicationTable({ rows }: { rows: ApplicationRow[] }) {
  const t = useTranslations("admin");
  if (rows.length === 0) return <p className="text-muted-foreground">{t("appsEmpty")}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("colShop")}</TableHead>
          <TableHead>{t("colStatus")}</TableHead>
          <TableHead>{t("colSubmitted")}</TableHead>
          <TableHead>{t("colNote")}</TableHead>
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
