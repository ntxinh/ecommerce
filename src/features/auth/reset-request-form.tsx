"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { requestResetAction } from "./actions";
import { errorKey, fieldKey } from "./errors";
import { Field, Submit } from "./ui";
import { useAuthAction } from "./use-auth-action";

export function ResetRequestForm() {
  const t = useTranslations("auth");
  const { state, dispatch, pending } = useAuthAction(requestResetAction);
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  if (state?.ok) {
    return (
      <p role="status" className="text-sm text-green-700 dark:text-green-400">
        {t("resetSent")}
      </p>
    );
  }

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
      <Submit pending={pending}>{t("sendReset")}</Submit>
    </form>
  );
}
