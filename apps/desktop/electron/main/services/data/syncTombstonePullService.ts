import type { DatabaseSync } from "node:sqlite";

export type RemoteSyncTombstone = {
  workspace_id: string;
  table_name: string;
  entity_id: string;
  deleted_at: string;
};

type TombstoneTarget = { table: string; idColumn: string };

const targets: Record<string, TombstoneTarget> = {
  asset_categories: { table: "asset_categories", idColumn: "id" },
  locations: { table: "locations", idColumn: "id" },
  clients: { table: "clients", idColumn: "id" },
  manufacturers: { table: "manufacturers", idColumn: "id" },
  production_companies: { table: "production_companies", idColumn: "id" },
  crew_members: { table: "crew_members", idColumn: "id" },
  departments: { table: "departments", idColumn: "id" },
  bank_accounts: { table: "bank_accounts", idColumn: "id" },
  bank_statement_imports: { table: "bank_statement_imports", idColumn: "id" },
  bank_transactions: { table: "bank_transactions", idColumn: "id" },
  transaction_annotations: { table: "transaction_annotations", idColumn: "transaction_id" },
  transaction_project_allocations: { table: "transaction_project_allocations", idColumn: "id" },
  transaction_links: { table: "transaction_links", idColumn: "id" },
  counterparty_rules: { table: "counterparty_rules", idColumn: "id" },
  collaborator_fees: { table: "collaborator_fees", idColumn: "id" },
  collaborator_payment_batches: { table: "collaborator_payment_batches", idColumn: "id" },
  collaborator_fee_payments: { table: "collaborator_fee_payments", idColumn: "id" },
  quotes: { table: "quotes", idColumn: "id" },
  quote_items: { table: "quote_items", idColumn: "id" },
  quote_versions: { table: "quote_versions", idColumn: "id" },
  invoices: { table: "invoices", idColumn: "id" },
  invoice_items: { table: "invoice_items", idColumn: "id" },
  invoice_payments: { table: "invoice_payments", idColumn: "id" },
  invoice_extractions: { table: "invoice_extractions", idColumn: "id" },
  invoice_extraction_projects: { table: "invoice_extraction_projects", idColumn: "id" },
  financial_entries: { table: "financial_entries", idColumn: "id" },
  software_licenses: { table: "software_licenses", idColumn: "id" },
};

const hasPendingLocalMutation = (db: DatabaseSync, workspaceId: string, entityId: string) => {
  const row = db
    .prepare(
      `SELECT 1 FROM sync_outbox
       WHERE workspace_id = ? AND entity_id = ?
         AND status IN ('pending', 'processing', 'failed')
       LIMIT 1`,
    )
    .get(workspaceId, entityId);
  return Boolean(row);
};

export const createSyncTombstonePullService = (db: DatabaseSync) => ({
  apply(workspaceId: string, rows: RemoteSyncTombstone[]) {
    let appliedCount = 0;
    let skippedDueToOutboxCount = 0;
    const errors: string[] = [];

    db.exec("BEGIN");
    try {
      for (const row of rows) {
        if (row.workspace_id !== workspaceId) continue;
        const target = targets[row.table_name];
        if (!target) {
          errors.push(`${row.table_name}:${row.entity_id}: unsupported tombstone target`);
          continue;
        }
        if (hasPendingLocalMutation(db, workspaceId, row.entity_id)) {
          skippedDueToOutboxCount += 1;
          continue;
        }
        try {
          const result = db
            .prepare(`DELETE FROM ${target.table} WHERE ${target.idColumn} = ? AND workspace_id = ?`)
            .run(row.entity_id, workspaceId);
          appliedCount += Number(result.changes);
        } catch (error) {
          errors.push(
            `${row.table_name}:${row.entity_id}: ${error instanceof Error ? error.message : "local delete failed"}`,
          );
        }
      }

      const last = rows[rows.length - 1];
      db.prepare(
        `INSERT INTO sync_pull_cursors (workspace_id, entity_type, last_synced_at, last_pulled_count, last_error, updated_at)
         VALUES (?, 'sync_tombstones', ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(workspace_id, entity_type) DO UPDATE SET
           last_synced_at = excluded.last_synced_at,
           last_pulled_count = excluded.last_pulled_count,
           last_error = excluded.last_error,
           updated_at = CURRENT_TIMESTAMP`,
      ).run(workspaceId, last?.deleted_at ?? null, appliedCount, errors[0] ?? null);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      errors.push(error instanceof Error ? error.message : "tombstone transaction failed");
    }

    return { workspaceId, appliedCount, skippedDueToOutboxCount, errors };
  },
});
