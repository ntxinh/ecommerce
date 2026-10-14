"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { useGuestCart } from "@/features/cart/use-guest-cart";
import { loginAction } from "./actions";
import { errorKey, fieldKey } from "./errors";
import { Field, Submit } from "./ui";
import { useAuthAction } from "./use-auth-action";

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const { state, dispatch, pending } = useAuthAction(loginAction);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  // Snapshot the guest cart once — a re-render must not resend merged items.
  const [guestItems] = useState(() => JSON.stringify(useGuestCart.getState().items));
  const guestClear = useGuestCart((s) => s.clear);

  useEffect(() => {
    if (state?.ok) guestClear();
  }, [state, guestClear]);

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
      {next ? <input type="hidden" name="next" value={next} readOnly /> : null}
      <Submit pending={pending}>{tc("signIn")}</Submit>
    </form>
  );
}
