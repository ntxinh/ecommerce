import { getDb, migrateDb } from "@/server/db/client";
import { seedCatalog } from "@/server/db/seed/catalog";
import { seedIdentity } from "@/server/db/seed/identity";

const db = getDb();
migrateDb(db);
seedIdentity(db);
seedCatalog(db);
console.log("seed applied");
