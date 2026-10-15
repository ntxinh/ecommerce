// Session + cart reads happen at request time; block instead of instant-shell.
export const instant = false;

import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CartLineControls } from "@/features/cart/cart-line-controls";
import { GuestCart } from "@/features/cart/guest-cart";
import { Link } from "@/i18n/navigation";
import { formatVnd } from "@/lib/format";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { getCart } from "@/server/modules/cart/service";

export default async function CartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "cart" });
  const actor = await getActor();

  if (!actor) {
    return (
      <section className="space-y-6">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <GuestCart />
      </section>
    );
  }

  const cart = getCart(getDb(), actor.userId);

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {cart.items.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          {cart.byShop.map((group) => (
            <div key={group.shopId} className="space-y-2">
              <h2 className="font-medium">{group.shopName}</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("item")}</TableHead>
                    <TableHead>{t("price")}</TableHead>
                    <TableHead>{t("quantity")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.items.map((item) => (
                    <TableRow key={item.cartItemId}>
                      <TableCell>
                        {item.name}
                        <span className="block text-xs text-muted-foreground">
                          {item.sku}
                          {item.available ? "" : ` — ${t("unavailable")}`}
                        </span>
                      </TableCell>
                      <TableCell>{formatVnd(item.unitPriceVnd, locale)}</TableCell>
                      <TableCell>
                        <CartLineControls cartItemId={item.cartItemId} qty={item.qty} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
          <div className="flex items-center justify-between border-t pt-4">
            <p className="font-medium">
              {t("subtotal")}: {formatVnd(cart.subtotalVnd, locale)}
            </p>
            <Button asChild>
              <Link href="/checkout">{t("proceedToCheckout")}</Link>
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
