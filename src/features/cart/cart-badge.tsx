"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useGuestCart } from "./use-guest-cart";

/**
 * Cart item count shown next to the header cart icon. Logged-in users get the
 * server-rendered count; guests get the localStorage cart count — rendered only
 * after mount so SSR markup never mismatches.
 */
export function CartBadge({ serverCount, loggedIn }: { serverCount: number; loggedIn: boolean }) {
  const [mounted, setMounted] = useState(false);
  const guestCount = useGuestCart((s) => s.items.reduce((n, i) => n + i.qty, 0));
  useEffect(() => setMounted(true), []);

  const count = loggedIn ? serverCount : mounted ? guestCount : 0;
  if (count === 0) return null;
  return (
    <Badge
      variant="secondary"
      className="absolute -top-1 -right-1 h-4 min-w-4 justify-center px-1 text-[10px]"
    >
      {count}
    </Badge>
  );
}
