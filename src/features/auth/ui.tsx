"use client";

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  const input = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        "aria-describedby": error ? `${id}-error` : undefined,
      })
    : children;

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {input}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Submit({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "…" : children}
    </Button>
  );
}
