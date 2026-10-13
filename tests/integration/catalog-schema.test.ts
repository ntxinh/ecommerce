import { mkdirSync, rmSync } from "node:fs";
import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb, migrateDb } from "@/server/db/client";
import { inventory, products, productVariants, shops, vouchers } from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";

const PATH = "./tests/.tmp/catalog-test.db";

describe("catalog schema + seed", () => {
  it("migrates and seeds catalog idempotently", () => {
    rmSync(PATH, { force: true });
    mkdirSync("./tests/.tmp", { recursive: true });
    const db = getDb(PATH);
    migrateDb(db);
    seedIdentity(db);
    seedCatalog(db);

    expect(db.select().from(shops).all().length).toBeGreaterThanOrEqual(2);

    const prods = db.select().from(products).all();
    const variants = db.select().from(productVariants).all();
    const variantCount: Record<string, number> = {};
    for (const v of variants) {
      variantCount[v.productId] = (variantCount[v.productId] ?? 0) + 1;
    }
    for (const p of prods) {
      expect(variantCount[p.id] ?? 0).toBeGreaterThanOrEqual(1);
    }

    const inv = db
      .select()
      .from(inventory)
      .where(
        inArray(
          inventory.variantId,
          variants.map((v) => v.id),
        ),
      )
      .all();
    expect(inv.length).toBe(variants.length);
    expect(inv.every((r) => r.onHand - r.reserved >= 5)).toBe(true);

    const welcome = db
      .select()
      .from(vouchers)
      .all()
      .find((v) => v.code === "WELCOME10");
    expect(welcome).toMatchObject({ scope: "PLATFORM", kind: "PERCENT", status: "ACTIVE" });

    const tables = [products, productVariants, inventory, vouchers, shops];
    const before = tables.map((t) => db.select().from(t).all().length);
    seedIdentity(db);
    seedCatalog(db); // second run must not throw or duplicate
    expect(tables.map((t) => db.select().from(t).all().length)).toEqual(before);
  });
});
