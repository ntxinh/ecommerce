"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { createReviewAction } from "./actions";

const ERROR_KEYS: Record<string, true> = {
  UNAUTHORIZED: true,
  FORBIDDEN: true,
  NOT_FOUND: true,
  INVALID_INPUT: true,
};

/**
 * Buyer-facing review form for one purchased order item. Rendered only where
 * `listReviewableItems` says the item is still reviewable; the service
 * re-checks order ownership, fulfillment status, and the own-shop rule.
 */
export function ReviewForm({
  orderItemId,
  productName,
}: {
  orderItemId: string;
  productName?: string;
}) {
  const t = useTranslations("reviews");
  const router = useRouter();
  const [pending, start] = useTransition();
  const id = `review-${orderItemId}`;

  return (
    <form
      className="space-y-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("orderItemId", orderItemId);
        start(async () => {
          const res = await createReviewAction(fd);
          if (res.ok) router.refresh();
          else
            toast.error(
              t(ERROR_KEYS[res.error ?? ""] ? `errors.${res.error}` : "errors.INVALID_INPUT"),
            );
        });
      }}
    >
      {productName ? <p className="font-medium text-sm">{productName}</p> : null}
      <div className="space-y-1">
        <Label htmlFor={`${id}-rating`}>{t("rating")}</Label>
        <select
          id={`${id}-rating`}
          name="rating"
          required
          defaultValue="5"
          disabled={pending}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          {[5, 4, 3, 2, 1].map((r) => (
            <option key={r} value={r}>
              {t("stars", { count: r })}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-title`}>{t("titleLabel")}</Label>
        <Input
          id={`${id}-title`}
          name="title"
          maxLength={200}
          placeholder={t("titlePlaceholder")}
          disabled={pending}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-body`}>{t("bodyLabel")}</Label>
        <textarea
          id={`${id}-body`}
          name="body"
          maxLength={5000}
          rows={3}
          placeholder={t("bodyPlaceholder")}
          disabled={pending}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-images`}>{t("images")}</Label>
        <Input
          id={`${id}-images`}
          name="images"
          placeholder={t("imagesPlaceholder")}
          disabled={pending}
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
