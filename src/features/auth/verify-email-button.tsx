"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { sendVerificationAction } from "./actions";
import { errorKey } from "./errors";

export function VerifyEmailButton() {
  const t = useTranslations("auth");
  const [state, dispatch, pending] = useActionState(sendVerificationAction, null);

  return (
    <form action={dispatch}>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700"
      >
        {pending ? "…" : t("sendVerification")}
      </button>
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
