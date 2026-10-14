// Session + order reads happen at request time; block instead of instant-shell.
export const instant = false;

import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
import { AuthError } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getOrder, type OrderDetail } from "@/server/modules/orders/service";
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "orders" });
  const actor = await getActor();
  if (!actor) notFound();

  let detail: OrderDetail;
  try {
    detail = getOrder(getDb(), actor, id);
  } catch (e) {
    if (e instanceof AuthError) notFound();
    throw e;
  }
  const { order, sellerOrders, items, payment } = detail;

  const address = JSON.parse(order.addressSnapshotJson) as {
    recipientName: string;
    phone: string;
    line1: string;
    ward: string;
    district: string;
    city: string;
  };

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <Link href="/account/orders" className="text-sm text-muted-foreground underline">
          {t("backToOrders")}
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          {t("order")} {order.id}
          <Badge variant="secondary">{order.status}</Badge>
        </h1>
        <p className="text-sm text-muted-foreground">{formatDate(order.createdAt, locale)}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("deliveryAddress")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {address.recipientName} ({address.phone})
          <br />
          {address.line1}, {address.ward}, {address.district}, {address.city}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("items")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("item")}</TableHead>
                <TableHead>{t("quantity")}</TableHead>
                <TableHead className="text-right">{t("lineTotal")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {item.nameSnapshot}
                    <span className="block text-xs text-muted-foreground">{item.skuSnapshot}</span>
                  </TableCell>
                  <TableCell>{item.qty}</TableCell>
                  <TableCell className="text-right">
                    {formatVnd(item.lineTotalVnd, locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Separator className="my-3" />
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>{t("merchandise")}</span>
              <span>{formatVnd(order.subtotalVnd, locale)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t("shipping")}</span>
              <span>{formatVnd(order.shippingVnd, locale)}</span>
            </div>
            {order.discountVnd !== 0 ? (
              <div className="flex justify-between">
                <span>{t("discount")}</span>
                <span>-{formatVnd(order.discountVnd, locale)}</span>
              </div>
            ) : null}
            <div className="flex justify-between font-medium">
              <span>{t("total")}</span>
              <span>{formatVnd(order.totalVnd, locale)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("sellerOrders")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {sellerOrders.map((so) => (
            <div key={so.id} className="flex items-center justify-between">
              <span>{so.id}</span>
              <span className="flex items-center gap-2">
                <Badge variant="outline">{so.status}</Badge>
                {formatVnd(so.subtotalVnd + so.shippingVnd, locale)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {payment ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("payment")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {payment.method} — {payment.status} — {formatVnd(payment.amountVnd, locale)}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
