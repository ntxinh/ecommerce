"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { applyToSellAction, type SellActionState, updateShopProfileAction } from "./actions";

const fieldClass =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";
const ERROR_KEYS = new Set(["UNAUTHORIZED", "FORBIDDEN", "INVALID_INPUT", "NOT_FOUND"]);

function useSellAction(action: (prev: SellActionState, fd: FormData) => Promise<SellActionState>) {
  const t = useTranslations("sellers");
  const router = useRouter();
  const wrapped = async (prev: SellActionState, fd: FormData) => {
    const res = await action(prev, fd);
    if (!res) return res;
    if (res.ok) router.refresh();
    else toast.error(t(ERROR_KEYS.has(res.error) ? `errors.${res.error}` : "errors.INVALID_INPUT"));
    return res;
  };
  const [state, dispatch, pending] = useActionState(wrapped, null);
  return { state, dispatch, pending };
}

/** Seller application form — also the resubmit path after CHANGES_REQUESTED. */
export function ApplyForm({
  defaults,
}: {
  defaults?: { shopName: string; description: string; registration: string };
}) {
  const t = useTranslations("sellers");
  const { state, dispatch, pending } = useSellAction(applyToSellAction);
  return (
    <form action={dispatch} className="space-y-4">
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {t(ERROR_KEYS.has(state.error) ? `errors.${state.error}` : "errors.INVALID_INPUT")}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="shopName">{t("fieldShopName")}</Label>
        <Input
          id="shopName"
          name="shopName"
          required
          minLength={2}
          maxLength={80}
          defaultValue={defaults?.shopName}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">{t("fieldDescription")}</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          maxLength={500}
          className={fieldClass}
          defaultValue={defaults?.description}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="registration">{t("fieldRegistration")}</Label>
        <Input id="registration" name="registration" defaultValue={defaults?.registration} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? t("applying") : t("apply")}
      </Button>
    </form>
  );
}

/** Shop profile editor for /seller/settings (one per owned shop). */
export function ShopProfileForm({
  shop,
}: {
  shop: { id: string; name: string; description: string };
}) {
  const t = useTranslations("sellers");
  const { state, dispatch, pending } = useSellAction(updateShopProfileAction);
  return (
    <form action={dispatch} className="space-y-4">
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {t(ERROR_KEYS.has(state.error) ? `errors.${state.error}` : "errors.INVALID_INPUT")}
        </p>
      ) : null}
      <input type="hidden" name="shopId" value={shop.id} />
      <div className="space-y-1.5">
        <Label htmlFor={`name-${shop.id}`}>{t("fieldShopName")}</Label>
        <Input
          id={`name-${shop.id}`}
          name="name"
          required
          maxLength={80}
          defaultValue={shop.name}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`description-${shop.id}`}>{t("fieldDescription")}</Label>
        <textarea
          id={`description-${shop.id}`}
          name="description"
          rows={3}
          maxLength={500}
          className={fieldClass}
          defaultValue={shop.description}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("saveShop")}
      </Button>
    </form>
  );
}
