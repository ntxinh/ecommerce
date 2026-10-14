export const instant = false;

import { desc } from "drizzle-orm";
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
import { ReturnQueue } from "@/features/returns/queue";
import { loadReturnRows, toQueueRows } from "@/features/returns/queue-data";
import { formatDate, formatVnd } from "@/lib/format";
import { requireAdmin } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { refunds } from "@/server/db/schema";
import { listReturnRequests } from "@/server/modules/orders/returns";

const REFUND_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  PENDING: "secondary",
  COMPLETED: "default",
  FAILED: "destructive",
};

export default async function AdminRefundsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const actor = await requireAdmin(); // layout already guards; throws if regressed
  const db = getDb();

  const { items: disputed } = listReturnRequests(db, actor, { status: "DISPUTED" });
  const disputedRows = toQueueRows(
    disputed,
    loadReturnRows(
      db,
      disputed.map((r) => r.id),
    ),
    locale,
    (s) => s === "DISPUTED",
  );
  const refundRows = db.select().from(refunds).orderBy(desc(refunds.createdAt)).limit(50).all();

  const t = await getTranslations({ locale, namespace: "returns" });

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{t("disputedTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("disputedHint")}</p>
        <ReturnQueue rows={disputedRows} empty={t("disputedEmpty")} />
      </section>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">{t("refundsTitle")}</h2>
        {refundRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("refundsEmpty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colRefundId")}</TableHead>
                <TableHead>{t("colPayment")}</TableHead>
                <TableHead>{t("colReturnItem")}</TableHead>
                <TableHead>{t("reason")}</TableHead>
                <TableHead className="text-right">{t("colAmount")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead>{t("colDate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {refundRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.id}</TableCell>
                  <TableCell className="text-muted-foreground">{r.paymentId}</TableCell>
                  <TableCell className="text-muted-foreground">{r.returnItemId ?? "—"}</TableCell>
                  <TableCell>{r.reason || "—"}</TableCell>
                  <TableCell className="text-right">{formatVnd(r.amountVnd, locale)}</TableCell>
                  <TableCell>
                    <Badge variant={REFUND_VARIANT[r.status] ?? "secondary"}>
                      {t(`refundStatus.${r.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(r.createdAt, locale)}
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
