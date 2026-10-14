"use client";

import { BellIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "@/i18n/navigation";

type Item = {
  id: string;
  type: string;
  /** i18n key under the `notifications` namespace. */
  title: string;
  /** JSON-encoded interpolation params (or a literal string). */
  body: string;
  href: string | null;
  readAt: number | null;
  createdAt: number;
};

type ListResponse = { data: { items: Item[]; nextCursor: string | null; unread: number } };

function paramsOf(body: string): Record<string, string | number> {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

const mark = (id?: string) =>
  fetch("/api/v1/notifications", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(id ? { id } : {}),
    keepalive: true,
  }).catch(() => undefined);

/**
 * Notification bell for the site header: unread badge, dropdown with the 10
 * newest notifications, 30s polling + refetch on window focus. Titles are i18n
 * keys rendered in the current locale; hrefs are locale-free paths the
 * localized router prefixes.
 */
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const t = useTranslations("notifications");
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(initialUnread);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/v1/notifications?limit=10").catch(() => null);
    if (!res?.ok) return;
    const json = (await res.json()) as ListResponse;
    setItems(json.data.items);
    setUnread(json.data.unread);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const open = (n: Item) => {
    if (!n.readAt) {
      setUnread((u) => Math.max(0, u - 1));
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, readAt: Date.now() } : i)));
      mark(n.id);
    }
    if (n.href) router.push(n.href);
  };

  return (
    <DropdownMenu onOpenChange={(open) => open && refresh()}>
      <DropdownMenuTrigger
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label={t("title")}
      >
        <span className="relative inline-flex">
          <BellIcon />
          {unread > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-4 min-w-4 justify-center px-1 text-[10px]"
            >
              {unread}
            </Badge>
          )}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>{t("title")}</span>
          {unread > 0 && (
            <button
              type="button"
              className="text-xs font-normal text-primary hover:underline"
              onClick={() => {
                mark();
                setUnread(0);
                setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? Date.now() })));
              }}
            >
              {t("markAllRead")}
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <DropdownMenuItem disabled>{t("empty")}</DropdownMenuItem>
        ) : (
          items.map((n) => (
            <DropdownMenuItem
              key={n.id}
              className={
                n.readAt
                  ? "flex-col items-start gap-0.5"
                  : "flex-col items-start gap-0.5 font-medium"
              }
              onClick={() => open(n)}
            >
              <span>{t(n.title, paramsOf(n.body))}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {new Date(n.createdAt).toLocaleString()}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
