"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useWishlist } from "@/features/wishlist/use-wishlist";
import { logoutAction } from "./actions";
import { useAuthAction } from "./use-auth-action";

export function LogoutButton() {
  const tc = useTranslations("common");
  const { dispatch, pending } = useAuthAction(logoutAction);

  return (
    <form action={dispatch}>
      <Button
        type="submit"
        variant="outline"
        disabled={pending}
        // Server-loaded wishlist ids must not linger for the next guest session.
        onClick={() => useWishlist.getState().clear()}
      >
        {pending ? "…" : tc("signOut")}
      </Button>
    </form>
  );
}
