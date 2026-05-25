import type { DatabaseSync } from "node:sqlite";

const hasTable = (db: DatabaseSync, tableName: string) => {
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

const hasColumn = (db: DatabaseSync, tableName: string, columnName: string) => {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
};

const addColumnIfMissing = (db: DatabaseSync, tableName: string, columnName: string, definition: string) => {
  if (hasColumn(db, tableName, columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
};

export const applyTreasuryFoundationSelfHeal = (db: DatabaseSync) => {
  db.exec(
    `
      CREATE TABLE IF NOT EXISTS treasury_undo_journal (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        command_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        prior_state_json TEXT,
        created_at TEXT NOT NULL,
        undone INTEGER NOT NULL DEFAULT 0,
        undone_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_treasury_undo_journal_stack
        ON treasury_undo_journal(workspace_id, undone, created_at DESC);
    `,
  );

  if (!hasTable(db, "transaction_annotations")) return;

  addColumnIfMissing(db, "transaction_annotations", "supplier_ncf", "TEXT");
  addColumnIfMissing(db, "transaction_annotations", "dgii_expense_type", "TEXT");
  addColumnIfMissing(db, "transaction_annotations", "withholding_type", "TEXT");
  addColumnIfMissing(db, "transaction_annotations", "withholding_rate", "REAL");
  addColumnIfMissing(db, "transaction_annotations", "withholding_amount", "REAL");
  addColumnIfMissing(db, "transaction_annotations", "fiscal_period", "TEXT");

  db.exec(
    `
      CREATE INDEX IF NOT EXISTS idx_txn_annotations_fiscal_period
        ON transaction_annotations(workspace_id, fiscal_period);
    `,
  );
};
