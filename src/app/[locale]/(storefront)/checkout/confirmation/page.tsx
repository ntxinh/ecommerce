// Session + order reads happen at request time; block instead of instant-shell.
export const instant = false;

import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Link } from "@/i18n/navigation";
import { formatVnd } from "@/lib/format";
import { AuthError } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getOrder, type OrderDetail } from "@/server/modules/orders/service";

export default async function ConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ order?: string }>;
}) {
  const { locale } = await params;
  const { order: orderId } = await searchParams;
  const t = await getTranslations({ locale, namespace: "checkout" });
  const to = await getTranslations({ locale, namespace: "orders" });
  const actor = await getActor();
  if (!actor || !orderId) notFound();

  let detail: OrderDetail;
  try {
    detail = getOrder(getDb(), actor, orderId);
  } catch (e) {
    if (e instanceof AuthError) notFound();
    throw e;
  }
  const { order, sellerOrders } = detail;

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{t("confirmationTitle")}</h1>
        <p className="text-muted-foreground">{t("confirmationBody")}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>
              {to("order")} {order.id}
            </span>
            <Badge variant="secondary">{order.status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
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
          <Separator />
          <div className="flex justify-between font-medium">
            <span>{to("total")}</span>
            <span>{formatVnd(order.totalVnd, locale)}</span>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-2">
        <h2 className="font-medium">{to("sellerOrders")}</h2>
        <ul className="space-y-2">
          {sellerOrders.map((so) => (
            <li
              key={so.id}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span>{so.id}</span>
              <span className="flex items-center gap-2">
                <Badge variant="outline">{so.status}</Badge>
                {formatVnd(so.subtotalVnd + so.shippingVnd, locale)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Link href="/account/orders" className={buttonVariants({ variant: "outline" })}>
        {to("viewOrders")}
      </Link>
    </section>
  );
}
