"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import {
  cancelOrderAction,
  completeOrderAction,
  confirmOrderAction,
  deliverOrderAction,
  packOrderAction,
  shipOrderAction,
} from "./order-actions";

export type FulfillmentAction = "confirm" | "pack" | "ship" | "deliver" | "complete" | "cancel";

const SIMPLE: Record<
  Exclude<FulfillmentAction, "ship">,
  (fd: FormData) => Promise<{ ok: boolean; error?: string }>
> = {
  confirm: confirmOrderAction,
  pack: packOrderAction,
  deliver: deliverOrderAction,
  complete: completeOrderAction,
  cancel: cancelOrderAction,
};

const ERROR_KEYS = new Set(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "INVALID_INPUT"]);

/**
 * Seller-order transition buttons. `actions` is the legal set computed
 * server-side from SELLER_ORDER_TRANSITIONS; failures still surface as toasts
 * (invalid state races, unpaid parent, duplicate tracking number).
 */
export function OrderActionButtons({
  sellerOrderId,
  actions,
}: {
  sellerOrderId: string;
  actions: FulfillmentAction[];
}) {
  const t = useTranslations("seller");
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>) => {
    const fd = new FormData();
    fd.set("sellerOrderId", sellerOrderId);
    start(async () => {
      const res = await action(fd);
      if (res.ok) router.refresh();
      else
        toast.error(
          t(
            ERROR_KEYS.has(res.error ?? "")
              ? `orderErrors.${res.error}`
              : "orderErrors.INVALID_INPUT",
          ),
        );
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(actions.filter((a) => a !== "ship") as (keyof typeof SIMPLE)[]).map((a) => (
          <Button
            key={a}
            type="button"
            variant={a === "cancel" ? "destructive" : "default"}
            size="sm"
            disabled={pending}
            onClick={() => run(SIMPLE[a])}
          >
            {t(`orderActions.${a}`)}
          </Button>
        ))}
      </div>
      {actions.includes("ship") ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("sellerOrderId", sellerOrderId);
            start(async () => {
              const res = await shipOrderAction(fd);
              if (res.ok) router.refresh();
              else
                toast.error(
                  t(
                    ERROR_KEYS.has(res.error ?? "")
                      ? `orderErrors.${res.error}`
                      : "orderErrors.INVALID_INPUT",
                  ),
                );
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="carrier">{t("shipCarrier")}</Label>
            <Input id="carrier" name="carrier" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="trackingNumber">{t("shipTracking")}</Label>
            <Input id="trackingNumber" name="trackingNumber" required />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {t("orderActions.ship")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
