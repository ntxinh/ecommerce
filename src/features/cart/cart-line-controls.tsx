"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { type CartActionState, removeCartItemAction, updateCartItemAction } from "./actions";

/** Server-cart line controls. Plain <form action={…}> posts here never
 *  repainted under cacheComponents — the action response carried no updated
 *  tree, leaving qty/remove stale. Client island + router.refresh() matches
 *  every other mutation in the codebase. */
export function CartLineControls({ cartItemId, qty }: { cartItemId: string; qty: number }) {
  const t = useTranslations("cart");
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (
    action: (prev: CartActionState, fd: FormData) => Promise<{ ok: boolean }>,
    qtyValue?: number,
  ) => {
    const fd = new FormData();
    fd.set("cartItemId", cartItemId);
    if (qtyValue !== undefined) fd.set("qty", String(qtyValue));
    start(async () => {
      const res = await action(null, fd);
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        disabled={pending}
        aria-label={t("decrease")}
        onClick={() => run(updateCartItemAction, qty - 1)}
      >
        −
      </Button>
      <span className="w-8 text-center">{qty}</span>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        disabled={pending}
        aria-label={t("increase")}
        onClick={() => run(updateCartItemAction, qty + 1)}
      >
        +
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        className="ml-2"
        onClick={() => run(removeCartItemAction)}
      >
        {t("remove")}
      </Button>
    </div>
  );
}
