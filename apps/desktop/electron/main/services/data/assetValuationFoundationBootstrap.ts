import type { DatabaseSync } from "node:sqlite";

const hasColumn = (db: DatabaseSync, tableName: string, columnName: string) => {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
};

export const applyAssetValuationFoundationMigration = (db: DatabaseSync) => {
  if (!hasColumn(db, "assets", "additional_costs")) {
    db.exec("ALTER TABLE assets ADD COLUMN additional_costs REAL;");
  }
};
