import { mkdirSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDb, migrateDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { seedIdentity } from "@/server/db/seed/identity";

const PATH = "./tests/.tmp/db-test.db";

describe("db", () => {
  it("migrates and seeds idempotently", () => {
    rmSync(PATH, { force: true });
    mkdirSync("./tests/.tmp", { recursive: true });
    const db = getDb(PATH);
    migrateDb(db);
    seedIdentity(db);
    seedIdentity(db); // second run must not throw or duplicate
    const rows = db.select().from(users).all();
    expect(rows.filter((u) => u.email === "admin@marketflow.dev")).toHaveLength(1);
    expect(rows).toHaveLength(4);
  });
});
