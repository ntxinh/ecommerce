// Session + cart reads happen at request time; block instead of instant-shell.
export const instant = false;

import { desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import {
  type CheckoutAddress,
  CheckoutForm,
  type ShippingOption,
} from "@/features/checkout/checkout-form";
import { redirect } from "@/i18n/navigation";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { addresses } from "@/server/db/schema";
import { getCart } from "@/server/modules/cart/service";
import { quoteShippingFee, shippingMethods } from "@/server/modules/shipping/providers";

export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "checkout" });
  const actor =
    (await getActor()) ??
    redirect({ href: { pathname: "/login", query: { next: "/checkout" } }, locale });

  const db = getDb();
  const cart = getCart(db, actor.userId);
  if (cart.items.length === 0) redirect({ href: "/cart", locale });

  const addressRows = db
    .select()
    .from(addresses)
    .where(eq(addresses.userId, actor.userId))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt))
    .all();
  const addressOptions: CheckoutAddress[] = addressRows.map((a) => ({
    id: a.id,
    label: `${a.recipientName} — ${a.line1}, ${a.ward}, ${a.district}, ${a.city} (${a.phone})`,
  }));

  const shippingOptions: ShippingOption[] = shippingMethods(db).map((method) => ({
    method,
    feeVnd: quoteShippingFee(db, method),
  }));

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CheckoutForm
        addresses={addressOptions}
        shippingOptions={shippingOptions}
        byShop={cart.byShop}
        subtotalVnd={cart.subtotalVnd}
        stripeEnabled={Boolean(process.env.STRIPE_PUBLISHABLE_KEY)}
      />
    </section>
  );
}
