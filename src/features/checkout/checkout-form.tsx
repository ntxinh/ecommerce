"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useRouter } from "@/i18n/navigation";
import { formatVnd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CartShopGroup } from "@/server/modules/cart/service";
import { type CheckoutActionState, placeOrderAction } from "./actions";
import { CHECKOUT_STEPS, useCheckoutStep } from "./use-checkout-step";

export type CheckoutAddress = {
  id: string;
  label: string;
};

export type ShippingOption = {
  method: string;
  feeVnd: number;
};

const ERROR_KEYS = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_INPUT",
  "INSUFFICIENT_STOCK",
  "VOUCHER_INVALID",
  "IDEMPOTENCY_CONFLICT",
]);

/**
 * Checkout stepper: address → per-shop shipping → payment → review. Zustand
 * holds the step index only; every field stays in the form so one submit sends
 * the whole order.
 */
export function CheckoutForm({
  addresses,
  shippingOptions,
  byShop,
  subtotalVnd,
}: {
  addresses: CheckoutAddress[];
  shippingOptions: ShippingOption[];
  byShop: CartShopGroup[];
  subtotalVnd: number;
}) {
  const t = useTranslations("checkout");
  const locale = useLocale();
  const { step, goTo } = useCheckoutStep();
  const router = useRouter();
  // One idempotency key per form lifetime — a transport-error retry must replay
  // the same key, not mint a fresh one (crypto.randomUUID() in render would).
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [state, dispatch, pending] = useActionState<CheckoutActionState, FormData>(
    placeOrderAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      goTo(0); // reset the stepper before leaving so a later visit starts fresh
      router.push({ pathname: "/checkout/confirmation", query: { order: state.orderId } });
    } else if (state && !state.ok) {
      toast.error(
        t(ERROR_KEYS.has(state.error) ? `errors.${state.error}` : "errors.INVALID_INPUT"),
      );
    }
  }, [state, router, t, goTo]);

  return (
    <form action={dispatch} className="space-y-6">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <nav aria-label={t("stepsLabel")} className="flex flex-wrap gap-2">
        {CHECKOUT_STEPS.map((s, i) => (
          <Button
            key={s}
            type="button"
            variant={i === step ? "default" : "outline"}
            size="sm"
            onClick={() => goTo(i)}
          >
            {i + 1}. {t(`steps.${s}`)}
          </Button>
        ))}
      </nav>

      <Card className={cn(step !== 0 && "hidden")}>
        <CardHeader>
          <CardTitle>{t("steps.address")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {addresses.map((a, i) => (
            <Label key={a.id} className="flex items-start gap-2 font-normal">
              <input
                type="radio"
                name="addressId"
                value={a.id}
                defaultChecked={i === 0}
                className="mt-1"
              />
              <span>{a.label}</span>
            </Label>
          ))}
          <Label className="flex items-start gap-2 font-normal">
            <input
              type="radio"
              name="addressId"
              value="new"
              defaultChecked={addresses.length === 0}
              className="mt-1"
            />
            <span>{t("newAddress")}</span>
          </Label>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["recipientName", "phone", "line1", "ward", "district", "city"] as const).map(
              (field) => (
                <div key={field} className="space-y-1">
                  <Label htmlFor={field}>{t(`addressFields.${field}`)}</Label>
                  <Input id={field} name={field} />
                </div>
              ),
            )}
          </div>
        </CardContent>
      </Card>

      <Card className={cn(step !== 1 && "hidden")}>
        <CardHeader>
          <CardTitle>{t("steps.shipping")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {byShop.map((group) => (
            <div key={group.shopId} className="space-y-1">
              <Label htmlFor={`shipping_${group.shopId}`}>{group.shopName}</Label>
              <select
                id={`shipping_${group.shopId}`}
                name={`shipping_${group.shopId}`}
                defaultValue="standard"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {shippingOptions.map((o) => (
                  <option key={o.method} value={o.method}>
                    {t(`shippingMethods.${o.method}`)} — {formatVnd(o.feeVnd, locale)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className={cn(step !== 2 && "hidden")}>
        <CardHeader>
          <CardTitle>{t("steps.payment")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="voucherCodes">{t("vouchers")}</Label>
            <Input id="voucherCodes" name="voucherCodes" placeholder={t("vouchersPlaceholder")} />
            <p className="text-xs text-muted-foreground">{t("vouchersHint")}</p>
          </div>
          <Separator />
          <div className="space-y-2">
            {(["COD", "MOCK_WALLET"] as const).map((m, i) => (
              <Label key={m} className="flex items-center gap-2 font-normal">
                <input type="radio" name="paymentMethod" value={m} defaultChecked={i === 0} />
                {t(`paymentMethods.${m}`)}
              </Label>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="simulate">{t("simulate")}</Label>
            <select
              id="simulate"
              name="simulate"
              defaultValue=""
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">{t("simulateNone")}</option>
              <option value="success">{t("simulateSuccess")}</option>
              <option value="failure">{t("simulateFailure")}</option>
            </select>
            <p className="text-xs text-muted-foreground">{t("simulateHint")}</p>
          </div>
        </CardContent>
      </Card>

      <Card className={cn(step !== 3 && "hidden")}>
        <CardHeader>
          <CardTitle>{t("steps.review")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {byShop.map((group) => (
            <div key={group.shopId} className="space-y-1">
              <p className="font-medium">{group.shopName}</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {group.items.map((item) => (
                  <li key={item.cartItemId}>
                    {item.name} × {item.qty} — {formatVnd(item.unitPriceVnd * item.qty, locale)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <Separator />
          <p className="text-sm">
            {t("merchandiseSubtotal")}: {formatVnd(subtotalVnd, locale)}
          </p>
          <p className="text-xs text-muted-foreground">{t("totalNote")}</p>
        </CardContent>
      </Card>

      {state && !state.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {t(ERROR_KEYS.has(state.error) ? `errors.${state.error}` : "errors.INVALID_INPUT")}
        </p>
      ) : null}

      <div className="flex justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={() => goTo(Math.max(step - 1, 0))}
          disabled={step === 0}
        >
          {t("back")}
        </Button>
        {step < CHECKOUT_STEPS.length - 1 ? (
          <Button type="button" onClick={() => goTo(step + 1)}>
            {t("next")}
          </Button>
        ) : (
          <Button type="submit" disabled={pending}>
            {pending ? "…" : t("placeOrder")}
          </Button>
        )}
      </div>
    </form>
  );
}
