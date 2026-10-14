// Session + order reads happen at request time; block instead of instant-shell.
export const instant = false;

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
import { Link, redirect } from "@/i18n/navigation";
import { formatDate, formatVnd } from "@/lib/format";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { listOrders } from "@/server/modules/orders/service";

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { locale } = await params;
  const { cursor } = await searchParams;
  const t = await getTranslations({ locale, namespace: "orders" });
  const actor = (await getActor()) ?? redirect({ href: "/login", locale });

  const { items, nextCursor } = listOrders(getDb(), actor, { cursor });

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {items.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("order")}</TableHead>
              <TableHead>{t("date")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead className="text-right">{t("total")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((order) => (
              <TableRow key={order.id}>
                <TableCell>
                  <Link
                    href={`/account/orders/${order.id}`}
                    className="underline underline-offset-2"
                  >
                    {order.id}
                  </Link>
                </TableCell>
                <TableCell>{formatDate(order.createdAt, locale)}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{order.status}</Badge>
                </TableCell>
                <TableCell className="text-right">{formatVnd(order.totalVnd, locale)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {nextCursor ? (
        <Link
          href={{ pathname: "/account/orders", query: { cursor: nextCursor } }}
          className="text-sm underline underline-offset-2"
        >
          {t("nextPage")}
        </Link>
      ) : null}
    </section>
  );
}
