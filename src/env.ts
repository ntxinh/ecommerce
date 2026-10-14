import "server-only";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().default("file:./data/marketflow.db"),
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  SESSION_COOKIE_NAME: z.string().default("marketflow_session"),
  API_DOCS_ENABLED: z.enum(["true", "false"]).default("false"),
  INTERNAL_CRON_TOKEN: z.string().default("dev-cron-token"),
  // Stripe is optional: absent keys hide the method and 404 the webhook.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Finix is optional: absent keys hide the method and 404 the webhook.
  FINIX_USERNAME: z.string().optional(),
  FINIX_PASSWORD: z.string().optional(),
  FINIX_MERCHANT_ID: z.string().optional(),
  FINIX_APPLICATION_ID: z.string().optional(),
  FINIX_BASE_URL: z.string().optional(),
  FINIX_WEBHOOK_SECRET: z.string().optional(),
  FINIX_LOGO_URL: z.string().optional(),
  FINIX_ICON_URL: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
