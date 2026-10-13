import { getDb, migrateDb } from "@/server/db/client";
import { seedIdentity } from "@/server/db/seed/identity";

const db = getDb();
migrateDb(db);
seedIdentity(db);
console.log("seed applied");
