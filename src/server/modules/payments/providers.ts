import "server-only";

import { ulid } from "ulidx";
import { AuthError } from "@/server/api/errors";
import type { payments } from "@/server/db/schema";

export type PaymentMethod = (typeof payments.$inferSelect)["method"];
export type PaymentStatus = (typeof payments.$inferSelect)["status"];

/**
 * Provider adapter contract (spec §6). Adapters are in-process mocks — no
 * network. `simulate: "success"|"failure"` on the attempt lets tests/E2E force
 * outcomes; absent = success. `confirm`/`refund` are idempotent on ref.
 */
export interface PaymentProvider {
  createAttempt(ctx: { amountVnd: number; simulate?: string | null }): { ref: string };
  confirm(ctx: { ref: string }): Promise<PaymentStatus>;
  refund(ctx: { ref: string; amountVnd: number }): Promise<PaymentStatus>;
}

// Ref → simulate, shared by createAttempt/confirm within a request process.
// Bounded by request volume of unpaid attempts; entries stay tiny (a word).
const simulated = new Map<string, string | null | undefined>();

const cod: PaymentProvider = {
  // COD collects at delivery: attempt exists, payment stays PENDING.
  createAttempt: () => ({ ref: `cod_${ulid()}` }),
  confirm: async () => "PAID",
  refund: async () => "REFUNDED",
};

// Simulated online adapters share one shape: `mw_`/`mb_` ref + deferred confirm.
function simulatedProvider(prefix: string): PaymentProvider {
  return {
    createAttempt: ({ simulate }) => {
      const ref = `${prefix}${ulid()}`;
      simulated.set(ref, simulate);
      return { ref };
    },
    confirm: async ({ ref }) => {
      const sim = simulated.get(ref);
      simulated.delete(ref);
      return sim === "failure" ? "FAILED" : "PAID";
    },
    refund: async () => "REFUNDED",
  };
}

const PROVIDERS: Partial<Record<PaymentMethod, PaymentProvider>> = {
  COD: cod,
  MOCK_WALLET: simulatedProvider("mw_"),
  // Bank transfer polls confirm(): the attempt row stays the only record of a
  // pending transfer, so an order carries at most one live mb_ attempt.
  MOCK_BANK: simulatedProvider("mb_"),
};

export function paymentProviderFor(method: PaymentMethod): PaymentProvider {
  const p = PROVIDERS[method];
  if (!p) throw new AuthError("INVALID_INPUT", 422, `payment method ${method} unsupported`);
  return p;
}
