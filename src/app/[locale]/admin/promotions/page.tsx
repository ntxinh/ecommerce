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
import { PromotionForm } from "@/features/admin/promotion-form";
import { VoucherForm } from "@/features/admin/voucher-form";
import { formatDate, formatVnd } from "@/lib/format";
import { requireAdmin } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { promotions } from "@/server/db/schema";

export default async function AdminPromotionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireAdmin(); // layout already guards; throws if regressed
  const rows = getDb().select().from(promotions).orderBy(desc(promotions.id)).limit(50).all();
  const t = await getTranslations({ locale, namespace: "admin" });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("promotions.title")}</h1>
      <PromotionForm scopes={["PRODUCT", "SHOP", "FLASH"]} />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("promotions.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("promotions.colScope")}</TableHead>
              <TableHead>{t("promotions.colTarget")}</TableHead>
              <TableHead>{t("promotions.colKind")}</TableHead>
              <TableHead className="text-right">{t("fieldValue")}</TableHead>
              <TableHead>{t("colWindow")}</TableHead>
              <TableHead>{t("colStatus")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{t(`promotions.scope.${p.scope}`)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {p.productId ?? p.shopId ?? "—"}
                </TableCell>
                <TableCell>{t(`promotions.kind.${p.kind}`)}</TableCell>
                <TableCell className="text-right">
                  {p.kind === "PERCENT" ? `${p.value / 100}%` : formatVnd(p.value, locale)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(p.startsAt, locale)} – {formatDate(p.endsAt, locale)}
                </TableCell>
                <TableCell>
                  <Badge variant={p.status === "ACTIVE" ? "default" : "secondary"}>
                    {p.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <h2 className="text-xl font-semibold">{t("vouchersTitle")}</h2>
      <VoucherForm />
    </div>
  );
}
