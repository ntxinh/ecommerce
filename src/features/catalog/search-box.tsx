"use client";

import { SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { clearSearchHistoryAction } from "./actions";

/** Header search input with debounced autocomplete from /api/v1/search?mode=suggest.
 *  `recent` = the signed-in user's search_history; guests get undefined. */
export function SearchBox({ recent }: { recent?: string[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [recentList, setRecentList] = useState(recent ?? []);
  const [open, setOpen] = useState(false);
  const [, startClear] = useTransition();
  const seq = useRef(0);

  const clearHistory = () => {
    startClear(async () => {
      if ((await clearSearchHistoryAction()).ok) setRecentList([]);
    });
  };

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      ++seq.current; // cancel any in-flight suggest so a stale response can't repopulate
      setSuggestions([]);
      return;
    }
    const id = setTimeout(async () => {
      const my = ++seq.current;
      try {
        const res = await fetch(`/api/v1/search?mode=suggest&q=${encodeURIComponent(term)}`);
        if (!res.ok || my !== seq.current) return;
        const body: { data: { suggestions: string[] } } = await res.json();
        setSuggestions(body.data.suggestions);
      } catch {
        /* autocomplete is best-effort */
      }
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  const go = (term: string) => {
    const v = term.trim();
    if (!v) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(v)}`);
  };

  return (
    <form
      className="relative w-56"
      onSubmit={(e) => {
        e.preventDefault();
        go(q);
      }}
    >
      <Input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={t("shell.searchPlaceholder")}
        aria-label={t("shell.searchPlaceholder")}
        aria-expanded={open && suggestions.length > 0}
        role="combobox"
        aria-controls="search-suggestions"
        className="pr-8"
      />
      <button
        type="submit"
        aria-label={t("storefront.searchButton")}
        className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
      >
        <SearchIcon className="size-4" />
      </button>
      {open && q.trim() === "" && recentList.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
          {recentList.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="w-full truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(s)}
              >
                {s}
              </button>
            </li>
          ))}
          <li className="border-t pt-1">
            <button
              type="button"
              className="w-full rounded-sm px-2 py-1 text-left text-muted-foreground text-xs hover:bg-accent"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clearHistory}
            >
              {t("shell.clearHistory")}
            </button>
          </li>
        </ul>
      )}
      {open && suggestions.length > 0 && (
        <ul
          id="search-suggestions"
          className="absolute z-20 mt-1 w-full rounded-md border bg-popover p-1 shadow-md"
        >
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="w-full truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(s)}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
