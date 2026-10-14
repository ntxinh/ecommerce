"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { saveProductAction } from "./actions";

export type ShopOption = { id: string; name: string };
export type CategoryOption = { id: string; label: string };
export type BrandOption = { id: string; name: string };

export type VariantDraft = {
  id?: string;
  sku: string;
  nameEn: string;
  nameVi: string;
  attrsJson: string;
  basePriceVnd: string;
  salePriceVnd: string;
  stock: string;
  /** The on-hand value this row was loaded with — server writes delta vs it. */
  baseline?: string;
};

export type ProductFormValues = {
  id?: string;
  nameEn: string;
  nameVi: string;
  descriptionEn: string;
  descriptionVi: string;
  categoryId: string;
  brandId?: string | null;
  variants: VariantDraft[];
};

const fieldClass =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

const emptyVariant: VariantDraft = {
  sku: "",
  nameEn: "",
  nameVi: "",
  attrsJson: "{}",
  basePriceVnd: "",
  salePriceVnd: "",
  stock: "",
};

const ERROR_KEYS = new Set(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "INVALID_INPUT"]);

/** Variant rows go to the server as one JSON blob — FormData can't nest. */
function serializeVariants(rows: VariantDraft[]): string {
  return JSON.stringify(
    rows.map((v) => {
      let attrs: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(v.attrsJson || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) attrs = parsed;
      } catch {
        // invalid attrs JSON degrades to {} — the field is cosmetic metadata
      }
      return {
        id: v.id || undefined,
        sku: v.sku,
        nameEn: v.nameEn,
        nameVi: v.nameVi,
        attrs,
        basePriceVnd: v.basePriceVnd || undefined,
        salePriceVnd: v.salePriceVnd || undefined,
        stock: v.stock || undefined,
        baseline: v.id ? v.baseline : undefined,
      };
    }),
  );
}

export function ProductForm({
  shops,
  categories,
  brands,
  product,
}: {
  shops: ShopOption[];
  categories: CategoryOption[];
  brands: BrandOption[];
  product?: ProductFormValues;
}) {
  const t = useTranslations("seller");
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(saveProductAction, null);
  const [variants, setVariants] = useState<VariantDraft[]>(product?.variants ?? []);
  const [shopId, setShopId] = useState(shops[0]?.id ?? "");

  useEffect(() => {
    if (state?.ok) router.push("/seller/products");
  }, [state, router]);

  const patchVariant = (i: number, patch: Partial<VariantDraft>) =>
    setVariants((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form action={dispatch} className="space-y-8">
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {t(ERROR_KEYS.has(state.error) ? `errors.${state.error}` : "errors.INVALID_INPUT")}
        </p>
      ) : null}
      {product?.id ? <input type="hidden" name="id" value={product.id} /> : null}
      <input type="hidden" name="variants" value={serializeVariants(variants)} readOnly />

      {shops.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="shopId">{t("fieldShop")}</Label>
          <select
            id="shopId"
            name="shopId"
            className={fieldClass}
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
            disabled={!!product?.id}
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="shopId" value={shopId} />
      )}
      {shops.length > 1 && product?.id ? (
        <input type="hidden" name="shopId" value={shopId} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="nameEn">{t("fieldNameEn")}</Label>
          <Input id="nameEn" name="nameEn" required defaultValue={product?.nameEn} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nameVi">{t("fieldNameVi")}</Label>
          <Input id="nameVi" name="nameVi" required defaultValue={product?.nameVi} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="categoryId">{t("fieldCategory")}</Label>
          <select
            id="categoryId"
            name="categoryId"
            required
            className={fieldClass}
            defaultValue={product?.categoryId ?? ""}
          >
            <option value="" disabled>
              —
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="brandId">{t("fieldBrand")}</Label>
          <select
            id="brandId"
            name="brandId"
            className={fieldClass}
            defaultValue={product?.brandId ?? ""}
          >
            <option value="">—</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="descriptionEn">{t("fieldDescEn")}</Label>
          <textarea
            id="descriptionEn"
            name="descriptionEn"
            rows={3}
            className={fieldClass}
            defaultValue={product?.descriptionEn}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="descriptionVi">{t("fieldDescVi")}</Label>
          <textarea
            id="descriptionVi"
            name="descriptionVi"
            rows={3}
            className={fieldClass}
            defaultValue={product?.descriptionVi}
          />
        </div>
        {!product?.id ? (
          <div className="space-y-1.5">
            <Label htmlFor="status">{t("fieldStatus")}</Label>
            <select id="status" name="status" className={fieldClass} defaultValue="DRAFT">
              <option value="DRAFT">{t("status.DRAFT")}</option>
              <option value="ACTIVE">{t("status.ACTIVE")}</option>
            </select>
          </div>
        ) : null}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">{t("variants")}</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setVariants((rows) => [...rows, { ...emptyVariant }])}
          >
            {t("addVariant")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("variantsHint")}</p>
        {variants.map((v, i) => (
          <div key={v.id ?? `new-${i}`} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-6">
            <div className="space-y-1">
              <Label>{t("variantSku")}</Label>
              <Input
                required
                value={v.sku}
                onChange={(e) => patchVariant(i, { sku: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("fieldNameEn")}</Label>
              <Input
                required
                value={v.nameEn}
                onChange={(e) => patchVariant(i, { nameEn: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("fieldNameVi")}</Label>
              <Input
                required
                value={v.nameVi}
                onChange={(e) => patchVariant(i, { nameVi: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("variantBasePrice")}</Label>
              <Input
                required
                type="number"
                min={0}
                value={v.basePriceVnd}
                onChange={(e) => patchVariant(i, { basePriceVnd: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("variantSalePrice")}</Label>
              <Input
                type="number"
                min={0}
                value={v.salePriceVnd}
                onChange={(e) => patchVariant(i, { salePriceVnd: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("variantStock")}</Label>
              <Input
                type="number"
                min={0}
                value={v.stock}
                onChange={(e) => patchVariant(i, { stock: e.target.value })}
              />
            </div>
            <div className="space-y-1 sm:col-span-5">
              <Label>{t("variantAttrs")}</Label>
              <Input
                value={v.attrsJson}
                placeholder='{"size":"M"}'
                onChange={(e) => patchVariant(i, { attrsJson: e.target.value })}
              />
            </div>
            <div className="flex items-end">
              {!v.id ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setVariants((rows) => rows.filter((_, j) => j !== i))}
                >
                  {t("removeVariant")}
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <Button type="submit" disabled={pending} className={cn(pending && "opacity-60")}>
        {pending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}
