"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useGuestCart } from "@/features/cart/use-guest-cart";
import { useWishlist } from "@/features/wishlist/use-wishlist";
import { loginAction } from "./actions";
import { errorKey, fieldKey } from "./errors";
import { Field, Submit } from "./ui";
import { useAuthAction } from "./use-auth-action";

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const { state, dispatch, pending } = useAuthAction(loginAction);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  // Persisted guest cart only exists client-side — read it post-mount, not in
  // the SSR initialiser (hydration would keep value="[]" and drop the merge).
  const [guestItems, setGuestItems] = useState("[]");
  const [wishlistIds, setWishlistIds] = useState("[]");
  const guestClear = useGuestCart((s) => s.clear);
  const wishlistClear = useWishlist((s) => s.clear);

  useEffect(() => {
    setGuestItems(JSON.stringify(useGuestCart.getState().items));
    setWishlistIds(JSON.stringify(useWishlist.getState().productIds));
  }, []);

  useEffect(() => {
    if (!state?.ok) return;
    if (state.merged === false) {
      toast.warning(t("mergeFailed"));
    } else {
      guestClear();
    }
    if (state.wishlistMerged === false) {
      toast.warning(t("wishlistMergeFailed"));
    } else {
      wishlistClear();
    }
  }, [state, guestClear, wishlistClear, t]);

  return (
    <form action={dispatch} className="space-y-4">
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {t(errorKey(state.error))}
        </p>
      ) : null}
      <Field id="email" label={t("email")} error={fe?.email ? t(fieldKey(fe.email)) : undefined}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={!!fe?.email}
        />
      </Field>
      <Field
        id="password"
        label={t("password")}
        error={fe?.password ? t(fieldKey(fe.password)) : undefined}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={!!fe?.password}
        />
      </Field>
      <input type="hidden" name="guestItems" value={guestItems} readOnly />
      <input type="hidden" name="wishlistIds" value={wishlistIds} readOnly />
      {next ? <input type="hidden" name="next" value={next} readOnly /> : null}
      <Submit pending={pending}>{tc("signIn")}</Submit>
    </form>
  );
}
