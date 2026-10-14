"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { formatVnd } from "@/lib/format";
import { useGuestCart } from "./use-guest-cart";

/** Guest cart: localStorage lines grouped by shop name, with qty controls that
 *  mirror the server cart's +/- pattern. */
export function GuestCart() {
  const t = useTranslations("cart");
  const locale = useLocale();
  const items = useGuestCart((s) => s.items);
  const setQty = useGuestCart((s) => s.setQty);
  const remove = useGuestCart((s) => s.remove);
  const byShop: Record<string, typeof items> = {};
  for (const item of items) {
    const group = byShop[item.shopName];
    if (group) group.push(item);
    else byShop[item.shopName] = [item];
  }
  const subtotal = items.reduce((sum, i) => sum + i.unitPriceVnd * i.qty, 0);

  if (items.length === 0) return <p className="text-muted-foreground">{t("empty")}</p>;

  return (
    <div className="space-y-6">
      {Object.entries(byShop).map(([shopName, lines]) => (
        <section key={shopName} className="space-y-2">
          <h2 className="font-medium">{shopName}</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("item")}</TableHead>
                <TableHead>{t("price")}</TableHead>
                <TableHead>{t("quantity")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.variantId}>
                  <TableCell>
                    {line.name}
                    <span className="block text-xs text-muted-foreground">{line.sku}</span>
                  </TableCell>
                  <TableCell>{formatVnd(line.unitPriceVnd, locale)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => setQty(line.variantId, line.qty - 1)}
                        aria-label={t("decrease")}
                      >
                        −
                      </Button>
                      <span className="w-8 text-center">{line.qty}</span>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => setQty(line.variantId, line.qty + 1)}
                        aria-label={t("increase")}
                      >
                        +
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => remove(line.variantId)}>
                      {t("remove")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ))}
      <div className="flex items-center justify-between border-t pt-4">
        <p className="font-medium">
          {t("subtotal")}: {formatVnd(subtotal, locale)}
        </p>
        <Button asChild>
          <Link href={{ pathname: "/login", query: { next: "/cart" } }}>
            {t("signInToCheckout")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
