"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

function remaining(endsAt: number) {
  const ms = Math.max(0, endsAt - Date.now());
  const s = Math.floor(ms / 1000);
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Counts down to `endsAt` (epoch ms); renders nothing once expired. */
export function Countdown({ endsAt }: { endsAt: number }) {
  const t = useTranslations("storefront");
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (now == null || now >= endsAt) return null;
  const r = remaining(endsAt);
  const text =
    r.d > 0 ? `${r.d}d ${pad(r.h)}:${pad(r.m)}:${pad(r.s)}` : `${pad(r.h)}:${pad(r.m)}:${pad(r.s)}`;
  return (
    <Badge variant="secondary" aria-live="off">
      {t("endsIn", { time: text })}
    </Badge>
  );
}
