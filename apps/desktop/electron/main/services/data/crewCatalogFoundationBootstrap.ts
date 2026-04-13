import type { DatabaseSync } from "node:sqlite";

const tableExists = (db: DatabaseSync, tableName: string) => {
  const row = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = ?
        LIMIT 1
      `,
    )
    .get(tableName) as { name: string } | undefined;

  return Boolean(row);
};

export const applyCrewCatalogFoundationMigration = (db: DatabaseSync) => {
  const crewTableInfo = db.prepare("PRAGMA table_info(crew_members)").all() as Array<{ name: string }>;
  const hasCrewColumn = (columnName: string) => crewTableInfo.some((row) => row.name === columnName);

  if (!hasCrewColumn("primary_department_id")) {
    db.exec("ALTER TABLE crew_members ADD COLUMN primary_department_id TEXT REFERENCES departments(id) ON DELETE SET NULL;");
  }

  if (!hasCrewColumn("document_id")) {
    db.exec("ALTER TABLE crew_members ADD COLUMN document_id TEXT;");
  }

  if (!tableExists(db, "crew_documents")) {
    db.exec(`
      CREATE TABLE crew_documents (
        id TEXT PRIMARY KEY,
        crew_member_id TEXT NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
        file_type TEXT NOT NULL,
        storage_path TEXT,
        original_name TEXT,
        byte_size INTEGER DEFAULT 0,
        mime_type TEXT DEFAULT 'application/octet-stream',
        status TEXT DEFAULT 'available',
        uploaded_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX idx_crew_documents_member_uploaded
        ON crew_documents(crew_member_id, uploaded_at DESC);
    `);
  }

  if (!tableExists(db, "crew_bank_accounts")) {
    db.exec(`
      CREATE TABLE crew_bank_accounts (
        id TEXT PRIMARY KEY,
        crew_member_id TEXT NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
        bank_name TEXT,
        account_holder TEXT,
        account_number TEXT NOT NULL,
        account_type TEXT,
        routing_number TEXT,
        notes TEXT,
        mask_in_preview INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_crew_bank_accounts_member_sort
        ON crew_bank_accounts(crew_member_id, sort_order, created_at);
    `);
  }
};
