import { mkdirSync, rmSync } from "node:fs";
import type Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { type DB, getDb, migrateDb } from "@/server/db/client";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";

const PATH = "./tests/.tmp/schema-phase7-test.db";

// DB's declared type omits the better-sqlite3 handle; drizzle exposes it as
// $client at runtime. Cast once to a named handle, then read.
let sqlite: Database.Database;

let db: DB;

type Col = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
type IdxRow = { name: string; unique: number; origin: string; partial: number };
type IdxCol = { seqno: number; cid: number; name: string };

function columns(table: string): string[] {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Col[];
  return rows.map((r) => r.name);
}

function hasIndex(table: string, indexName: string, cols: string[], unique: boolean): boolean {
  const indexes = sqlite.prepare(`PRAGMA index_list(${table})`).all() as IdxRow[];
  const idx = indexes.find((i) => i.name === indexName);
  if (!idx) return false;
  // UNIQUE column constraints produce unnamed sqlite_autoindex_* rows with no
  // SQL; named indexes carry their CREATE statement in sqlite_master.
  const isUnique =
    idx.unique === 1 ||
    !!(
      sqlite
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`)
        .get(indexName) as { sql: string | null } | undefined
    )?.sql
      ?.toUpperCase()
      .includes("UNIQUE");
  if (isUnique !== unique) return false;
  const idxCols = (sqlite.prepare(`PRAGMA index_info(${indexName})`).all() as IdxCol[]).map(
    (c) => c.name,
  );
  return cols.every((c) => idxCols.includes(c));
}

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${PATH}${suffix}`, { force: true });
  mkdirSync("./tests/.tmp", { recursive: true });
  db = getDb(PATH);
  migrateDb(db);
  const handle = db as unknown as { $client: Database.Database };
  sqlite = handle.$client;
  seedIdentity(db);
  seedCatalog(db);
});

describe("phase7 schema", () => {
  it("return_requests columns", () => {
    expect(columns("return_requests")).toEqual(
      expect.arrayContaining([
        "id",
        "seller_order_id",
        "order_id",
        "user_id",
        "status",
        "reason",
        "evidence_json",
        "decided_by",
        "decided_at",
        "decision_note",
        "created_at",
      ]),
    );
  });

  it("return_items columns + request index", () => {
    expect(columns("return_items")).toEqual(
      expect.arrayContaining([
        "id",
        "return_request_id",
        "order_item_id",
        "qty",
        "restock",
        "refund_vnd",
      ]),
    );
    expect(hasIndex("return_items", "return_items_req_idx", ["return_request_id"], false)).toBe(
      true,
    );
  });

  it("refunds columns + unique index on return_item_id", () => {
    expect(columns("refunds")).toEqual(
      expect.arrayContaining([
        "id",
        "payment_id",
        "return_item_id",
        "amount_vnd",
        "status",
        "reason",
        "created_at",
      ]),
    );
    expect(hasIndex("refunds", "refunds_return_item_uidx", ["return_item_id"], true)).toBe(true);
  });

  it("financial_ledger_entries columns + indexes", () => {
    expect(columns("financial_ledger_entries")).toEqual(
      expect.arrayContaining([
        "id",
        "account",
        "shop_id",
        "amount_vnd",
        "ref_type",
        "ref_id",
        "meta_json",
        "created_at",
      ]),
    );
    expect(
      hasIndex("financial_ledger_entries", "ledger_account_idx", ["account", "shop_id"], false),
    ).toBe(true);
    expect(
      hasIndex("financial_ledger_entries", "ledger_ref_idx", ["ref_type", "ref_id"], false),
    ).toBe(true);
  });

  it("seller_settlements columns + shop index", () => {
    expect(columns("seller_settlements")).toEqual(
      expect.arrayContaining([
        "id",
        "shop_id",
        "status",
        "gross_vnd",
        "commission_vnd",
        "refund_vnd",
        "net_vnd",
        "created_at",
        "paid_at",
      ]),
    );
    expect(
      hasIndex("seller_settlements", "settlements_shop_idx", ["shop_id", "status"], false),
    ).toBe(true);
  });

  it("settlement_items columns + unique seller_order index", () => {
    expect(columns("settlement_items")).toEqual(
      expect.arrayContaining([
        "id",
        "settlement_id",
        "seller_order_id",
        "gross_vnd",
        "commission_vnd",
        "net_vnd",
      ]),
    );
    expect(
      hasIndex("settlement_items", "settlement_items_so_uidx", ["seller_order_id"], true),
    ).toBe(true);
  });

  it("notifications columns + user/read index", () => {
    expect(columns("notifications")).toEqual(
      expect.arrayContaining([
        "id",
        "user_id",
        "type",
        "title",
        "body",
        "href",
        "read_at",
        "created_at",
      ]),
    );
    expect(
      hasIndex("notifications", "notifications_user_read_idx", ["user_id", "read_at"], false),
    ).toBe(true);
  });

  it("notification_preferences columns", () => {
    expect(columns("notification_preferences")).toEqual(
      expect.arrayContaining(["user_id", "type", "enabled"]),
    );
  });

  it("wishlists columns", () => {
    expect(columns("wishlists")).toEqual(expect.arrayContaining(["id", "user_id", "created_at"]));
  });

  it("wishlist_items columns + unique wishlist/product index", () => {
    expect(columns("wishlist_items")).toEqual(
      expect.arrayContaining(["id", "wishlist_id", "product_id", "created_at"]),
    );
    expect(
      hasIndex("wishlist_items", "wishlist_items_uidx", ["wishlist_id", "product_id"], true),
    ).toBe(true);
  });

  it("reviews gains images_json", () => {
    expect(columns("reviews")).toContain("images_json");
  });
});
