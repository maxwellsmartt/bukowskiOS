import type { DatabaseSync } from "node:sqlite";

const hasColumn = (db: DatabaseSync, tableName: string, columnName: string) => {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
};

export const applyQuoteAgentSourceMigration = (db: DatabaseSync) => {
  if (!hasColumn(db, "quotes", "created_by_actor_type")) {
    db.exec("ALTER TABLE quotes ADD COLUMN created_by_actor_type TEXT NOT NULL DEFAULT 'user';");
  }

  if (!hasColumn(db, "quotes", "source_channel")) {
    db.exec("ALTER TABLE quotes ADD COLUMN source_channel TEXT;");
  }
};
