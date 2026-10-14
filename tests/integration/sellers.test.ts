import { mkdirSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthError } from "@/server/api/errors";
import type { Actor } from "@/server/auth/permissions";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import {
  auditLogs,
  notifications,
  sellerApplications,
  shopMemberships,
  shops,
  userRoles,
} from "@/server/db/schema";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";
import { listProducts } from "@/server/modules/catalog/service";
import { search } from "@/server/modules/search/service";
import {
  applyToSell,
  decideApplication,
  listApplications,
  myApplication,
  setShopStatus,
  updateShopProfile,
} from "@/server/modules/sellers/service";

const PATH = "./tests/.tmp/sellers-test.db";
const ADMIN: Actor = { userId: "usr_admin", roles: ["ADMIN"], memberships: [] };
const CUSTOMER: Actor = { userId: "usr_customer", roles: ["CUSTOMER"], memberships: [] };
// Seeded with PENDING app_1 and APPROVED app_2 (owner of shop_2).
const SELLER2: Actor = {
  userId: "usr_seller2",
  roles: ["CUSTOMER", "SELLER"],
  memberships: [{ shopId: "shop_2", role: "OWNER", permissions: [] }],
};

let db: DB;
let appA = ""; // CUSTOMER's first application, shared across describes.

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as AuthError).code;
  }
  throw new Error("expected throw");
}

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  seedIdentity(db);
  seedCatalog(db);
});

describe("applyToSell", () => {
  it("creates a PENDING application and myApplication returns it", () => {
    appA = applyToSell(db, CUSTOMER, {
      shopName: "Hue Lanterns",
      description: "Handmade lanterns",
      businessInfo: { taxId: "0312345678" },
    });
    expect(appA).toMatch(/^sapp_/);
    const mine = myApplication(db, CUSTOMER);
    expect(mine?.id).toBe(appA);
    expect(mine?.status).toBe("PENDING");
    expect(mine?.shopName).toBe("Hue Lanterns");
    expect(JSON.parse(mine?.businessInfo ?? "{}")).toMatchObject({
      taxId: "0312345678",
      description: "Handmade lanterns",
    });
  });

  it("rejects a second application while one is PENDING", () => {
    expect(errorCode(() => applyToSell(db, CUSTOMER, { shopName: "Another" }))).toBe(
      "INVALID_INPUT",
    );
    // usr_seller2's seeded app_1 is PENDING — blocks even though app_2 is APPROVED.
    expect(errorCode(() => applyToSell(db, SELLER2, { shopName: "Third Shop" }))).toBe(
      "INVALID_INPUT",
    );
    expect(errorCode(() => applyToSell(db, null, { shopName: "Anon" }))).toBe("UNAUTHORIZED");
  });
});

describe("decideApplication", () => {
  it("is FORBIDDEN for non-admins", () => {
    expect(errorCode(() => decideApplication(db, CUSTOMER, appA, { decision: "APPROVED" }))).toBe(
      "FORBIDDEN",
    );
    expect(errorCode(() => setShopStatus(db, CUSTOMER, "shop_1", "SUSPENDED"))).toBe("FORBIDDEN");
    expect(errorCode(() => listApplications(db, CUSTOMER, {}))).toBe("FORBIDDEN");
  });

  it("rejects a PENDING application, audits it, and notifies the applicant", () => {
    decideApplication(db, ADMIN, "app_1", { decision: "REJECTED", note: "Need papers" });
    const app = db
      .select()
      .from(sellerApplications)
      .where(eq(sellerApplications.id, "app_1"))
      .get();
    expect(app?.status).toBe("REJECTED");
    expect(app?.decidedBy).toBe("usr_admin");
    expect(app?.decisionNote).toBe("Need papers");

    const audit = db.select().from(auditLogs).where(eq(auditLogs.targetId, "app_1")).all();
    expect(audit.at(-1)?.action).toBe("seller_application.decide");

    const note = db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, "usr_seller2"))
      .all()
      .at(-1);
    expect(note?.type).toBe("seller_application");
    expect(note?.title).toBe("seller_application.rejected");
  });

  it("APPROVED creates shop + membership + SELLER role atomically; re-approve is idempotent", () => {
    decideApplication(db, ADMIN, appA, { decision: "APPROVED", note: "ok" });

    const mine = myApplication(db, CUSTOMER);
    expect(mine?.status).toBe("APPROVED");
    expect(mine?.decidedBy).toBe("usr_admin");

    const shop = db.select().from(shops).where(eq(shops.slug, "hue-lanterns")).get();
    expect(shop).toBeTruthy();
    expect(shop?.status).toBe("ACTIVE");
    expect(shop?.name).toBe("Hue Lanterns");
    expect(shop?.description).toBe("Handmade lanterns");

    expect(
      db
        .select()
        .from(shopMemberships)
        .where(eq(shopMemberships.shopId, shop?.id ?? ""))
        .all(),
    ).toEqual([expect.objectContaining({ userId: "usr_customer", role: "OWNER" })]);
    expect(
      db
        .select()
        .from(userRoles)
        .where(eq(userRoles.userId, "usr_customer"))
        .all()
        .map((r) => r.role),
    ).toContain("SELLER");

    // Idempotent re-approve: no second shop, no throw.
    decideApplication(db, ADMIN, appA, { decision: "APPROVED" });
    expect(db.select().from(shops).where(eq(shops.name, "Hue Lanterns")).all()).toHaveLength(1);
  });

  it("shop slug collisions get a -2 suffix", () => {
    const id = applyToSell(db, CUSTOMER, { shopName: "Saigon Crafts" });
    decideApplication(db, ADMIN, id, { decision: "APPROVED" });
    const shop = db.select().from(shops).where(eq(shops.slug, "saigon-crafts-2")).get();
    expect(shop?.name).toBe("Saigon Crafts");
  });
});

describe("CHANGES_REQUESTED resubmit", () => {
  it("resubmit updates the same row back to PENDING and clears decided_*", () => {
    const id = applyToSell(db, CUSTOMER, { shopName: "Fix Me Shop" });
    decideApplication(db, ADMIN, id, { decision: "CHANGES_REQUESTED", note: "Add tax id" });
    expect(myApplication(db, CUSTOMER)?.status).toBe("CHANGES_REQUESTED");

    const same = applyToSell(db, CUSTOMER, {
      shopName: "Fixed Shop",
      description: "",
      businessInfo: { taxId: "999" },
    });
    expect(same).toBe(id); // same row, not a new insert
    const mine = myApplication(db, CUSTOMER);
    expect(mine?.status).toBe("PENDING");
    expect(mine?.shopName).toBe("Fixed Shop");
    expect(mine?.decidedBy).toBeNull();
    expect(mine?.decidedAt).toBeNull();
    expect(mine?.decisionNote).toBeNull();

    decideApplication(db, ADMIN, id, { decision: "REJECTED" }); // cleanup
  });
});

describe("shop lifecycle", () => {
  it("SUSPENDED shop's products vanish from listProducts and search", () => {
    expect(listProducts(db, { shopId: "shop_2" }).items.length).toBeGreaterThan(0);
    setShopStatus(db, ADMIN, "shop_2", "SUSPENDED");
    try {
      expect(db.select().from(shops).where(eq(shops.id, "shop_2")).get()?.status).toBe("SUSPENDED");
      expect(listProducts(db, { shopId: "shop_2" }).items).toHaveLength(0);
      expect(search(db, { q: "hat", shopId: "shop_2" }).items).toHaveLength(0);
    } finally {
      setShopStatus(db, ADMIN, "shop_2", "ACTIVE");
    }
  });

  it("updateShopProfile requires shop:manage and edits name/description", () => {
    updateShopProfile(db, SELLER2, "shop_2", { name: "Danang Goods!", description: "Renamed" });
    const shop = db.select().from(shops).where(eq(shops.id, "shop_2")).get();
    expect(shop?.name).toBe("Danang Goods!");
    expect(shop?.description).toBe("Renamed");
    expect(errorCode(() => updateShopProfile(db, CUSTOMER, "shop_2", { name: "x" }))).toBe(
      "FORBIDDEN",
    );
    expect(errorCode(() => updateShopProfile(db, ADMIN, "nope", { name: "x" }))).toBe("NOT_FOUND");
    // Restore seeded name for other suites sharing this file's assertions.
    updateShopProfile(db, SELLER2, "shop_2", { name: "Danang Goods", description: "" });
  });
});

describe("listApplications", () => {
  it("admin lists by status with applicant + owned-shop columns", () => {
    const approved = listApplications(db, ADMIN, { status: "APPROVED" });
    const app2 = approved.items.find((a) => a.id === "app_2");
    expect(app2?.userEmail).toBe("seller2@marketflow.dev");
    expect(app2?.shopId).toBe("shop_2");
    expect(app2?.shopStatus).toBe("ACTIVE");
    expect(approved.items.every((a) => a.status === "APPROVED")).toBe(true);

    const rejected = listApplications(db, ADMIN, { status: "REJECTED" });
    expect(rejected.items.map((a) => a.id)).toContain("app_1");
  });
});
