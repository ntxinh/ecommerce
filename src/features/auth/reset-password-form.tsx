"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { resetPasswordAction } from "./actions";
import { errorKey, fieldKey } from "./errors";
import { Field, Submit } from "./ui";
import { useAuthAction } from "./use-auth-action";

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const { state, dispatch, pending } = useAuthAction(resetPasswordAction);
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={dispatch} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {t(errorKey(state.error))}
        </p>
      ) : null}
      <Field
        id="password"
        label={t("newPassword")}
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
      <Submit pending={pending}>{t("setNewPassword")}</Submit>
    </form>
  );
}
