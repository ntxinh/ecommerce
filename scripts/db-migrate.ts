import { getDb, migrateDb } from "@/server/db/client";

const db = getDb();
migrateDb(db);
console.log("migrations applied");
