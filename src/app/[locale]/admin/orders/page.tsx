export const instant = false;

import { getTranslations } from "next-intl/server";
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
import { Link } from "@/i18n/navigation";
import { formatDate, formatVnd } from "@/lib/format";
import { requireAdmin } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import type { orders } from "@/server/db/schema";
import { listAdminOrders } from "@/server/modules/admin/ops";

type OrderStatus = (typeof orders.$inferSelect)["status"];
const STATUSES: OrderStatus[] = [
  "PENDING_PAYMENT",
  "PAID",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
  "PAYMENT_FAILED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
];

export default async function AdminOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  const actor = await requireAdmin(); // layout already guards; throws if regressed
  const q = sp.q?.trim() || undefined;
  const status = STATUSES.includes(sp.status as OrderStatus)
    ? (sp.status as OrderStatus)
    : undefined;
  const { items, nextCursor } = listAdminOrders(getDb(), actor, {
    q,
    status,
    cursor: sp.cursor,
  });
  const t = await getTranslations({ locale, namespace: "admin" });

  const href = (over: { status?: string; cursor?: string }) => ({
    pathname: "/admin/orders" as const,
    query: {
      ...(q ? { q } : {}),
      ...((over.status ?? status) ? { status: over.status ?? status } : {}),
      ...(over.cursor ? { cursor: over.cursor } : {}),
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("ordersTitle")}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <form className="flex gap-2">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <Input name="q" defaultValue={q} placeholder={t("searchOrders")} className="w-64" />
          <Button type="submit" variant="secondary" size="sm">
            {t("search")}
          </Button>
        </form>
        <nav className="flex flex-wrap gap-2 text-sm">
          <Link
            href={href({ status: "" })}
            className={status ? "text-muted-foreground hover:underline" : "font-medium"}
          >
            {t("filterAll")}
          </Link>
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={href({ status: s })}
              className={status === s ? "font-medium" : "text-muted-foreground hover:underline"}
            >
              {t(`orderStatus.${s}`)}
            </Link>
          ))}
        </nav>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("ordersEmpty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colOrder")}</TableHead>
              <TableHead>{t("colBuyer")}</TableHead>
              <TableHead>{t("colStatus")}</TableHead>
              <TableHead className="text-right">{t("colTotal")}</TableHead>
              <TableHead>{t("colCreated")}</TableHead>
              <TableHead className="text-right">{t("colActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.id}</TableCell>
                <TableCell className="text-muted-foreground">{o.buyerEmail}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{t(`orderStatus.${o.status}`)}</Badge>
                </TableCell>
                <TableCell className="text-right">{formatVnd(o.totalVnd, locale)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(o.createdAt, locale)}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/admin/orders/${o.id}`}
                    className="text-sm underline underline-offset-2"
                  >
                    {t("view")}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {nextCursor ? (
        <Link href={href({ cursor: nextCursor })} className="text-sm underline underline-offset-2">
          {t("nextPage")}
        </Link>
      ) : null}
    </div>
  );
}
