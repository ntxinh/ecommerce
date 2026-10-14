"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import type { SellerProductRow } from "@/server/modules/catalog/manage";
import { duplicateProductAction, setProductStatusAction } from "./actions";

const ERROR_KEYS = new Set(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "INVALID_INPUT"]);

/** Row action buttons: publish/unpublish/archive/restore/duplicate.
 *  Client island so expected failures surface as toasts, not a 500 page. */
export function ProductRowActions({ product }: { product: SellerProductRow }) {
  const t = useTranslations("seller");
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>) => {
    const fd = new FormData();
    fd.set("productId", product.id);
    start(async () => {
      const res = await action(fd);
      if (res.ok) router.refresh();
      else
        toast.error(
          t(ERROR_KEYS.has(res.error ?? "") ? `errors.${res.error}` : "errors.INVALID_INPUT"),
        );
    });
  };

  const statusBtn = (status: "DRAFT" | "ACTIVE" | "ARCHIVED", label: string) => (
    <Button
      key={status}
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        run((fd) => {
          fd.set("status", status);
          return setProductStatusAction(fd);
        })
      }
    >
      {label}
    </Button>
  );

  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/seller/products/${product.id}`}>{t("edit")}</Link>
      </Button>
      {product.status === "DRAFT" ? statusBtn("ACTIVE", t("publish")) : null}
      {product.status === "ACTIVE" ? statusBtn("DRAFT", t("unpublish")) : null}
      {product.status !== "ARCHIVED" ? statusBtn("ARCHIVED", t("archive")) : null}
      {product.status === "ARCHIVED" ? statusBtn("DRAFT", t("restore")) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => run(duplicateProductAction)}
      >
        {t("duplicate")}
      </Button>
    </div>
  );
}
