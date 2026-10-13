import "server-only";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const applicationSettings = sqliteTable("application_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
});
