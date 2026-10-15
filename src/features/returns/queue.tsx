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
import { decideReturnAction, disputeReturnAction } from "./actions";

export type ReturnQueueRow = {
  id: string;
  sellerOrderId: string;
  orderId: string;
  status: string;
  refund: string;
  reason: string;
  decisionNote: string | null;
  createdAt: number;
  lines: { name: string; qty: number }[];
  canDecide: boolean;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  PENDING: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
  REFUNDED: "outline",
  DISPUTED: "destructive",
};

const ERROR_KEYS: Record<string, true> = {
  UNAUTHORIZED: true,
  FORBIDDEN: true,
  NOT_FOUND: true,
  INVALID_INPUT: true,
  INVALID_STATE: true,
};

function QueueRow({ row }: { row: ReturnQueueRow }) {
  const t = useTranslations("returns");
  const router = useRouter();
  const [pending, start] = useTransition();
  const formId = `rr-${row.id}`;

  const run = (decision: "APPROVED" | "REJECTED") => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    const fd = new FormData(form ?? undefined);
    fd.set("returnRequestId", row.id);
    fd.set("decision", decision);
    start(async () => {
      const res = await decideReturnAction(fd);
      if (res.ok) router.refresh();
      else
        toast.error(
          t(ERROR_KEYS[res.error ?? ""] ? `errors.${res.error}` : "errors.INVALID_INPUT"),
        );
    });
  };

  return (
    <TableRow>
      <TableCell className="font-medium">
        <form id={formId} />
        {row.id}
        <p className="text-xs text-muted-foreground">{row.sellerOrderId}</p>
      </TableCell>
      <TableCell className="text-sm">
        <ul>
          {row.lines.map((l) => (
            <li key={l.name}>
              {l.name} ×{l.qty}
            </li>
          ))}
        </ul>
      </TableCell>
      <TableCell className="max-w-60 text-sm">{row.reason}</TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[row.status] ?? "secondary"}>
          {t(`status.${row.status}`)}
        </Badge>
      </TableCell>
      <TableCell className="text-right">{row.refund}</TableCell>
      <TableCell className="text-right">
        {row.canDecide ? (
          <div className="flex items-center justify-end gap-1">
            <Input
              form={formId}
              name="note"
              placeholder={t("notePlaceholder")}
              disabled={pending}
              className="min-w-32"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => run("APPROVED")}
            >
              {t("approve")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => run("REJECTED")}
            >
              {t("reject")}
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{row.decisionNote ?? "—"}</span>
        )}
      </TableCell>
    </TableRow>
  );
}

/** Seller/admin return-decision queue. `canDecide` comes from the server:
 *  PENDING for sellers, DISPUTED for admins. */
export function ReturnQueue({ rows, empty }: { rows: ReturnQueueRow[]; empty: string }) {
  const t = useTranslations("returns");
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("colRequest")}</TableHead>
          <TableHead>{t("colItems")}</TableHead>
          <TableHead>{t("reason")}</TableHead>
          <TableHead>{t("colStatus")}</TableHead>
          <TableHead className="text-right">{t("colRefund")}</TableHead>
          <TableHead className="text-right">{t("colActions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <QueueRow key={row.id} row={row} />
        ))}
      </TableBody>
    </Table>
  );
}

/** Buyer escalates a REJECTED request to DISPUTED. */
export function DisputeButton({ returnRequestId }: { returnRequestId: string }) {
  const t = useTranslations("returns");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set("returnRequestId", returnRequestId);
          const res = await disputeReturnAction(fd);
          if (res.ok) router.refresh();
          else
            toast.error(
              t(ERROR_KEYS[res.error ?? ""] ? `errors.${res.error}` : "errors.INVALID_INPUT"),
            );
        })
      }
    >
      {t("dispute")}
    </Button>
  );
}
