// Session + Stripe reads happen at request time; block instead of instant-shell.
export const instant = false;

import { desc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { retryStripePayment } from "@/features/checkout/actions";
import { Link } from "@/i18n/navigation";
import { formatVnd } from "@/lib/format";
import { AuthError } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { orders, paymentAttempts } from "@/server/db/schema";
import { getOrder } from "@/server/modules/orders/service";
import {
  applyStripeSessionOutcome,
  getStripe,
  sessionOutcome,
} from "@/server/modules/payments/stripe";

/**
 * Stripe return surface (`?session_id=` from Checkout, or bare on cancel).
 * Retrieves the session server-side and applies the outcome idempotently —
 * the webhook stays authoritative; this only covers browsers that beat it
 * (or local dev without `stripe listen`).
 */
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orderId: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { locale, orderId } = await params;
  const { session_id: sessionIdParam } = await searchParams;
  const t = await getTranslations({ locale, namespace: "checkout.pay" });
  const actor = await getActor();
  if (!actor) notFound();

  const db = getDb();
  let detail: ReturnType<typeof getOrder>;
  try {
    detail = getOrder(db, actor, orderId);
  } catch (e) {
    if (e instanceof AuthError) notFound();
    throw e;
  }
  const { order, payment } = detail;
  if (!payment || payment.method !== "STRIPE") notFound();

  // Resolve the session: ?session_id= wins (authoritative return), else the
  // latest attempt's providerRef (plain visit / cancel_url).
  const attemptRef =
    sessionIdParam ??
    db
      .select({ ref: paymentAttempts.providerRef })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.paymentId, payment.id))
      .orderBy(desc(paymentAttempts.createdAt))
      .all()
      .find((a) => a.ref)?.ref;

  const stripe = getStripe();
  let sessionUrl: string | null = null;
  let outcome: "PAID" | "FAILED" | "PENDING" | null = null;
  if (stripe && attemptRef) {
    const session = await stripe.checkout.sessions.retrieve(attemptRef).catch(() => null);
    if (session && session.metadata?.orderId === orderId) {
      outcome = sessionOutcome(session);
      sessionUrl = session.url;
      if (outcome === "PAID" || outcome === "FAILED") {
        applyStripeSessionOutcome(db, session, outcome);
      }
    }
  }

  // Re-read after a possible apply — the webhook may also have settled it.
  const live = db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .get()!.status;

  if (live === "PAID") {
    redirect(`/${locale}/checkout/confirmation?order=${orderId}`);
  }

  const retry = retryStripePayment.bind(null, orderId, locale);
  return (
    <section className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {orderId} — {formatVnd(order.totalVnd, locale)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {live === "PAYMENT_FAILED" || outcome === "FAILED" ? (
            <>
              <p className="text-muted-foreground">{t("failed")}</p>
              <form action={retry}>
                <Button type="submit">{t("retry")}</Button>
              </form>
            </>
          ) : outcome === "PENDING" && sessionUrl ? (
            <>
              <p className="text-muted-foreground">{t("pending")}</p>
              <a href={sessionUrl} className={buttonVariants()}>
                {t("continue")}
              </a>
            </>
          ) : (
            <p className="text-muted-foreground">{t("pending")}</p>
          )}
          <Link href="/account/orders" className="block text-muted-foreground underline">
            {t("viewOrders")}
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}
