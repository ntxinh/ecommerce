"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { logoutAction } from "./actions";
import { useAuthAction } from "./use-auth-action";

export function LogoutButton() {
  const tc = useTranslations("common");
  const { dispatch, pending } = useAuthAction(logoutAction);

  return (
    <form action={dispatch}>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "…" : tc("signOut")}
      </Button>
    </form>
  );
}
