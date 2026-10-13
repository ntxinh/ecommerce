"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { sendVerificationAction } from "./actions";
import { errorKey } from "./errors";

export function VerifyEmailButton() {
  const t = useTranslations("auth");
  const [state, dispatch, pending] = useActionState(sendVerificationAction, null);

  return (
    <form action={dispatch}>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "…" : t("sendVerification")}
      </Button>
      {state?.ok ? (
        <p role="status" className="mt-2 text-sm text-green-700 dark:text-green-400">
          {t("verifySent")}
        </p>
      ) : state && !state.ok ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {t(errorKey(state.error))}
        </p>
      ) : null}
    </form>
  );
}
