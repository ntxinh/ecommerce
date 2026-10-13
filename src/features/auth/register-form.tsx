"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { registerAction } from "./actions";
import { errorKey, fieldKey } from "./errors";
import { Field, Submit } from "./ui";
import { useAuthAction } from "./use-auth-action";

export function RegisterForm() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const { state, dispatch, pending } = useAuthAction(registerAction);
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={dispatch} className="space-y-4">
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {t(errorKey(state.error))}
        </p>
      ) : null}
      <Field id="name" label={t("name")} error={fe?.name ? t(fieldKey(fe.name)) : undefined}>
        <Input id="name" name="name" autoComplete="name" required aria-invalid={!!fe?.name} />
      </Field>
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
          autoComplete="new-password"
          required
          minLength={8}
          aria-invalid={!!fe?.password}
        />
      </Field>
      <Submit pending={pending}>{tc("register")}</Submit>
    </form>
  );
}
