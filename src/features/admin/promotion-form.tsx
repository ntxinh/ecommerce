"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { createPromotionAction } from "./actions";

const ERROR_KEYS: Record<string, true> = {
  UNAUTHORIZED: true,
  FORBIDDEN: true,
  NOT_FOUND: true,
  INVALID_INPUT: true,
};

const toLocalInput = (ms: number) => new Date(ms).toISOString().slice(0, 16);

/**
 * Create a promotion. `scopes` selects the scope dropdown options and
 * `shops` (seller variant) replaces the free-text shopId field with a picker.
 */
export function PromotionForm({
  scopes,
  shops,
}: {
  scopes: ("PRODUCT" | "SHOP" | "FLASH")[];
  shops?: { id: string; name: string }[];
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [scope, setScope] = useState(scopes[0]);
  const [kind, setKind] = useState<"PERCENT" | "FIXED" | "FLASH_PRICE">("PERCENT");
  const now = Date.now();
  const singleShop = shops?.length === 1;
  // Mirrors the service guard: FLASH ⇔ FLASH_PRICE, else PERCENT/FIXED.
  const kinds: readonly ("PERCENT" | "FIXED" | "FLASH_PRICE")[] =
    scope === "FLASH" ? ["FLASH_PRICE"] : ["PERCENT", "FIXED"];
  const effectiveKind = kinds.includes(kind) ? kind : kinds[0];

  return (
    <form
      className="grid grid-cols-2 gap-2 rounded-md border p-4 md:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        start(async () => {
          const res = await createPromotionAction(new FormData(form));
          if (res.ok) {
            toast.success(t("promotions.created"));
            form.reset();
            router.refresh();
          } else {
            toast.error(
              t(ERROR_KEYS[res.error ?? ""] ? `errors.${res.error}` : "errors.INVALID_INPUT"),
            );
          }
        });
      }}
    >
      <select
        name="scope"
        defaultValue={scopes[0]}
        onChange={(e) => setScope(e.target.value as typeof scope)}
        className="h-9 rounded-md border bg-background px-2 text-sm"
        aria-label={t("promotions.fieldScope")}
      >
        {scopes.map((s) => (
          <option key={s} value={s}>
            {t(`promotions.scope.${s}`)}
          </option>
        ))}
      </select>
      {shops ? (
        singleShop ? (
          <input type="hidden" name="shopId" value={shops[0].id} />
        ) : (
          <select
            name="shopId"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            aria-label={t("promotions.fieldShop")}
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )
      ) : (
        <Input name="shopId" placeholder={t("promotions.fieldShop")} />
      )}
      {scopes.includes("PRODUCT") || scopes.includes("FLASH") ? (
        <Input name="productId" placeholder={t("promotions.fieldProduct")} />
      ) : null}
      <select
        name="kind"
        value={effectiveKind}
        onChange={(e) => setKind(e.target.value as typeof kind)}
        className="h-9 rounded-md border bg-background px-2 text-sm"
        aria-label={t("promotions.fieldKind")}
      >
        {kinds.map((k) => (
          <option key={k} value={k}>
            {t(`promotions.kind.${k}`)}
          </option>
        ))}
      </select>
      <Input name="value" type="number" min={1} placeholder={t("promotions.fieldValue")} required />
      <Input
        name="startsAt"
        type="datetime-local"
        aria-label={t("promotions.fieldStarts")}
        defaultValue={toLocalInput(now)}
        required
      />
      <Input
        name="endsAt"
        type="datetime-local"
        aria-label={t("promotions.fieldEnds")}
        defaultValue={toLocalInput(now + 30 * 86_400_000)}
        required
      />
      <Button type="submit" disabled={pending} className="col-span-2 md:col-span-1">
        {t("promotions.create")}
      </Button>
    </form>
  );
}
