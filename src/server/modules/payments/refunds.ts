import "server-only";

import type { Tx } from "@/server/modules/orders/transitions";

/** Issues refunds for an APPROVED return request's items — Task 5 fills this. */
export function issueReturnRefunds(_tx: Tx, _id: string): void {}
