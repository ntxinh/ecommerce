"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
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
import type { QueueRow } from "@/server/modules/catalog/moderation";
import { moderateProductAction } from "./actions";

const ERROR_KEYS = new Set(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "INVALID_INPUT"]);

function QueueItem({ row }: { row: QueueRow }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  const formId = `mod-${row.productId}`;

  const run = (action: "approve" | "reject" | "suspend") => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    const fd = new FormData(form ?? undefined);
    fd.set("productId", row.productId);
    fd.set("action", action);
    start(async () => {
      const res = await moderateProductAction(fd);
      if (res.ok) router.refresh();
      else
        toast.error(
          t(ERROR_KEYS.has(res.error ?? "") ? `errors.${res.error}` : "errors.INVALID_INPUT"),
        );
    });
  };

  return (
    <TableRow>
      <TableCell className="font-medium">
        <form id={formId} />
        {row.nameEn}
        <p className="text-xs text-muted-foreground">{row.nameVi}</p>
      </TableCell>
      <TableCell>{row.shopName}</TableCell>
      <TableCell className="text-muted-foreground">
        {row.submittedAt ? new Date(row.submittedAt).toLocaleString() : "—"}
      </TableCell>
      <TableCell>
        <Input
          form={formId}
          name="note"
          placeholder={t("notePlaceholder")}
          disabled={pending}
          className="min-w-40"
        />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run("approve")}
          >
            {t("approve")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run("reject")}
          >
            {t("reject")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run("suspend")}
          >
            {t("suspend")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/** Admin moderation queue: SUBMITTED products with approve/reject/suspend + note. */
export function ModerationTable({ rows }: { rows: QueueRow[] }) {
  const t = useTranslations("admin");
  if (rows.length === 0) return <p className="text-muted-foreground">{t("queueEmpty")}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("colProduct")}</TableHead>
          <TableHead>{t("colShop")}</TableHead>
          <TableHead>{t("colSubmitted")}</TableHead>
          <TableHead>{t("colNote")}</TableHead>
          <TableHead className="text-right">{t("colActions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <QueueItem key={r.productId} row={r} />
        ))}
      </TableBody>
    </Table>
  );
}
