// Auth pages read cookies/params at request time; opt the segment out of instant-shell validation.
export const instant = false;

import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
