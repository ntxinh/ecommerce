import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb, migrateDb } from "@/server/db/client";
import { inventory } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { availableStock } from "@/server/modules/inventory/service";

const PATH = "./tests/.tmp/inventory-unit.db";

describe("availableStock derivation", () => {
  it("is onHand - reserved, clamped at 0, and 0 for unknown variants", () => {
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
    mkdirSync("./tests/.tmp", { recursive: true });
    const db = getDb(PATH);
    migrateDb(db);
    seedIdentity(db);
    seedCatalog(db);

    db.update(inventory)
      .set({ onHand: 10, reserved: 3 })
      .where(eq(inventory.variantId, "var_1"))
      .run();
    expect(availableStock(db, "var_1")).toBe(7);

    // reserved can exceed onHand only transiently (drift); read side clamps to 0.
    db.update(inventory)
      .set({ onHand: 2, reserved: 5 })
      .where(eq(inventory.variantId, "var_1"))
      .run();
    expect(availableStock(db, "var_1")).toBe(0);

    expect(availableStock(db, "var_nonexistent")).toBe(0);
  });
});
