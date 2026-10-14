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
import { type FulfillmentAction, OrderActionButtons } from "@/features/seller/order-action-buttons";
import { Link } from "@/i18n/navigation";
import { formatDate, formatVnd } from "@/lib/format";
import { AuthError } from "@/server/api/errors";
import { requireSeller } from "@/server/auth/actor";
import type { Actor } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import { getSellerOrder, type SellerOrderDetail } from "@/server/modules/orders/service";
import {
  SELLER_ORDER_TRANSITIONS,
  type SellerOrderStatus,
} from "@/server/modules/orders/transitions";

/** Seller-order target → the action button that performs it. RETURN_REQUESTED
 *  is customer-initiated, so it never appears as a seller action. */
const TARGET_ACTION = {
  CONFIRMED: "confirm",
  PACKING: "pack",
  SHIPPED: "ship",
  DELIVERED: "deliver",
  COMPLETED: "complete",
  CANCELLED: "cancel",
} as const satisfies Partial<Record<SellerOrderStatus, FulfillmentAction>>;

export default async function SellerOrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  let actor: Actor;
  try {
    actor = await requireSeller();
  } catch {
    notFound(); // layout already guards; defensive only
  }

  let detail: SellerOrderDetail;
  try {
    detail = getSellerOrder(getDb(), actor, id);
  } catch (e) {
    if (e instanceof AuthError) notFound();
    throw e;
  }
  const { sellerOrder, order, shop, items, shipment, trackingEvents } = detail;

  const t = await getTranslations({ locale, namespace: "seller" });
  const actions = SELLER_ORDER_TRANSITIONS[sellerOrder.status]
    .map((to) => TARGET_ACTION[to as keyof typeof TARGET_ACTION])
    .filter((a): a is FulfillmentAction => a !== undefined);

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
        <Link href="/seller/orders" className="text-sm text-muted-foreground underline">
          {t("backToOrders")}
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          {sellerOrder.id}
          <Badge variant="secondary">{t(`legStatus.${sellerOrder.status}`)}</Badge>
        </h1>
        <p className="text-sm text-muted-foreground">
          {shop?.name} — {t("parentOrder")} {order.id} (
          <Badge variant="outline">{order.status}</Badge>) — {formatDate(order.createdAt, locale)}
        </p>
      </header>

      {actions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("orderActionsTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <OrderActionButtons sellerOrderId={sellerOrder.id} actions={actions} />
          </CardContent>
        </Card>
      ) : null}

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
              <span>{formatVnd(sellerOrder.subtotalVnd, locale)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t("shipping")}</span>
              <span>{formatVnd(sellerOrder.shippingVnd, locale)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>{t("total")}</span>
              <span>{formatVnd(sellerOrder.subtotalVnd + sellerOrder.shippingVnd, locale)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

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

      {shipment ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("shipment")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              {shipment.provider} — {shipment.trackingNumber}{" "}
              <Badge variant="outline">{shipment.status}</Badge>
            </p>
            {trackingEvents.length > 0 ? (
              <ol className="space-y-2 border-l pl-4">
                {trackingEvents.map((ev) => (
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
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
