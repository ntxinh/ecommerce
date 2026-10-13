import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL?.replace("file:", "") ?? "./data/marketflow.db" },
});
