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
import { VoucherForm } from "@/features/admin/voucher-form";
import { formatDate, formatVnd } from "@/lib/format";
import { requireAdmin } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { vouchers } from "@/server/db/schema";

export default async function AdminVouchersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireAdmin(); // layout already guards; throws if regressed
  const rows = getDb().select().from(vouchers).orderBy(desc(vouchers.id)).limit(50).all();
  const t = await getTranslations({ locale, namespace: "admin" });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("vouchersTitle")}</h1>
      <VoucherForm />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("vouchersEmpty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colCode")}</TableHead>
              <TableHead>{t("colKind")}</TableHead>
              <TableHead className="text-right">{t("fieldValue")}</TableHead>
              <TableHead className="text-right">{t("fieldMinSpend")}</TableHead>
              <TableHead className="text-right">{t("colUsed")}</TableHead>
              <TableHead>{t("colWindow")}</TableHead>
              <TableHead>{t("colStatus")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono font-medium">
                  {v.code}
                  <span className="block text-xs text-muted-foreground">{v.scope}</span>
                </TableCell>
                <TableCell>{t(`voucherKind.${v.kind}`)}</TableCell>
                <TableCell className="text-right">
                  {v.kind === "PERCENT" ? `${v.value / 100}%` : formatVnd(v.value, locale)}
                </TableCell>
                <TableCell className="text-right">{formatVnd(v.minSpendVnd, locale)}</TableCell>
                <TableCell className="text-right">
                  {v.usedCount}
                  {v.totalLimit ? `/${v.totalLimit}` : ""}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(v.startsAt, locale)} – {formatDate(v.endsAt, locale)}
                </TableCell>
                <TableCell>
                  <Badge variant={v.status === "ACTIVE" ? "default" : "secondary"}>
                    {v.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
