"use client";

import { useTranslations } from "next-intl";
import { logoutAction } from "./actions";
import { useAuthAction } from "./use-auth-action";

export function LogoutButton() {
  const tc = useTranslations("common");
  const { dispatch, pending } = useAuthAction(logoutAction);

  return (
    <form action={dispatch}>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700"
      >
        {pending ? "…" : tc("signOut")}
      </button>
    </form>
  );
}
