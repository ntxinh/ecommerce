"use client";

import { HeartIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toggleWishlistAction } from "./actions";
import { useWishlist } from "./use-wishlist";

/**
 * Heart toggle overlaid on product cards. Guests toggle the persisted local
 * list; signed-in users toggle the server wishlist and hydrate the store from
 * it. First mount fetches `/api/v1/me/wishlist` once so server-side additions
 * (e.g. another device) render filled.
 */
export function WishlistButton({ productId }: { productId: string }) {
  const t = useTranslations("storefront.wishlist");
  const productIds = useWishlist((s) => s.productIds);
  const hydrated = useWishlist((s) => s.hydrated);
  const wished = productIds.includes(productId);

  useEffect(() => {
    if (useWishlist.getState().hydrated) return;
    fetch("/api/v1/me/wishlist")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { data: { productIds: string[] } } | null) => {
        // Skip hydration if the user already toggled locally while the fetch
        // was in flight — ponytail: last-write-wins within a page load.
        if (b && !useWishlist.getState().hydrated)
          useWishlist.getState().hydrate(b.data.productIds);
      })
      .catch(() => {});
  }, []);

  const toggle = async () => {
    const fd = new FormData();
    fd.set("productId", productId);
    const res = await toggleWishlistAction(null, fd);
    if (res.ok) {
      useWishlist.getState().hydrate(res.productIds);
    } else if (res.error === "UNAUTHORIZED") {
      useWishlist.getState().toggle(productId);
    } else {
      toast.error(t("toggleFailed"));
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={wished ? t("remove") : t("add")}
      aria-pressed={wished}
      className={cn(
        "absolute top-2 right-2 z-10 rounded-full bg-background/80 p-1.5 backdrop-blur transition-colors",
        wished ? "text-red-500" : "text-muted-foreground hover:text-red-500",
        !hydrated && !wished && "opacity-90",
      )}
    >
      <HeartIcon className="size-4" fill={wished ? "currentColor" : "none"} />
    </button>
  );
}
