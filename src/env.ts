import "server-only";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().default("file:./data/marketflow.db"),
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  SESSION_COOKIE_NAME: z.string().default("marketflow_session"),
  API_DOCS_ENABLED: z.enum(["true", "false"]).default("false"),
  INTERNAL_CRON_TOKEN: z.string().default("dev-cron-token"),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
