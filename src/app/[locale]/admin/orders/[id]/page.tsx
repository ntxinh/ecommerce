export const instant = false;

import { desc, eq } from "drizzle-orm";
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
import { requireAdmin } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { paymentAttempts, users } from "@/server/db/schema";
import { getAdminOrder } from "@/server/modules/admin/ops";
import type { OrderDetail } from "@/server/modules/orders/service";

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const actor = await requireAdmin();
  const db = getDb();

  let detail: OrderDetail;
  try {
    detail = getAdminOrder(db, actor, id);
  } catch (e) {
    if (e instanceof AuthError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  const { order, sellerOrders, items, breakdowns, payment, shipments, trackingEvents } = detail;
  const buyer = db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, order.userId))
    .get();
  const attempts = payment
    ? db
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.paymentId, payment.id))
        .orderBy(desc(paymentAttempts.id))
        .all()
    : [];
  const t = await getTranslations({ locale, namespace: "admin" });
  const to = await getTranslations({ locale, namespace: "orders" });
  const address = JSON.parse(order.addressSnapshotJson) as Partial<{
    recipientName: string;
    phone: string;
    line1: string;
    ward: string;
    district: string;
    city: string;
  }>;

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <Link href="/admin/orders" className="text-sm text-muted-foreground underline">
          {t("ordersTitle")}
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          {to("order")} {order.id}
          <Badge variant="secondary">{t(`orderStatus.${order.status}`)}</Badge>
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatDate(order.createdAt, locale)} — {buyer?.email}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{to("deliveryAddress")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {address.recipientName} ({address.phone})
          <br />
          {[address.line1, address.ward, address.district, address.city].filter(Boolean).join(", ")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{to("items")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{to("item")}</TableHead>
                <TableHead>{to("quantity")}</TableHead>
                <TableHead className="text-right">{to("lineTotal")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {item.nameSnapshot}
                    <span className="block text-xs text-muted-foreground">
                      {item.skuSnapshot} — {item.sellerOrderId}
                    </span>
                  </TableCell>
                  <TableCell>{item.qty}</TableCell>
                  <TableCell className="text-right">
                    {formatVnd(item.lineTotalVnd, locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {breakdowns.length > 0 ? (
            <>
              <Separator className="my-3" />
              <ul className="space-y-1 text-sm">
                {breakdowns.map((b) => (
                  <li key={b.id} className="flex justify-between text-muted-foreground">
                    <span>{b.lineType}</span>
                    <span>{formatVnd(b.amountVnd, locale)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <Separator className="my-3" />
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>{to("merchandise")}</span>
              <span>{formatVnd(order.subtotalVnd, locale)}</span>
            </div>
            <div className="flex justify-between">
              <span>{to("shipping")}</span>
              <span>{formatVnd(order.shippingVnd, locale)}</span>
            </div>
            {order.discountVnd !== 0 ? (
              <div className="flex justify-between">
                <span>{to("discount")}</span>
                <span>-{formatVnd(order.discountVnd, locale)}</span>
              </div>
            ) : null}
            <div className="flex justify-between font-medium">
              <span>{to("total")}</span>
              <span>{formatVnd(order.totalVnd, locale)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {sellerOrders.map((so) => {
        const shipment = shipments.find((s) => s.sellerOrderId === so.id);
        const events = shipment ? trackingEvents.filter((ev) => ev.shipmentId === shipment.id) : [];
        return (
          <Card key={so.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>
                  {to("sellerOrder")} {so.id} — {so.shopId}
                </span>
                <Badge variant="outline">{to(`legStatus.${so.status}`)}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span>{to("legTotal")}</span>
                <span>{formatVnd(so.subtotalVnd + so.shippingVnd, locale)}</span>
              </div>
              {shipment ? (
                <div className="space-y-2">
                  <p>
                    {to("shipment")}: {shipment.provider} — {shipment.trackingNumber}
                  </p>
                  {events.length > 0 ? (
                    <ol className="space-y-2 border-l pl-4">
                      {events.map((ev) => (
                        <li key={ev.id}>
                          <span className="font-medium">{ev.status}</span>
                          {ev.detail ? <span> — {ev.detail}</span> : null}
                          <span className="block text-xs text-muted-foreground">
                            {formatDate(ev.createdAt, locale)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}

      {payment ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{to("payment")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              {payment.method} — {payment.status} — {formatVnd(payment.amountVnd, locale)}
            </p>
            {attempts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colAttempt")}</TableHead>
                    <TableHead>{t("colStatus")}</TableHead>
                    <TableHead>{t("colProviderRef")}</TableHead>
                    <TableHead>{t("colCreated")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attempts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.id}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{a.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {a.providerRef ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(a.createdAt, locale)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
