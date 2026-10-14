import "server-only";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./identity";

// Search-history rows power "recent searches" for logged-in users; guests
// never write here (the route only calls recordSearch with an actor).
export const searchHistory = sqliteTable(
  "search_history",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("search_history_user_created_idx").on(t.userId, t.createdAt)],
);
