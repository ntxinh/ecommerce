"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { requestReturnAction } from "./actions";

export type ReturnableItem = { orderItemId: string; name: string; sku: string; qty: number };

const ERROR_KEYS: Record<string, true> = {
  UNAUTHORIZED: true,
  FORBIDDEN: true,
  NOT_FOUND: true,
  INVALID_INPUT: true,
  INVALID_STATE: true,
  RETURN_WINDOW_EXPIRED: true,
};
/** Buyer-facing return form for one seller-order leg: per-item qty (0 = skip)
 *  + restock flag, a shared reason, optional evidence URLs. Submits a FormData
 *  to `requestReturnAction`; the service re-checks window + claimable qty. */
export function ReturnForm({
  sellerOrderId,
  items,
}: {
  sellerOrderId: string;
  items: ReturnableItem[];
}) {
  const t = useTranslations("returns");
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const lines = items
          .map((i) => ({
            orderItemId: i.orderItemId,
            qty: Math.max(0, Math.floor(Number(data.get(`qty-${i.orderItemId}`) ?? 0)) || 0),
            restock: data.get(`restock-${i.orderItemId}`) === "on",
          }))
          .filter((l) => l.qty > 0);
        const fd = new FormData();
        fd.set("sellerOrderId", sellerOrderId);
        fd.set("items", JSON.stringify(lines));
        fd.set("reason", String(data.get("reason") ?? ""));
        fd.set("evidence", String(data.get("evidence") ?? ""));
        start(async () => {
          const res = await requestReturnAction(fd);
          if (res.ok) router.refresh();
          else
            toast.error(
              t(ERROR_KEYS[res.error ?? ""] ? `errors.${res.error}` : "errors.INVALID_INPUT"),
            );
        });
      }}
    >
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.orderItemId} className="flex items-center gap-3 text-sm">
            <div className="flex-1">
              {item.name}
              <span className="block text-xs text-muted-foreground">{item.sku}</span>
            </div>
            <Input
              name={`qty-${item.orderItemId}`}
              type="number"
              min={0}
              max={item.qty}
              defaultValue={0}
              aria-label={`${t("qty")}: ${item.name}`}
              className="w-20"
              disabled={pending}
            />
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input type="checkbox" name={`restock-${item.orderItemId}`} disabled={pending} />
              {t("restock")}
            </label>
          </div>
        ))}
      </div>
      <div className="space-y-1">
        <Label htmlFor={`reason-${sellerOrderId}`}>{t("reason")}</Label>
        <Input
          id={`reason-${sellerOrderId}`}
          name="reason"
          required
          minLength={3}
          maxLength={500}
          placeholder={t("reasonPlaceholder")}
          disabled={pending}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`evidence-${sellerOrderId}`}>{t("evidence")}</Label>
        <Input
          id={`evidence-${sellerOrderId}`}
          name="evidence"
          placeholder={t("evidencePlaceholder")}
          disabled={pending}
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {t("requestSubmit")}
      </Button>
    </form>
  );
}
