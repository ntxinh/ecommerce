"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { loginAction } from "./actions";
import { errorKey, fieldKey } from "./errors";
import { Field, Submit } from "./ui";
import { useAuthAction } from "./use-auth-action";

export function LoginForm() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const { state, dispatch, pending } = useAuthAction(loginAction);
  const fe = state && !state.ok ? state.fieldErrors : undefined;

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
      <Submit pending={pending}>{tc("signIn")}</Submit>
    </form>
  );
}
