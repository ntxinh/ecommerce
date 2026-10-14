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
import { formatDate } from "@/lib/format";
import type { ModerationReviewRow } from "@/server/modules/reviews/service";
import { moderateReviewAction } from "./actions";

const ERROR_KEYS = new Set(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "INVALID_INPUT"]);

function Row({ row, locale }: { row: ModerationReviewRow; locale: string }) {
  const t = useTranslations("reviews");
  const router = useRouter();
  const [pending, start] = useTransition();
  const formId = `rev-mod-${row.id}`;
  const next = row.status === "PUBLISHED" ? "HIDE" : "UNHIDE";

  const run = () => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    const fd = new FormData(form ?? undefined);
    fd.set("reviewId", row.id);
    fd.set("action", next);
    start(async () => {
      const res = await moderateReviewAction(fd);
      if (res.ok) router.refresh();
      else
        toast.error(t(ERROR_KEYS.has(res.error) ? `errors.${res.error}` : "errors.INVALID_INPUT"));
    });
  };

  return (
    <TableRow>
      <TableCell>
        {row.productName}
        <span className="block text-xs text-muted-foreground">{row.productId}</span>
      </TableCell>
      <TableCell>{row.authorName}</TableCell>
      <TableCell>{row.rating}★</TableCell>
      <TableCell className="max-w-64">
        <span className="line-clamp-2 text-sm">
          {row.title ? `${row.title} — ` : ""}
          {row.body ?? ""}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={row.status === "PUBLISHED" ? "secondary" : "outline"}>
          {t(`status.${row.status}`)}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {formatDate(row.createdAt, locale)}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <form id={formId} className="flex-1">
            <Input
              name="note"
              placeholder={t("notePlaceholder")}
              disabled={pending}
              aria-label={t("notePlaceholder")}
            />
          </form>
          <Button
            type="button"
            size="sm"
            variant={next === "HIDE" ? "destructive" : "outline"}
            onClick={run}
            disabled={pending}
          >
            {t(next === "HIDE" ? "hide" : "unhide")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/** Admin review moderation: all reviews with HIDE/UNHIDE + optional note. */
export function ReviewModerationTable({
  rows,
  locale,
}: {
  rows: ModerationReviewRow[];
  locale: string;
}) {
  const t = useTranslations("reviews");
  if (rows.length === 0) return <p className="text-muted-foreground">{t("moderationEmpty")}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("colProduct")}</TableHead>
          <TableHead>{t("colAuthor")}</TableHead>
          <TableHead>{t("colRating")}</TableHead>
          <TableHead>{t("colReview")}</TableHead>
          <TableHead>{t("colStatus")}</TableHead>
          <TableHead>{t("colDate")}</TableHead>
          <TableHead>{t("colActions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <Row key={row.id} row={row} locale={locale} />
        ))}
      </TableBody>
    </Table>
  );
}
