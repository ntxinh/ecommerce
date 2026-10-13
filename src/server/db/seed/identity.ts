import "server-only";
import { hashSync } from "@node-rs/argon2";
import type { DB } from "../client";
import {
  applicationSettings,
  sellerApplications,
  shopMemberships,
  shops,
  userRoles,
  users,
} from "../schema";

// Fixed text ids make the seed deterministic and idempotent on PK conflict.
const SEEDED_AT = 1735689600000; // 2025-01-01T00:00:00Z in unixepoch ms, stable across runs

export function seedIdentity(db: DB) {
  const passwordHash = hashSync("Marketflow123!");

  db.insert(users)
    .values([
      {
        id: "usr_admin",
        email: "admin@marketflow.dev",
        name: "Admin",
        passwordHash,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
      {
        id: "usr_seller",
        email: "seller@marketflow.dev",
        name: "Seller One",
        passwordHash,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
      {
        id: "usr_seller2",
        email: "seller2@marketflow.dev",
        name: "Seller Two",
        passwordHash,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
      {
        id: "usr_customer",
        email: "customer@marketflow.dev",
        name: "Customer",
        passwordHash,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
    ])
    .onConflictDoNothing()
    .run();

  db.insert(userRoles)
    .values([
      { userId: "usr_admin", role: "ADMIN" },
      { userId: "usr_admin", role: "CUSTOMER" },
      { userId: "usr_seller", role: "SELLER" },
      { userId: "usr_seller", role: "CUSTOMER" },
      { userId: "usr_seller2", role: "CUSTOMER" },
      { userId: "usr_customer", role: "CUSTOMER" },
    ])
    .onConflictDoNothing()
    .run();

  db.insert(shops)
    .values({
      id: "shop_1",
      slug: "saigon-crafts",
      name: "Saigon Crafts",
      description: "Demo seller shop",
      createdAt: SEEDED_AT,
    })
    .onConflictDoNothing()
    .run();

  db.insert(shopMemberships)
    .values({ shopId: "shop_1", userId: "usr_seller", role: "OWNER" })
    .onConflictDoNothing()
    .run();

  db.insert(sellerApplications)
    .values({
      id: "app_1",
      userId: "usr_seller2",
      shopName: "Hanoi Goods",
      createdAt: SEEDED_AT,
    })
    .onConflictDoNothing()
    .run();

  db.insert(applicationSettings)
    .values([
      { key: "commission_rate_bps", value: "500" },
      { key: "return_window_days", value: "7" },
      { key: "auto_complete_days", value: "3" },
      { key: "currency", value: '"VND"' },
      { key: "reservation_ttl_minutes", value: "15" },
    ])
    .onConflictDoNothing()
    .run();
}
