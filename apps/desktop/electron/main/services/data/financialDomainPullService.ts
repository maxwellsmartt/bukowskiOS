import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { getDesktopLogger } from "../logger";
import { materializeTreasuryCounterpartyRules } from "./treasuryCounterpartyRuleMaterializer";

const logger = getDesktopLogger("financial-domain-pull-service");

export type TreasuryPullTable =
  | "bank_accounts"
  | "bank_statement_imports"
  | "bank_transactions"
  | "transaction_annotations"
  | "transaction_project_allocations"
  | "transaction_links"
  | "counterparty_rules";

export type CollaboratorPaymentPullTable =
  | "collaborator_fees"
  | "collaborator_payment_batches"
  | "collaborator_fee_payments";

export type FinanceBusinessPullTable =
  | "currency_settings"
  | "quotes"
  | "quote_items"
  | "quote_versions"
  | "invoices"
  | "invoice_items"
  | "invoice_payments"
  | "invoice_extractions"
  | "financial_entries";

export type FinancialDomainPullResult<TTable extends string> = {
  workspaceId: string;
  table: TTable;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  skippedDueToOlderCount: number;
  skippedDueToDependencyCount: number;
  errors: string[];
  cursorAfter: string | null;
};

const treasuryEntityMap: Record<TreasuryPullTable, { entityType: string; entityIdColumn: string; conflictColumns: string[] }> = {
  bank_accounts: { entityType: "bank_account", entityIdColumn: "id", conflictColumns: ["id"] },
  bank_statement_imports: { entityType: "bank_statement_import", entityIdColumn: "id", conflictColumns: ["id"] },
  bank_transactions: { entityType: "bank_transaction", entityIdColumn: "id", conflictColumns: ["id"] },
  transaction_annotations: { entityType: "transaction_annotation", entityIdColumn: "transaction_id", conflictColumns: ["transaction_id"] },
  transaction_project_allocations: { entityType: "transaction_allocations", entityIdColumn: "transaction_id", conflictColumns: ["id"] },
  transaction_links: { entityType: "transaction_link", entityIdColumn: "transaction_id", conflictColumns: ["id"] },
  counterparty_rules: { entityType: "counterparty_rule", entityIdColumn: "id", conflictColumns: ["id"] },
};

const collaboratorEntityMap: Record<
  CollaboratorPaymentPullTable,
  { entityType: string; entityIdColumn: string; conflictColumns: string[] }
> = {
  collaborator_fees: { entityType: "collaborator_fee", entityIdColumn: "id", conflictColumns: ["id"] },
  collaborator_payment_batches: { entityType: "collaborator_payment", entityIdColumn: "id", conflictColumns: ["id"] },
  collaborator_fee_payments: { entityType: "collaborator_payment", entityIdColumn: "payment_batch_id", conflictColumns: ["id"] },
};

const financeBusinessEntityMap: Record<
  FinanceBusinessPullTable,
  { entityType: string; entityIdColumn: string; conflictColumns: string[] }
> = {
  currency_settings: { entityType: "currency_settings", entityIdColumn: "workspace_id", conflictColumns: ["workspace_id"] },
  quotes: { entityType: "quote", entityIdColumn: "id", conflictColumns: ["id"] },
  quote_items: { entityType: "quote", entityIdColumn: "quote_id", conflictColumns: ["id"] },
  quote_versions: { entityType: "quote", entityIdColumn: "quote_id", conflictColumns: ["id"] },
  invoices: { entityType: "invoice", entityIdColumn: "id", conflictColumns: ["id"] },
  invoice_items: { entityType: "invoice", entityIdColumn: "invoice_id", conflictColumns: ["id"] },
  invoice_payments: { entityType: "invoice_payment", entityIdColumn: "id", conflictColumns: ["id"] },
  invoice_extractions: { entityType: "invoice_extraction", entityIdColumn: "id", conflictColumns: ["id"] },
  financial_entries: { entityType: "financial_entry", entityIdColumn: "id", conflictColumns: ["id"] },
};

const tableCursorColumn: Record<TreasuryPullTable | CollaboratorPaymentPullTable | FinanceBusinessPullTable, string> = {
  bank_accounts: "updated_at",
  bank_statement_imports: "created_at",
  bank_transactions: "created_at",
  transaction_annotations: "updated_at",
  transaction_project_allocations: "updated_at",
  transaction_links: "created_at",
  counterparty_rules: "updated_at",
  collaborator_fees: "updated_at",
  collaborator_payment_batches: "created_at",
  collaborator_fee_payments: "created_at",
  currency_settings: "updated_at",
  quotes: "updated_at",
  quote_items: "updated_at",
  quote_versions: "created_at",
  invoices: "updated_at",
  invoice_items: "updated_at",
  invoice_payments: "created_at",
  invoice_extractions: "updated_at",
  financial_entries: "updated_at",
};

const toSqlInputValue = (value: unknown): SQLInputValue => {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string" || typeof value === "bigint") return value;
  return JSON.stringify(value);
};

const toRecord = (row: Record<string, unknown>) => ({ ...row });

const readColumns = (db: DatabaseSync, table: string) =>
  new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));

const filterRowToTable = (db: DatabaseSync, table: string, row: Record<string, unknown>) => {
  const columnNames = readColumns(db, table);
  return Object.fromEntries(Object.entries(row).filter(([key]) => columnNames.has(key)));
};

const rowExists = (db: DatabaseSync, table: string, id: unknown) => {
  if (id === null || id === undefined || id === "") return false;
  const row = db.prepare(`SELECT 1 AS found FROM ${table} WHERE id = ? LIMIT 1`).get(toSqlInputValue(id)) as
    | { found: number }
    | undefined;
  return Boolean(row);
};

const rowExistsByColumn = (db: DatabaseSync, table: string, column: string, value: unknown) => {
  if (value === null || value === undefined || value === "") return false;
  const row = db.prepare(`SELECT 1 AS found FROM ${table} WHERE ${column} = ? LIMIT 1`).get(toSqlInputValue(value)) as
    | { found: number }
    | undefined;
  return Boolean(row);
};

const hasPendingOutbox = (
  db: DatabaseSync,
  workspaceId: string,
  entityType: string,
  entityId: unknown,
) => {
  if (entityId === null || entityId === undefined || entityId === "") return false;
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM sync_outbox
        WHERE workspace_id = ?
          AND entity_type = ?
          AND entity_id = ?
          AND status IN ('pending', 'processing', 'failed')
      `,
    )
    .get(workspaceId, entityType, String(entityId)) as { count: number };
  return row.count > 0;
};

const hasPendingInvoicePaymentForInvoice = (db: DatabaseSync, workspaceId: string, invoiceId: unknown) => {
  if (invoiceId === null || invoiceId === undefined || invoiceId === "") return false;
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM sync_outbox
        WHERE workspace_id = ?
          AND entity_type = 'invoice_payment'
          AND status IN ('pending', 'processing', 'failed')
          AND payload_json LIKE ?
      `,
    )
    .get(workspaceId, `%"invoiceId":"${String(invoiceId)}"%`) as { count: number };
  return row.count > 0;
};

const resolveOutboxEntityId = (
  table: TreasuryPullTable | CollaboratorPaymentPullTable | FinanceBusinessPullTable,
  workspaceId: string,
  row: Record<string, unknown>,
  entityIdColumn: string,
) => {
  if (table === "currency_settings") return `currency-settings-${workspaceId}`;
  return row[entityIdColumn];
};

const readLocalCursor = (
  db: DatabaseSync,
  table: TreasuryPullTable | CollaboratorPaymentPullTable | FinanceBusinessPullTable,
  row: Record<string, unknown>,
  conflictColumns: string[] = ["id"],
) => {
  const cursorColumn = tableCursorColumn[table];
  const conflictColumn = table === "transaction_annotations" ? "transaction_id" : conflictColumns[0] ?? "id";
  const conflictId = row[conflictColumn];
  if (!conflictId) return null;
  const result = db
    .prepare(`SELECT ${cursorColumn} AS cursor_value FROM ${table} WHERE ${conflictColumn} = ? LIMIT 1`)
    .get(toSqlInputValue(conflictId)) as { cursor_value?: string | null } | undefined;
  return typeof result?.cursor_value === "string" ? result.cursor_value : null;
};

const upsertRow = (
  db: DatabaseSync,
  table: string,
  row: Record<string, unknown>,
  conflictColumns: string[],
) => {
  const filtered = filterRowToTable(db, table, row);
  const entries = Object.entries(filtered);
  if (!entries.length) return;

  const columns = entries.map(([key]) => key);
  const placeholders = columns.map(() => "?").join(", ");
  const conflictTarget = conflictColumns.join(", ");
  const updates = columns
    .filter((column) => !conflictColumns.includes(column))
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");

  db.prepare(
    `
      INSERT INTO ${table} (${columns.join(", ")})
      VALUES (${placeholders})
      ON CONFLICT(${conflictTarget}) DO UPDATE SET ${updates || `${conflictColumns[0]} = excluded.${conflictColumns[0]}`}
    `,
  ).run(...entries.map(([, value]) => toSqlInputValue(value)));
};

const ensureCrewMember = (db: DatabaseSync, workspaceId: string, crewMemberId: unknown, updatedAt: string) => {
  if (!crewMemberId || rowExists(db, "crew_members", crewMemberId)) return;
  const crewId = String(crewMemberId);
  db.prepare(
    `
      INSERT OR IGNORE INTO crew_members (
        id, workspace_id, full_name, role_label, email, phone, notes, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, NULL, NULL, 'Created locally during collaborator payment sync; full crew catalog should hydrate later.', 1, ?, ?)
    `,
  ).run(crewId, workspaceId, `Remote collaborator ${crewId.slice(-6) || crewId}`, updatedAt, updatedAt);
};

const ensureUser = (db: DatabaseSync, userId: unknown, updatedAt: string) => {
  if (!userId || rowExists(db, "users", userId)) return;
  const id = String(userId);
  db.prepare(
    `
      INSERT OR IGNORE INTO users (id, full_name, email, phone, is_active, created_at, updated_at)
      VALUES (?, ?, ?, NULL, 1, ?, ?)
    `,
  ).run(id, `Remote user ${id.slice(-6) || id}`, `${id}@remote.bukowskios.local`, updatedAt, updatedAt);
};

const sanitizeTreasuryRow = (
  db: DatabaseSync,
  table: TreasuryPullTable,
  row: Record<string, unknown>,
): Record<string, unknown> | null => {
  const next = toRecord(row);
  if (table === "bank_statement_imports" && !rowExists(db, "bank_accounts", next.bank_account_id)) return null;
  if (table === "bank_transactions" && !rowExists(db, "bank_accounts", next.bank_account_id)) return null;
  if (table === "transaction_annotations" && !rowExists(db, "bank_transactions", next.transaction_id)) return null;
  if (table === "transaction_project_allocations") {
    if (!rowExists(db, "bank_transactions", next.transaction_id)) return null;
    if (next.project_id && !rowExists(db, "projects", next.project_id)) next.project_id = null;
  }
  if (table === "transaction_links" && !rowExists(db, "bank_transactions", next.transaction_id)) return null;
  if (table === "counterparty_rules" && next.default_project_id && !rowExists(db, "projects", next.default_project_id)) {
    next.default_project_id = null;
  }
  return next;
};

const sanitizeCollaboratorRow = (
  db: DatabaseSync,
  table: CollaboratorPaymentPullTable,
  workspaceId: string,
  row: Record<string, unknown>,
): Record<string, unknown> | null => {
  const next = toRecord(row);
  const updatedAt = String(next.updated_at ?? next.created_at ?? new Date().toISOString());
  if (table === "collaborator_fees") {
    ensureCrewMember(db, workspaceId, next.crew_member_id, updatedAt);
    if (next.project_id && !rowExists(db, "projects", next.project_id)) next.project_id = null;
    if (next.project_unit_id && !rowExists(db, "project_units", next.project_unit_id)) next.project_unit_id = null;
    if (next.department_id && !rowExists(db, "departments", next.department_id)) next.department_id = null;
    if (next.source_assignment_id && !rowExists(db, "project_unit_crew_assignments", next.source_assignment_id)) {
      next.source_assignment_id = null;
    }
  }
  if (table === "collaborator_payment_batches") {
    ensureCrewMember(db, workspaceId, next.crew_member_id, updatedAt);
  }
  if (table === "collaborator_fee_payments") {
    if (!rowExists(db, "collaborator_fees", next.fee_id)) return null;
    if (!rowExists(db, "collaborator_payment_batches", next.payment_batch_id)) return null;
  }
  return next;
};

const sanitizeFinanceBusinessRow = (
  db: DatabaseSync,
  table: FinanceBusinessPullTable,
  workspaceId: string,
  row: Record<string, unknown>,
): Record<string, unknown> | null => {
  const next = toRecord(row);
  const updatedAt = String(next.updated_at ?? next.created_at ?? new Date().toISOString());

  if (table === "currency_settings") {
    next.id = `currency-settings-${workspaceId}`;
  }

  if (table === "quotes") {
    if (next.project_id && !rowExists(db, "projects", next.project_id)) next.project_id = null;
    if (next.created_by_user_id) ensureUser(db, next.created_by_user_id, updatedAt);
    if (next.updated_by_user_id) ensureUser(db, next.updated_by_user_id, updatedAt);
  }

  if (table === "quote_items" && !rowExists(db, "quotes", next.quote_id)) return null;
  if (table === "quote_versions") {
    if (!rowExists(db, "quotes", next.quote_id)) return null;
    if (next.created_by_user_id) ensureUser(db, next.created_by_user_id, updatedAt);
  }

  if (table === "invoices") {
    if (next.source_quote_id && !rowExists(db, "quotes", next.source_quote_id)) next.source_quote_id = null;
    if (next.project_id && !rowExists(db, "projects", next.project_id)) next.project_id = null;
    if (next.created_by_user_id) ensureUser(db, next.created_by_user_id, updatedAt);
    if (next.updated_by_user_id) ensureUser(db, next.updated_by_user_id, updatedAt);
  }

  if (table === "invoice_items" && !rowExists(db, "invoices", next.invoice_id)) return null;
  if (table === "invoice_payments") {
    if (!rowExists(db, "invoices", next.invoice_id)) return null;
    if (next.recorded_by_user_id) ensureUser(db, next.recorded_by_user_id, updatedAt);
  }

  if (table === "invoice_extractions") {
    if (next.uploaded_by_user_id) ensureUser(db, next.uploaded_by_user_id, updatedAt);
    if (next.linked_user_id) ensureUser(db, next.linked_user_id, updatedAt);
    if (next.applied_transaction_id && !rowExists(db, "bank_transactions", next.applied_transaction_id)) {
      next.applied_transaction_id = null;
    }
    if (next.suggested_transaction_id && !rowExists(db, "bank_transactions", next.suggested_transaction_id)) {
      next.suggested_transaction_id = null;
    }
  }

  if (table === "financial_entries") {
    if (next.project_id && !rowExists(db, "projects", next.project_id)) next.project_id = null;
    if (next.project_unit_id && !rowExists(db, "project_units", next.project_unit_id)) next.project_unit_id = null;
    if (next.asset_id && !rowExists(db, "assets", next.asset_id)) next.asset_id = null;
    if (next.incident_id && !rowExists(db, "incidents", next.incident_id)) next.incident_id = null;
    next.created_by_user_id = next.created_by_user_id || "user-ops";
    ensureUser(db, next.created_by_user_id, updatedAt);
  }

  return next;
};

const updateCursor = (
  db: DatabaseSync,
  workspaceId: string,
  entityType: string,
  cursorAfter: string | null,
  appliedCount: number,
  errorMessage: string | null,
) => {
  db.prepare(
    `
      INSERT INTO sync_pull_cursors (workspace_id, entity_type, last_synced_at, last_pulled_count, last_error, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(workspace_id, entity_type) DO UPDATE SET
        last_synced_at = excluded.last_synced_at,
        last_pulled_count = excluded.last_pulled_count,
        last_error = excluded.last_error,
        updated_at = CURRENT_TIMESTAMP
    `,
  ).run(workspaceId, entityType, cursorAfter, appliedCount, errorMessage);
};

const applyRows = <TTable extends TreasuryPullTable | CollaboratorPaymentPullTable | FinanceBusinessPullTable>(
  db: DatabaseSync,
  workspaceId: string,
  table: TTable,
  rows: Array<Record<string, unknown>>,
  config: { entityType: string; entityIdColumn: string; conflictColumns: string[] },
  sanitize: (row: Record<string, unknown>) => Record<string, unknown> | null,
): FinancialDomainPullResult<TTable> => {
  const result: FinancialDomainPullResult<TTable> = {
    workspaceId,
    table,
    appliedCount: 0,
    skippedDueToOutboxCount: 0,
    skippedDueToOlderCount: 0,
    skippedDueToDependencyCount: 0,
    errors: [],
    cursorAfter: null,
  };

  db.exec("BEGIN");
  try {
    for (const rawRow of rows) {
      if (rawRow.workspace_id !== workspaceId) continue;
      const cursorValue = String(rawRow[tableCursorColumn[table]] ?? "");
      const markCursorApplied = () => {
        if (cursorValue && (!result.cursorAfter || cursorValue > result.cursorAfter)) result.cursorAfter = cursorValue;
      };

      const outboxEntityId = resolveOutboxEntityId(table, workspaceId, rawRow, config.entityIdColumn);
      if (
        hasPendingOutbox(db, workspaceId, config.entityType, outboxEntityId) ||
        (table === "invoices" && hasPendingInvoicePaymentForInvoice(db, workspaceId, outboxEntityId))
      ) {
        result.skippedDueToOutboxCount += 1;
        continue;
      }

      const localCursor = readLocalCursor(db, table, rawRow, config.conflictColumns);
      if (localCursor && cursorValue && localCursor >= cursorValue) {
        result.skippedDueToOlderCount += 1;
        markCursorApplied();
        continue;
      }

      const row = sanitize(rawRow);
      if (!row) {
        result.skippedDueToDependencyCount += 1;
        continue;
      }

      try {
        upsertRow(db, table, row, config.conflictColumns);
        result.appliedCount += 1;
        markCursorApplied();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown financial pull error.";
        result.errors.push(`${String(rawRow[config.entityIdColumn] ?? rawRow.id ?? table)}: ${message}`);
        logger.warn("Financial domain pull row failed.", { table, error: message });
      }
    }

    if ((table === "bank_transactions" || table === "counterparty_rules") && result.appliedCount > 0) {
      materializeTreasuryCounterpartyRules(db, workspaceId);
    }

    updateCursor(db, workspaceId, table, result.cursorAfter, result.appliedCount, result.errors[0] ?? null);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    const message = error instanceof Error ? error.message : "Unknown financial pull transaction error.";
    result.errors.push(message);
    logger.error("Financial domain pull transaction rolled back.", { table, error: message });
  }

  return result;
};

export const createFinancialDomainPullService = (db: DatabaseSync) => ({
  applyRemoteTreasuryRows(
    workspaceId: string,
    table: TreasuryPullTable,
    rows: Array<Record<string, unknown>>,
  ): FinancialDomainPullResult<TreasuryPullTable> {
    return applyRows(db, workspaceId, table, rows, treasuryEntityMap[table], (row) => sanitizeTreasuryRow(db, table, row));
  },
  applyRemoteCollaboratorPaymentRows(
    workspaceId: string,
    table: CollaboratorPaymentPullTable,
    rows: Array<Record<string, unknown>>,
  ): FinancialDomainPullResult<CollaboratorPaymentPullTable> {
    return applyRows(db, workspaceId, table, rows, collaboratorEntityMap[table], (row) =>
      sanitizeCollaboratorRow(db, table, workspaceId, row),
    );
  },
  applyRemoteFinanceBusinessRows(
    workspaceId: string,
    table: FinanceBusinessPullTable,
    rows: Array<Record<string, unknown>>,
  ): FinancialDomainPullResult<FinanceBusinessPullTable> {
    return applyRows(db, workspaceId, table, rows, financeBusinessEntityMap[table], (row) =>
      sanitizeFinanceBusinessRow(db, table, workspaceId, row),
    );
  },
});
