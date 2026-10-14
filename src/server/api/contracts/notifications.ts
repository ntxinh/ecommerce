import { z } from "zod";

// `{id}` marks one; `{}` marks all.
export const NotificationMarkInput = z.object({
  id: z.string().min(1).optional(),
});
