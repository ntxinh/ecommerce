"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { formatVnd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addToCartAction, type CartActionState } from "./actions";
import { useGuestCart } from "./use-guest-cart";

export type ProductVariantOption = {
  id: string;
  name: string;
  sku: string;
  priceVnd: number;
  /** Units on hand minus reserved; omit when unknown. */
  available?: number;
};

/** Variant selector + add-to-cart. Logged-in → server action; guest → local
 *  Zustand cart (merged into the server cart at login). */
export function AddToCart({
  productName,
  shopName,
  variants,
  loggedIn,
}: {
  productName: string;
  shopName: string;
  variants: ProductVariantOption[];
  loggedIn: boolean;
}) {
  const t = useTranslations("cart");
  const ts = useTranslations("storefront");
  const locale = useLocale();
  const router = useRouter();
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [qty, setQty] = useState(1);
  const [state, dispatch, pending] = useActionState<CartActionState, FormData>(
    addToCartAction,
    null,
  );
  const guestAdd = useGuestCart((s) => s.add);
  const variant = variants.find((v) => v.id === variantId);

  useEffect(() => {
    if (state?.ok) {
      toast.success(t("added"));
      router.refresh();
    } else if (state && !state.ok) {
      toast.error(t(`errors.${state.error}`));
    }
  }, [state, router, t]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (loggedIn) return; // server action path — FormData flows to dispatch
    e.preventDefault();
    if (!variant) return;
    guestAdd({
      variantId: variant.id,
      qty,
      name: `${productName} · ${variant.name}`,
      sku: variant.sku,
      unitPriceVnd: variant.priceVnd,
      shopName,
    });
    toast.success(t("added"));
  };

  return (
    <form action={dispatch} onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="variantId">{t("variant")}</Label>
        <select
          id="variantId"
          name="variantId"
          value={variantId}
          onChange={(e) => setVariantId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {variants.map((v) => (
            <option key={v.id} value={v.id} disabled={v.available === 0}>
              {v.name} — {v.sku}
              {v.available != null
                ? ` — ${v.available > 0 ? ts("inStockN", { count: v.available }) : ts("outOfStock")}`
                : ""}
            </option>
          ))}
        </select>
        {variant && (
          <p className="font-medium">
            {formatVnd(variant.priceVnd, locale)}
            {variant.available != null && (
              <span className="ml-2 text-muted-foreground text-xs">
                {variant.available > 0
                  ? ts("inStockN", { count: variant.available })
                  : ts("outOfStock")}
              </span>
            )}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="qty">{t("quantity")}</Label>
        <Input
          id="qty"
          name="qty"
          type="number"
          min={1}
          max={999}
          value={qty}
          onChange={(e) => setQty(Number(e.target.value) || 1)}
          className="w-24"
        />
      </div>
      <Button
        type="submit"
        disabled={pending || !variant || variant.available === 0}
        className={cn("w-full sm:w-auto")}
      >
        {pending ? "…" : t("addToCart")}
      </Button>
    </form>
  );
}
