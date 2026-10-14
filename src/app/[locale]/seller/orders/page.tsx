export const instant = false;

import { inArray } from "drizzle-orm";
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
import { AuthError } from "@/server/api/errors";
import { requireSeller } from "@/server/auth/actor";
import type { Actor } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import { shops } from "@/server/db/schema";
import { listSellerOrders } from "@/server/modules/orders/service";

const LEG_VARIANT = {
  NEW: "secondary",
  CONFIRMED: "default",
  PACKING: "default",
  READY_TO_SHIP: "default",
  SHIPPED: "default",
  DELIVERED: "default",
  COMPLETED: "outline",
  CANCELLED: "destructive",
  RETURN_REQUESTED: "destructive",
  RETURNED: "outline",
} as const;

export default async function SellerOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ shop?: string; cursor?: string }>;
}) {
  const { locale } = await params;
  const { shop, cursor } = await searchParams;
  let actor: Actor;
  try {
    actor = await requireSeller();
  } catch (e) {
    if (e instanceof AuthError && e.status === 403) redirect({ href: "/", locale });
    if (e instanceof AuthError) redirect({ href: "/login", locale });
    throw e;
  }

  const shopIds = actor.memberships.map((m) => m.shopId);
  if (shopIds.length === 0) redirect({ href: "/seller", locale });
  const myShops = getDb().select().from(shops).where(inArray(shops.id, shopIds)).all();
  const shopId = shop && shopIds.includes(shop) ? shop : shopIds[0];
  const { items, nextCursor } = listSellerOrders(getDb(), actor, { shopId, cursor });

  const t = await getTranslations({ locale, namespace: "seller" });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("ordersTitle")}</h1>
      {myShops.length > 1 ? (
        <nav className="flex gap-3 text-sm">
          {myShops.map((s) => (
            <Link
              key={s.id}
              href={`/seller/orders?shop=${s.id}`}
              className={s.id === shopId ? "font-semibold underline" : "text-muted-foreground"}
            >
              {s.name}
            </Link>
          ))}
        </nav>
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("ordersEmpty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colSellerOrder")}</TableHead>
              <TableHead>{t("colOrder")}</TableHead>
              <TableHead>{t("colDate")}</TableHead>
              <TableHead>{t("colStatus")}</TableHead>
              <TableHead className="text-right">{t("colTotal")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((so) => (
              <TableRow key={so.id}>
                <TableCell className="font-medium">
                  <Link href={`/seller/orders/${so.id}`} className="hover:underline">
                    {so.id}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{so.orderId}</TableCell>
                <TableCell>{formatDate(so.createdAt, locale)}</TableCell>
                <TableCell>
                  <Badge variant={LEG_VARIANT[so.status]}>{t(`legStatus.${so.status}`)}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {formatVnd(so.subtotalVnd + so.shippingVnd, locale)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {nextCursor ? (
        <Link
          href={{ pathname: "/seller/orders", query: { shop: shopId, cursor: nextCursor } }}
          className="text-sm underline underline-offset-2"
        >
          {t("nextPage")}
        </Link>
      ) : null}
    </div>
  );
}
