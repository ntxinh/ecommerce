import "server-only";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "@/env";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;
const cache = new Map<string, DB>();

export function getDb(path = env.DATABASE_URL.replace("file:", "")): DB {
  const cached = cache.get(path);
  if (cached) return cached;
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  cache.set(path, db);
  return db;
}

export function migrateDb(db: DB) {
  migrate(db, { migrationsFolder: "./drizzle" });
}
