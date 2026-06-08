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

type TableColumn = { name: string; notnull: number };

const tableColumns = (db: DatabaseSync, tableName: string) =>
  db.prepare(`PRAGMA table_info(${tableName})`).all() as TableColumn[];

const hasColumn = (db: DatabaseSync, tableName: string, columnName: string) =>
  tableColumns(db, tableName).some((column) => column.name === columnName);

const hasIndex = (db: DatabaseSync, tableName: string, indexName: string) => {
  const indexes = db.prepare(`PRAGMA index_list(${tableName})`).all() as Array<{ name: string }>;
  return indexes.some((index) => index.name === indexName);
};

const addColumnIfMissing = (db: DatabaseSync, tableName: string, columnName: string, definition: string) => {
  if (hasColumn(db, tableName, columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
};

const applyPaymentInstrumentColumns = (db: DatabaseSync) => {
  if (!hasTable(db, "bank_accounts")) return;

  addColumnIfMissing(db, "bank_accounts", "owner", "TEXT NOT NULL DEFAULT 'company'");
  addColumnIfMissing(db, "bank_accounts", "owner_user_id", "TEXT");
  addColumnIfMissing(db, "bank_accounts", "owner_user_name_snapshot", "TEXT");
  addColumnIfMissing(db, "bank_accounts", "instrument_kind", "TEXT NOT NULL DEFAULT 'bank_account'");
  addColumnIfMissing(db, "bank_accounts", "last4", "TEXT");
  addColumnIfMissing(db, "bank_accounts", "issuer", "TEXT");
  addColumnIfMissing(db, "bank_accounts", "statement_cycle_day", "INTEGER");
  addColumnIfMissing(db, "bank_accounts", "payment_due_day", "INTEGER");
  addColumnIfMissing(db, "bank_accounts", "reminder_user_id", "TEXT");

  db.exec(`UPDATE bank_accounts SET account_number_full = NULL WHERE account_number_full IS NOT NULL`);
  db.exec(
    `
      CREATE INDEX IF NOT EXISTS idx_bank_accounts_owner
        ON bank_accounts(workspace_id, owner, owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_bank_accounts_instrument
        ON bank_accounts(workspace_id, instrument_kind, is_active);
    `,
  );
};

const transactionLinksNeedsRebuild = (db: DatabaseSync) => {
  if (!hasTable(db, "transaction_links")) return false;
  const columns = tableColumns(db, "transaction_links");
  const transactionId = columns.find((column) => column.name === "transaction_id");
  return transactionId?.notnull === 1 || !hasIndex(db, "transaction_links", "idx_txn_links_dedupe_v4");
};

const applyTransactionLinksV4 = (db: DatabaseSync) => {
  if (!hasTable(db, "transaction_links")) return;

  addColumnIfMissing(db, "transaction_links", "payment_instrument_id", "TEXT");
  addColumnIfMissing(db, "transaction_links", "amount_applied", "REAL");
  addColumnIfMissing(db, "transaction_links", "amount_currency", "TEXT");
  addColumnIfMissing(db, "transaction_links", "fx_rate", "REAL");
  addColumnIfMissing(db, "transaction_links", "allocation_status", "TEXT NOT NULL DEFAULT 'pending'");
  addColumnIfMissing(db, "transaction_links", "cycle_start", "TEXT");
  addColumnIfMissing(db, "transaction_links", "cycle_end", "TEXT");
  addColumnIfMissing(db, "transaction_links", "updated_at", "TEXT");
  db.exec(`UPDATE transaction_links SET updated_at = created_at WHERE updated_at IS NULL`);
  db.exec(`UPDATE transaction_links SET allocation_status = 'matched' WHERE transaction_id IS NOT NULL AND allocation_status = 'pending'`);

  if (transactionLinksNeedsRebuild(db)) {
    db.exec(`PRAGMA foreign_keys = OFF`);
    db.exec("BEGIN");
    try {
      db.exec(
        `
          DROP INDEX IF EXISTS idx_txn_links_entity;
          DROP INDEX IF EXISTS idx_txn_links_transaction;
          DROP INDEX IF EXISTS idx_txn_links_payment_instrument;
          DROP INDEX IF EXISTS idx_txn_links_dedupe_v4;

          CREATE TABLE transaction_links_v4 (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            transaction_id TEXT REFERENCES bank_transactions(id) ON DELETE SET NULL,
            payment_instrument_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
            linked_entity_type TEXT NOT NULL,
            linked_entity_id TEXT NOT NULL,
            amount_applied REAL,
            amount_currency TEXT,
            fx_rate REAL,
            allocation_status TEXT NOT NULL DEFAULT 'pending',
            cycle_start TEXT,
            cycle_end TEXT,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          INSERT OR IGNORE INTO transaction_links_v4 (
            id,
            workspace_id,
            transaction_id,
            payment_instrument_id,
            linked_entity_type,
            linked_entity_id,
            amount_applied,
            amount_currency,
            fx_rate,
            allocation_status,
            cycle_start,
            cycle_end,
            notes,
            created_at,
            updated_at
          )
          SELECT
            id,
            workspace_id,
            transaction_id,
            payment_instrument_id,
            linked_entity_type,
            linked_entity_id,
            amount_applied,
            amount_currency,
            fx_rate,
            allocation_status,
            cycle_start,
            cycle_end,
            notes,
            created_at,
            COALESCE(updated_at, created_at)
          FROM transaction_links;

          DROP TABLE transaction_links;
          ALTER TABLE transaction_links_v4 RENAME TO transaction_links;
        `,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      db.exec(`PRAGMA foreign_keys = ON`);
    }
  }

  db.exec(
    `
      CREATE INDEX IF NOT EXISTS idx_txn_links_entity
        ON transaction_links(workspace_id, linked_entity_type, linked_entity_id);
      CREATE INDEX IF NOT EXISTS idx_txn_links_transaction
        ON transaction_links(workspace_id, transaction_id)
        WHERE transaction_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_txn_links_payment_instrument
        ON transaction_links(workspace_id, payment_instrument_id)
        WHERE payment_instrument_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_links_dedupe_v4
        ON transaction_links(
          workspace_id,
          linked_entity_type,
          linked_entity_id,
          COALESCE(transaction_id, ''),
          COALESCE(payment_instrument_id, '')
        );
    `,
  );
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

  applyPaymentInstrumentColumns(db);
  applyTransactionLinksV4(db);

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
