"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import type { ActionResult, ActionState } from "./actions";

/** Wraps an action: runs it via useActionState and follows `result.redirect` locale-aware. */
export function useAuthAction(
  action: (prev: ActionState, formData: FormData) => Promise<ActionResult>,
) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(action, null);
  const redirectTo = state?.ok ? state.redirect : undefined;

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo, router]);

  return { state, dispatch, pending };
}
