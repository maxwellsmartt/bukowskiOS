import type { DatabaseSync } from "node:sqlite";

import { isLocalTimestampStrictlyNewer } from "./syncTimestampPolicy";

export type RemoteSyncTombstone = {
  workspace_id: string;
  table_name: string;
  entity_id: string;
  deleted_at: string;
};

type TombstoneTarget = {
  table: string;
  idColumn: string;
  freshnessColumn: "updated_at" | "created_at";
  outboxEntityType: string;
  outboxEntityIdColumn?: string;
  parentTable?: string;
};

const targets: Record<string, TombstoneTarget> = {
  asset_categories: { table: "asset_categories", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "category" },
  locations: { table: "locations", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "location" },
  clients: { table: "clients", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "client" },
  manufacturers: { table: "manufacturers", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "manufacturer" },
  production_companies: { table: "production_companies", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "production_company" },
  crew_members: { table: "crew_members", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "crew" },
  departments: { table: "departments", idColumn: "id", freshnessColumn: "created_at", outboxEntityType: "department" },
  kits: { table: "kits", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "kit" },
  bank_accounts: { table: "bank_accounts", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "bank_account" },
  bank_statement_imports: { table: "bank_statement_imports", idColumn: "id", freshnessColumn: "created_at", outboxEntityType: "bank_statement_import", parentTable: "bank_accounts" },
  bank_transactions: { table: "bank_transactions", idColumn: "id", freshnessColumn: "created_at", outboxEntityType: "bank_transaction", parentTable: "bank_accounts" },
  transaction_annotations: { table: "transaction_annotations", idColumn: "transaction_id", freshnessColumn: "updated_at", outboxEntityType: "transaction_annotation", parentTable: "bank_transactions" },
  transaction_project_allocations: { table: "transaction_project_allocations", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "transaction_allocations", outboxEntityIdColumn: "transaction_id", parentTable: "bank_transactions" },
  transaction_links: { table: "transaction_links", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "transaction_link", parentTable: "bank_transactions" },
  counterparty_rules: { table: "counterparty_rules", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "counterparty_rule" },
  collaborator_fees: { table: "collaborator_fees", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "collaborator_fee" },
  collaborator_payment_batches: { table: "collaborator_payment_batches", idColumn: "id", freshnessColumn: "created_at", outboxEntityType: "collaborator_payment" },
  collaborator_fee_payments: { table: "collaborator_fee_payments", idColumn: "id", freshnessColumn: "created_at", outboxEntityType: "collaborator_payment", outboxEntityIdColumn: "payment_batch_id", parentTable: "collaborator_payment_batches" },
  quotes: { table: "quotes", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "quote" },
  quote_items: { table: "quote_items", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "quote", outboxEntityIdColumn: "quote_id", parentTable: "quotes" },
  quote_versions: { table: "quote_versions", idColumn: "id", freshnessColumn: "created_at", outboxEntityType: "quote", outboxEntityIdColumn: "quote_id", parentTable: "quotes" },
  invoices: { table: "invoices", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "invoice" },
  invoice_items: { table: "invoice_items", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "invoice", outboxEntityIdColumn: "invoice_id", parentTable: "invoices" },
  invoice_payments: { table: "invoice_payments", idColumn: "id", freshnessColumn: "created_at", outboxEntityType: "invoice_payment", parentTable: "invoices" },
  invoice_extractions: { table: "invoice_extractions", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "invoice_extraction" },
  invoice_extraction_projects: { table: "invoice_extraction_projects", idColumn: "id", freshnessColumn: "created_at", outboxEntityType: "invoice_extraction", outboxEntityIdColumn: "invoice_extraction_id", parentTable: "invoice_extractions" },
  financial_entries: { table: "financial_entries", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "financial_entry" },
  software_licenses: { table: "software_licenses", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "software_license" },
  exchange_rates: { table: "exchange_rates", idColumn: "id", freshnessColumn: "created_at", outboxEntityType: "exchange_rate" },
  todos: { table: "todos", idColumn: "id", freshnessColumn: "updated_at", outboxEntityType: "todo" },
  reminders: { table: "reminders", idColumn: "id", freshnessColumn: "created_at", outboxEntityType: "reminder" },
};

type ChildMutationProtection = {
  childTable: string;
  parentColumn: string;
  childIdColumn: string;
  outboxEntityType: string;
  outboxEntityIdColumn: string;
};

// These relationships are backed by local ON DELETE CASCADE FKs. Checking the
// child outbox identity before deleting a parent prevents SQLite from silently
// destroying a mutation that still has to be pushed.
const childProtections: Record<string, ChildMutationProtection[]> = {
  bank_accounts: [
    { childTable: "bank_statement_imports", parentColumn: "bank_account_id", childIdColumn: "id", outboxEntityType: "bank_statement_import", outboxEntityIdColumn: "id" },
    { childTable: "bank_transactions", parentColumn: "bank_account_id", childIdColumn: "id", outboxEntityType: "bank_transaction", outboxEntityIdColumn: "id" },
  ],
  bank_transactions: [
    { childTable: "transaction_annotations", parentColumn: "transaction_id", childIdColumn: "transaction_id", outboxEntityType: "transaction_annotation", outboxEntityIdColumn: "transaction_id" },
    { childTable: "transaction_project_allocations", parentColumn: "transaction_id", childIdColumn: "id", outboxEntityType: "transaction_allocations", outboxEntityIdColumn: "transaction_id" },
    { childTable: "transaction_links", parentColumn: "transaction_id", childIdColumn: "id", outboxEntityType: "transaction_link", outboxEntityIdColumn: "id" },
  ],
  collaborator_fees: [
    { childTable: "collaborator_fee_payments", parentColumn: "fee_id", childIdColumn: "id", outboxEntityType: "collaborator_payment", outboxEntityIdColumn: "payment_batch_id" },
  ],
  collaborator_payment_batches: [
    { childTable: "collaborator_fee_payments", parentColumn: "payment_batch_id", childIdColumn: "id", outboxEntityType: "collaborator_payment", outboxEntityIdColumn: "payment_batch_id" },
  ],
  quotes: [
    { childTable: "quote_items", parentColumn: "quote_id", childIdColumn: "id", outboxEntityType: "quote", outboxEntityIdColumn: "quote_id" },
    { childTable: "quote_versions", parentColumn: "quote_id", childIdColumn: "id", outboxEntityType: "quote", outboxEntityIdColumn: "quote_id" },
  ],
  invoices: [
    { childTable: "invoice_items", parentColumn: "invoice_id", childIdColumn: "id", outboxEntityType: "invoice", outboxEntityIdColumn: "invoice_id" },
    { childTable: "invoice_payments", parentColumn: "invoice_id", childIdColumn: "id", outboxEntityType: "invoice_payment", outboxEntityIdColumn: "id" },
  ],
  invoice_extractions: [
    { childTable: "invoice_extraction_projects", parentColumn: "invoice_extraction_id", childIdColumn: "id", outboxEntityType: "invoice_extraction", outboxEntityIdColumn: "invoice_extraction_id" },
  ],
};

const parseTimestamp = (value: unknown): number | null => {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const hasPendingLocalMutation = (
  db: DatabaseSync,
  workspaceId: string,
  entityType: string,
  entityId: string,
) => Boolean(db.prepare(
  `SELECT 1 FROM sync_outbox
   WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?
     AND status IN ('pending', 'processing', 'failed')
   LIMIT 1`,
).get(workspaceId, entityType, entityId));

const hasPendingChildMutation = (
  db: DatabaseSync,
  workspaceId: string,
  parentTarget: TombstoneTarget,
  parentId: string,
) => (childProtections[parentTarget.table] ?? []).some((child) => Boolean(db.prepare(
  `SELECT 1
   FROM ${child.childTable} AS child
   JOIN sync_outbox AS outbox
     ON outbox.workspace_id = child.workspace_id
    AND outbox.entity_type = ?
    AND outbox.entity_id = CAST(child.${child.outboxEntityIdColumn} AS TEXT)
    AND outbox.status IN ('pending', 'processing', 'failed')
   WHERE child.workspace_id = ? AND child.${child.parentColumn} = ?
   LIMIT 1`,
).get(child.outboxEntityType, workspaceId, parentId)));

const targetDepth = (target: TombstoneTarget): number => {
  let depth = 0;
  let current = target;
  while (current.parentTable) {
    depth += 1;
    const parent = targets[current.parentTable];
    if (!parent) break;
    current = parent;
  }
  return depth;
};

export const createSyncTombstonePullService = (db: DatabaseSync) => ({
  apply(workspaceId: string, rows: RemoteSyncTombstone[]) {
    let appliedCount = 0;
    let skippedDueToOutboxCount = 0;
    let skippedDueToNewerCount = 0;
    const errors: string[] = [];
    const nonConsumableRows = new Set<RemoteSyncTombstone>();
    const orderedRows = rows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const depthDelta = targetDepth(targets[right.row.table_name] ?? { table: "", idColumn: "", freshnessColumn: "created_at", outboxEntityType: "" })
          - targetDepth(targets[left.row.table_name] ?? { table: "", idColumn: "", freshnessColumn: "created_at", outboxEntityType: "" });
        return depthDelta || left.index - right.index;
      })
      .map(({ row }) => row);

    db.exec("BEGIN");
    try {
      for (const row of orderedRows) {
        if (row.workspace_id !== workspaceId) continue;
        const target = targets[row.table_name];
        if (!target) {
          errors.push(`${row.table_name}:${row.entity_id}: unsupported tombstone target`);
          nonConsumableRows.add(row);
          continue;
        }

        const deletedAt = parseTimestamp(row.deleted_at);
        if (deletedAt === null) {
          errors.push(`${row.table_name}:${row.entity_id}: invalid remote deleted_at timestamp`);
          nonConsumableRows.add(row);
          continue;
        }

        try {
          const local = db.prepare(
            `SELECT ${target.freshnessColumn} AS freshness${target.outboxEntityIdColumn ? `, ${target.outboxEntityIdColumn} AS outbox_entity_id` : ""}
             FROM ${target.table}
             WHERE ${target.idColumn} = ? AND workspace_id = ?
             LIMIT 1`,
          ).get(row.entity_id, workspaceId) as { freshness?: unknown; outbox_entity_id?: unknown } | undefined;

          if (local) {
            const localFreshness = parseTimestamp(local.freshness);
            if (localFreshness === null) {
              errors.push(`${row.table_name}:${row.entity_id}: invalid local ${target.freshnessColumn} timestamp`);
              nonConsumableRows.add(row);
              continue;
            }
            if (isLocalTimestampStrictlyNewer(String(local.freshness), row.deleted_at)) {
              skippedDueToNewerCount += 1;
              continue;
            }
          }

          const outboxEntityId = target.outboxEntityIdColumn
            ? local?.outbox_entity_id
            : row.entity_id;
          if (
            (outboxEntityId !== null && outboxEntityId !== undefined
              && hasPendingLocalMutation(db, workspaceId, target.outboxEntityType, String(outboxEntityId)))
            || hasPendingChildMutation(db, workspaceId, target, row.entity_id)
          ) {
            skippedDueToOutboxCount += 1;
            nonConsumableRows.add(row);
            continue;
          }

          const result = db.prepare(
            `DELETE FROM ${target.table} WHERE ${target.idColumn} = ? AND workspace_id = ?`,
          ).run(row.entity_id, workspaceId);
          appliedCount += Number(result.changes);
        } catch (error) {
          nonConsumableRows.add(row);
          errors.push(
            `${row.table_name}:${row.entity_id}: ${error instanceof Error ? error.message : "local delete failed"}`,
          );
        }
      }

      const workspaceRows = rows.filter((row) => row.workspace_id === workspaceId);
      const firstNonConsumableIndex = workspaceRows.findIndex((row) => nonConsumableRows.has(row));
      const consumableRows = firstNonConsumableIndex < 0
        ? workspaceRows
        : workspaceRows.slice(0, firstNonConsumableIndex);
      const lastConsumable = consumableRows[consumableRows.length - 1];
      db.prepare(
        `INSERT INTO sync_pull_cursors (workspace_id, entity_type, last_synced_at, last_pulled_count, last_error, updated_at)
         VALUES (?, 'sync_tombstones', ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(workspace_id, entity_type) DO UPDATE SET
           last_synced_at = excluded.last_synced_at,
           last_pulled_count = excluded.last_pulled_count,
           last_error = excluded.last_error,
           updated_at = CURRENT_TIMESTAMP`,
      ).run(workspaceId, lastConsumable?.deleted_at ?? null, appliedCount, errors[0] ?? null);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      errors.push(error instanceof Error ? error.message : "tombstone transaction failed");
    }

    return { workspaceId, appliedCount, skippedDueToOutboxCount, skippedDueToNewerCount, errors };
  },
});
