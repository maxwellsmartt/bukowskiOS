import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  AddManualTransactionsCommand,
  AnnotateTransactionCommand,
  ApplyCounterpartyRuleCommand,
  ApplyCounterpartyRuleResult,
  BankAccountMutationResult,
  CreateCardSettlementCommand,
  CorrectTransactionCommand,
  DeactivatePaymentInstrumentCommand,
  DeleteImportCommand,
  ImportStatementCommand,
  ImportStatementResult,
  InvoiceAllocationMutationResult,
  LinkInvoiceAllocationToTransactionCommand,
  LinkTransactionCommand,
  AssignInvoiceAllocationCommand,
  MarkInvoiceAllocationReimbursedCommand,
  ParsedBankTransaction,
  RejectInvoiceAllocationCommand,
  ReviewReimbursementCommand,
  SetAllocationsCommand,
  TransactionKind,
  TransactionMutationResult,
  UnlinkInvoiceAllocationCommand,
  UndoTreasuryActionCommand,
  UpsertBankAccountCommand,
  UpsertPaymentInstrumentCommand,
} from "@contracts";

const defaultActorUserId = "user-ops";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const extractLast4 = (value: string | null | undefined) => {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
};

const normalizeCurrency = (value: string) => value.trim().toUpperCase();

const ensureCreditCardDays = (input: {
  instrumentKind?: string;
  isActive?: boolean;
  statementCycleDay?: number | null;
  paymentDueDay?: number | null;
}) => {
  if (input.instrumentKind !== "credit_card" || input.isActive === false) return;
  if (!input.statementCycleDay || !input.paymentDueDay) {
    throw new Error("Active credit cards require statement cycle and payment due days.");
  }
};

const validatePaymentInstrumentOwner = (input: { owner?: string; ownerUserId?: string | null }) => {
  if (input.owner === "user" && !input.ownerUserId?.trim()) {
    throw new Error("User-owned payment instruments require an owner user.");
  }
};

const buildFailedCommandMessage = (label: string, previousError?: string | null) =>
  previousError
    ? `This command id already failed once for ${label}: ${previousError}`
    : `This command id already failed once for ${label}. Generate a new action and retry.`;

const createCommandReceiptHelpers = (db: DatabaseSync) => ({
  getExistingReceipt(commandId: string) {
    return db
      .prepare(
        `SELECT outcome_status, error_message FROM command_receipts WHERE command_id = ? LIMIT 1`,
      )
      .get(commandId) as { outcome_status: string; error_message: string | null } | undefined;
  },
  insertReceipt: db.prepare(
    `
      INSERT OR REPLACE INTO command_receipts (
        command_id, workspace_id, actor_user_id, actor_type, source_channel,
        executed_at, outcome_status, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ),
});

const enqueueOutbox = (
  db: DatabaseSync,
  workspaceId: string,
  entityType: string,
  entityId: string,
  payload: unknown,
  syncId: string,
  now: string,
  operationType: "upsert" | "delete" = "upsert",
) => {
  db.prepare(
    `
      INSERT INTO sync_outbox (
        id, workspace_id, entity_type, entity_id, operation_type,
        payload_json, status, attempt_count, last_error, next_retry_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?, ?)
    `,
  ).run(syncId, workspaceId, entityType, entityId, operationType, JSON.stringify(payload), now, now, now);
};

// Records the BEFORE state of a reversible edit into the local undo journal so
// the desktop app can offer multi-level Cmd+Z. `kind` drives how undo restores
// it; `label` is the human detail (concept / account / movement) shown in the
// toast. Called inside the mutation's transaction, before the change.
const recordUndo = (
  db: DatabaseSync,
  workspaceId: string,
  commandId: string,
  kind: string,
  label: string,
  priorState: unknown,
  now: string,
) => {
  db.prepare(
    `INSERT INTO treasury_undo_journal (
       id, workspace_id, command_id, kind, label, prior_state_json, created_at, undone
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    `undo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    commandId,
    kind,
    label,
    priorState == null ? null : JSON.stringify(priorState),
    now,
  );
};

// Restores a full snapshotted row into its table by primary key. The snapshot
// rows are whole DB rows (all columns), so we can rebuild the INSERT generically
// and let ON CONFLICT/REPLACE put the prior values back.
const replaceRow = (db: DatabaseSync, table: string, row: Record<string, unknown>) => {
  const columns = Object.keys(row);
  if (columns.length === 0) return;
  const placeholders = columns.map(() => "?").join(", ");
  const quoted = columns.map((column) => `"${column}"`).join(", ");
  db.prepare(`INSERT OR REPLACE INTO ${table} (${quoted}) VALUES (${placeholders})`).run(
    ...columns.map((column) => row[column] as string | number | null),
  );
};

const parseUndoState = (value: string | null): Record<string, unknown> => {
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
};

const restoreBlankAnnotation = (db: DatabaseSync, workspaceId: string, transactionId: string, now: string) => {
  db.prepare(
    `
      INSERT INTO transaction_annotations (
        transaction_id, workspace_id, txn_kind, concept, counterparty,
        counterparty_rnc, expense_category, is_internal_transfer,
        supplier_ncf, dgii_expense_type, withholding_type,
        withholding_rate, withholding_amount, fiscal_period,
        reimbursement_status, claimed_amount, deductible_amount, fiscal_status,
        reviewed_by_user_id, reviewed_at, support_doc_file_id, notes,
        classified_by_user_id, updated_at
      ) VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, 'n/a', NULL, NULL, 'pending', NULL, NULL, NULL, NULL, NULL, ?)
      ON CONFLICT(transaction_id) DO UPDATE SET
        txn_kind = NULL,
        concept = NULL,
        counterparty = NULL,
        counterparty_rnc = NULL,
        expense_category = NULL,
        supplier_ncf = NULL,
        dgii_expense_type = NULL,
        withholding_type = NULL,
        withholding_rate = NULL,
        withholding_amount = NULL,
        fiscal_period = NULL,
        is_internal_transfer = 0,
        reimbursement_status = 'n/a',
        claimed_amount = NULL,
        deductible_amount = NULL,
        fiscal_status = 'pending',
        reviewed_by_user_id = NULL,
        reviewed_at = NULL,
        support_doc_file_id = NULL,
        notes = NULL,
        classified_by_user_id = NULL,
        updated_at = excluded.updated_at
    `,
  ).run(transactionId, workspaceId, now);
};

const restoreAnnotation = (
  db: DatabaseSync,
  workspaceId: string,
  transactionId: string,
  prior: unknown,
  now: string,
) => {
  if (prior && typeof prior === "object" && !Array.isArray(prior)) {
    replaceRow(db, "transaction_annotations", prior as Record<string, unknown>);
    return;
  }
  restoreBlankAnnotation(db, workspaceId, transactionId, now);
};

const restoreAllocations = (db: DatabaseSync, transactionId: string, prior: unknown) => {
  db.prepare(`DELETE FROM transaction_project_allocations WHERE transaction_id = ?`).run(transactionId);
  if (!Array.isArray(prior)) return;
  for (const row of prior) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      replaceRow(db, "transaction_project_allocations", row as Record<string, unknown>);
    }
  }
};

const computeDedupeHash = (bankAccountId: string, row: ParsedBankTransaction) => {
  const parts = [
    bankAccountId,
    row.txnDate,
    round2(row.amount).toFixed(2),
    row.direction,
    (row.rawDescription ?? "").trim(),
    row.runningBalance == null ? "" : round2(row.runningBalance).toFixed(2),
    (row.reference ?? "").trim(),
    (row.serial ?? "").trim(),
  ];
  return createHash("sha1").update(parts.join("|")).digest("hex");
};

const normalizeRuleText = (value: string | null | undefined) =>
  (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();

const ruleIdFor = (workspaceId: string, matchType: string, matchPattern: string) =>
  `counterparty-rule-${createHash("sha1")
    .update(`${workspaceId}|${matchType}|${normalizeRuleText(matchPattern)}`)
    .digest("hex")}`;

type CounterpartyRule = {
  id: string;
  match_pattern: string;
  match_type: "exact" | "contains";
  default_kind: TransactionKind | null;
  default_category: string | null;
  default_counterparty: string | null;
};

const matchesRule = (rule: CounterpartyRule, rawDescription: string | null | undefined) => {
  const text = normalizeRuleText(rawDescription);
  const pattern = normalizeRuleText(rule.match_pattern);
  if (!text || !pattern) return false;
  return rule.match_type === "contains" ? text.includes(pattern) : text === pattern;
};

const loadActiveRules = (db: DatabaseSync, workspaceId: string): CounterpartyRule[] =>
  db
    .prepare(
      `SELECT id, match_pattern, match_type, default_kind, default_category, default_counterparty
       FROM counterparty_rules
       WHERE workspace_id = ? AND is_active = 1
       ORDER BY priority DESC, updated_at DESC`,
    )
    .all(workspaceId) as CounterpartyRule[];

/**
 * Heuristic auto-classification applied at import time. Always conservative —
 * only sets a kind when the description clearly matches a bank fee / tax, or
 * when the counterparty is one of the workspace's own accounts (internal
 * transfer). The human confirms / overrides afterwards.
 */
const autoClassify = (
  rawDescription: string | null | undefined,
  ownAccountNumbers: Array<{ number: string; currency: string }>,
  accountCurrency: string,
): { kind: TransactionKind | null; isInternalTransfer: boolean; counterparty: string | null } => {
  const text = (rawDescription ?? "").toUpperCase();
  if (!text.trim()) return { kind: null, isInternalTransfer: false, counterparty: null };

  // Internal transfer detection: another of our own account numbers appears.
  for (const own of ownAccountNumbers) {
    if (own.number && text.includes(own.number.toUpperCase())) {
      const kind: TransactionKind = own.currency !== accountCurrency ? "fx_exchange" : "transfer";
      return { kind, isInternalTransfer: true, counterparty: "Internal transfer" };
    }
  }

  // Bank fees / taxes (Banco Popular + Santa Cruz wordings seen in real data).
  const feePatterns = ["COMISION", "COMISIONES", "POR 1000", "1.5 X 1000", "1.5 POR 1000"];
  if (feePatterns.some((p) => text.includes(p))) {
    return { kind: "bank_fee", isInternalTransfer: false, counterparty: "Bank fee" };
  }
  if (text.includes("PAGO IMPUESTO") || text.includes("PAG DGII") || text.includes("DGII")) {
    return { kind: "tax", isInternalTransfer: false, counterparty: "DGII" };
  }
  if (text.includes("PAG TSS") || text.includes(" TSS ") || text.startsWith("EXI PAG TSS")) {
    return { kind: "tss", isInternalTransfer: false, counterparty: "TSS" };
  }
  if (text.includes("PAGO INTERESES") || text.includes("COMPENSACION POR BALANCE")) {
    return { kind: "interest", isInternalTransfer: false, counterparty: "Interest" };
  }
  return { kind: null, isInternalTransfer: false, counterparty: null };
};

export const createTreasuryMutationService = (db: DatabaseSync) => {
  const receiptHelpers = createCommandReceiptHelpers(db);

  const recordReceipt = (
    input: { commandId: string; workspaceId: string; actorType: string; sourceChannel: string },
    now: string,
    status: "success" | "failed",
    errorMessage: string | null,
  ) => {
    receiptHelpers.insertReceipt.run(
      input.commandId,
      input.workspaceId,
      defaultActorUserId,
      input.actorType,
      input.sourceChannel,
      now,
      status,
      errorMessage,
    );
  };

  const updateInvoiceAllocationStatus = (
    input: UnlinkInvoiceAllocationCommand | RejectInvoiceAllocationCommand | MarkInvoiceAllocationReimbursedCommand,
    options: {
      status: "pending" | "rejected" | "reimbursed";
      transactionId?: string | null;
      summary: string;
      failedLabel: string;
    },
  ): InvoiceAllocationMutationResult => {
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    if (existing?.outcome_status === "success") {
      const allocation = loadAllocation(db, input.workspaceId, input.allocationId);
      return {
        commandId: input.commandId,
        allocationId: input.allocationId,
        transactionId: allocation.transaction_id,
        repeated: true,
        summary: options.summary,
      };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage(options.failedLabel, existing.error_message));
    }

    const now = new Date().toISOString();
    db.exec("BEGIN");
    try {
      loadAllocation(db, input.workspaceId, input.allocationId);
      db.prepare(
        `UPDATE transaction_links
         SET transaction_id = COALESCE(?, transaction_id),
             allocation_status = ?,
             notes = COALESCE(?, notes),
             updated_at = ?
         WHERE workspace_id = ? AND id = ?`,
      ).run(
        options.transactionId === null ? null : options.transactionId ?? null,
        options.status,
        input.notes?.trim() || null,
        now,
        input.workspaceId,
        input.allocationId,
      );
      if (options.transactionId === null) {
        db.prepare(`UPDATE transaction_links SET transaction_id = NULL WHERE workspace_id = ? AND id = ?`).run(
          input.workspaceId,
          input.allocationId,
        );
      }
      enqueueOutbox(
        db,
        input.workspaceId,
        "transaction_link",
        input.allocationId,
        { allocationStatus: options.status },
        `sync-${input.commandId}`,
        now,
      );
      recordReceipt(input, now, "success", null);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      recordReceipt(input, now, "failed", error instanceof Error ? error.message : "Allocation status failed.");
      throw error;
    }
    const allocation = loadAllocation(db, input.workspaceId, input.allocationId);
    return {
      commandId: input.commandId,
      allocationId: input.allocationId,
      transactionId: allocation.transaction_id,
      repeated: false,
      summary: options.summary,
    };
  };

const loadPaymentInstrument = (db: DatabaseSync, workspaceId: string, paymentInstrumentId: string) => {
  const row = db
    .prepare(
      `SELECT id, currency, is_active, instrument_kind
       FROM bank_accounts
       WHERE workspace_id = ? AND id = ?
       LIMIT 1`,
    )
    .get(workspaceId, paymentInstrumentId) as
    | { id: string; currency: string; is_active: number; instrument_kind: string | null }
    | undefined;
  if (!row) throw new Error("Payment instrument not found for this workspace.");
  return row;
};

const loadBankTransaction = (db: DatabaseSync, workspaceId: string, transactionId: string) => {
  const row = db
    .prepare(
      `SELECT id, amount, currency
       FROM bank_transactions
       WHERE workspace_id = ? AND id = ?
       LIMIT 1`,
    )
    .get(workspaceId, transactionId) as { id: string; amount: number; currency: string } | undefined;
  if (!row) throw new Error("Bank transaction not found for this workspace.");
  return row;
};

const loadAllocation = (db: DatabaseSync, workspaceId: string, allocationId: string) => {
  const row = db
    .prepare(`SELECT * FROM transaction_links WHERE workspace_id = ? AND id = ? LIMIT 1`)
    .get(workspaceId, allocationId) as
    | {
        id: string;
        workspace_id: string;
        transaction_id: string | null;
        payment_instrument_id: string | null;
        linked_entity_type: string;
        linked_entity_id: string;
        amount_applied: number | null;
        amount_currency: string | null;
        allocation_status: string;
      }
    | undefined;
  if (!row) throw new Error("Invoice allocation not found for this workspace.");
  return row;
};

const loadLinkedEntityTotal = (db: DatabaseSync, workspaceId: string, linkedEntityType: string, linkedEntityId: string) => {
  if (linkedEntityType === "invoice") {
    const row = db
      .prepare(`SELECT total_amount AS amount, currency FROM invoices WHERE workspace_id = ? AND id = ? LIMIT 1`)
      .get(workspaceId, linkedEntityId) as { amount: number; currency: string } | undefined;
    return row ?? null;
  }
  if (linkedEntityType === "invoice_extraction") {
    const row = db
      .prepare(`SELECT total AS amount, currency FROM invoice_extractions WHERE workspace_id = ? AND id = ? LIMIT 1`)
      .get(workspaceId, linkedEntityId) as { amount: number | null; currency: string | null } | undefined;
    return row?.amount != null && row.currency ? { amount: row.amount, currency: row.currency } : null;
  }
  if (linkedEntityType === "financial_entry") {
    const row = db
      .prepare(`SELECT amount, currency FROM financial_entries WHERE workspace_id = ? AND id = ? LIMIT 1`)
      .get(workspaceId, linkedEntityId) as { amount: number; currency: string } | undefined;
    return row ?? null;
  }
  return null;
};

const ensureAllocationTotalWithinEntity = (
  db: DatabaseSync,
  input: {
    workspaceId: string;
    linkedEntityType: string;
    linkedEntityId: string;
    amountApplied: number;
    amountCurrency: string;
    excludeAllocationId?: string | null;
  },
) => {
  const entityTotal = loadLinkedEntityTotal(db, input.workspaceId, input.linkedEntityType, input.linkedEntityId);
  if (!entityTotal) return;
  if (normalizeCurrency(entityTotal.currency) !== normalizeCurrency(input.amountCurrency)) return;
  const existing = db
    .prepare(
      `
        SELECT COALESCE(SUM(amount_applied), 0) AS total
        FROM transaction_links
        WHERE workspace_id = ?
          AND linked_entity_type = ?
          AND linked_entity_id = ?
          AND allocation_status NOT IN ('rejected')
          AND id <> ?
          AND COALESCE(amount_currency, ?) = ?
      `,
    )
    .get(
      input.workspaceId,
      input.linkedEntityType,
      input.linkedEntityId,
      input.excludeAllocationId ?? "",
      input.amountCurrency,
      input.amountCurrency,
    ) as { total: number };
  if (round2(Number(existing.total ?? 0) + input.amountApplied) - round2(entityTotal.amount) > 0.005) {
    throw new Error("Invoice allocations cannot exceed the linked document total.");
  }
};

  const importTransactions = (input: ImportStatementCommand): ImportStatementResult => {
    const existing = receiptHelpers.getExistingReceipt(input.commandId);
    const importId = `import-${input.commandId}`;
    if (existing?.outcome_status === "success") {
      const found = db
        .prepare(
          `SELECT inserted_count, duplicate_count, row_count FROM bank_statement_imports WHERE id = ?`,
        )
        .get(importId) as
        | { inserted_count: number; duplicate_count: number; row_count: number }
        | undefined;
      return {
        commandId: input.commandId,
        importId,
        bankAccountId: input.bankAccountId,
        rowCount: found?.row_count ?? input.rows.length,
        insertedCount: found?.inserted_count ?? 0,
        duplicateCount: found?.duplicate_count ?? 0,
        repeated: true,
        summary: "Statement already imported.",
      };
    }
    if (existing?.outcome_status === "failed") {
      throw new Error(buildFailedCommandMessage("statement import", existing.error_message));
    }

    const account = db
      .prepare(
        `SELECT id, currency FROM bank_accounts WHERE id = ? AND workspace_id = ? LIMIT 1`,
      )
      .get(input.bankAccountId, input.workspaceId) as
      | { id: string; currency: string }
      | undefined;
    if (!account) throw new Error("Bank account not found for this workspace.");

    const ownAccounts = db
      .prepare(
        `SELECT account_number_full, account_number_masked, last4, currency
         FROM bank_accounts WHERE workspace_id = ? AND id <> ?`,
      )
      .all(input.workspaceId, input.bankAccountId) as Array<{
      account_number_full: string | null;
      account_number_masked: string | null;
      last4: string | null;
      currency: string;
    }>;
    const ownAccountNumbers = ownAccounts.flatMap((row) =>
      [row.account_number_full, row.account_number_masked, row.last4, extractLast4(row.account_number_masked)]
        .filter((n): n is string => Boolean(n && n.trim().length >= 4))
        .map((number) => ({ number, currency: row.currency })),
    );

    const now = new Date().toISOString();
    let insertedCount = 0;
    let duplicateCount = 0;
    const activeRules = loadActiveRules(db, input.workspaceId);

    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO bank_statement_imports (
           id, workspace_id, bank_account_id, source_format, original_filename,
           period_start, period_end, row_count, inserted_count, duplicate_count,
           imported_by_user_id, notes, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
      ).run(
        importId,
        input.workspaceId,
        input.bankAccountId,
        input.sourceFormat,
        input.originalFilename?.trim() || null,
        input.periodStart?.trim() || null,
        input.periodEnd?.trim() || null,
        input.rows.length,
        defaultActorUserId,
        input.notes?.trim() || null,
        now,
      );

      const insertTxn = db.prepare(
        `INSERT INTO bank_transactions (
           id, workspace_id, bank_account_id, import_id, txn_date, value_date,
           raw_description, reference, serial, amount, direction, running_balance,
           currency, dedupe_hash, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertAnnotation = db.prepare(
        `INSERT INTO transaction_annotations (
           transaction_id, workspace_id, txn_kind, counterparty, expense_category,
           is_internal_transfer, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const existsTxn = db.prepare(
        `SELECT id FROM bank_transactions WHERE workspace_id = ? AND bank_account_id = ? AND dedupe_hash = ? LIMIT 1`,
      );

      for (const row of input.rows) {
        const hash = computeDedupeHash(input.bankAccountId, row);
        const already = existsTxn.get(input.workspaceId, input.bankAccountId, hash);
        if (already) {
          duplicateCount += 1;
          continue;
        }
        const txnId = `txn-${hash}`;
        insertTxn.run(
          txnId,
          input.workspaceId,
          input.bankAccountId,
          importId,
          row.txnDate,
          row.valueDate?.trim() || null,
          row.rawDescription?.trim() || null,
          row.reference?.trim() || null,
          row.serial?.trim() || null,
          round2(row.amount),
          row.direction,
          row.runningBalance == null ? null : round2(row.runningBalance),
          account.currency,
          hash,
          now,
        );

        const auto = autoClassify(row.rawDescription, ownAccountNumbers, account.currency);
        const rememberedRule = !auto.kind && !auto.isInternalTransfer
          ? activeRules.find((rule) => matchesRule(rule, row.rawDescription))
          : null;
        if (auto.kind || auto.isInternalTransfer || rememberedRule?.default_kind) {
          insertAnnotation.run(
            txnId,
            input.workspaceId,
            auto.kind ?? rememberedRule?.default_kind ?? null,
            auto.counterparty ?? rememberedRule?.default_counterparty ?? null,
            rememberedRule?.default_category ?? null,
            auto.isInternalTransfer ? 1 : 0,
            now,
          );
        }
        insertedCount += 1;
      }

      db.prepare(
        `UPDATE bank_statement_imports SET inserted_count = ?, duplicate_count = ? WHERE id = ?`,
      ).run(insertedCount, duplicateCount, importId);

      enqueueOutbox(
        db,
        input.workspaceId,
        "bank_statement_import",
        importId,
        {
          bankAccountId: input.bankAccountId,
          sourceFormat: input.sourceFormat,
          rowCount: input.rows.length,
          insertedCount,
          duplicateCount,
        },
        `sync-${input.commandId}`,
        now,
      );
      recordReceipt(input, now, "success", null);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      recordReceipt(
        input,
        now,
        "failed",
        error instanceof Error ? error.message : "Statement import failed.",
      );
      throw error;
    }

    return {
      commandId: input.commandId,
      importId,
      bankAccountId: input.bankAccountId,
      rowCount: input.rows.length,
      insertedCount,
      duplicateCount,
      repeated: false,
      summary: `Imported ${insertedCount} new movement(s), ${duplicateCount} duplicate(s) skipped.`,
    };
  };

  return {
    upsertBankAccount(input: UpsertBankAccountCommand): BankAccountMutationResult {
      const existing = receiptHelpers.getExistingReceipt(input.commandId);
      const bankAccountId = input.bankAccountId?.trim() || `bank-account-${input.commandId}`;
      if (existing?.outcome_status === "success") {
        return {
          commandId: input.commandId,
          bankAccountId,
          repeated: true,
          summary: "Bank account already saved.",
        };
      }
      if (existing?.outcome_status === "failed") {
        throw new Error(buildFailedCommandMessage("bank account", existing.error_message));
      }
      if (!input.accountLabel.trim()) throw new Error("Account label is required.");
      ensureCreditCardDays(input);
      validatePaymentInstrumentOwner(input);

      const now = new Date().toISOString();
      const last4 = extractLast4(input.accountNumberMasked) ?? extractLast4(input.accountNumberFull);
      const maskedNumber = input.accountNumberMasked?.trim() || (last4 ? `****${last4}` : null);
      const owner = input.owner ?? "company";
      const instrumentKind = input.instrumentKind ?? "bank_account";
      db.exec("BEGIN");
      try {
        const priorAccount = db.prepare(`SELECT * FROM bank_accounts WHERE id = ?`).get(bankAccountId) ?? null;
        if (priorAccount) {
          recordUndo(
            db,
            input.workspaceId,
            input.commandId,
            "account",
            input.accountLabel.trim(),
            { accountId: bankAccountId, prior: priorAccount },
            now,
          );
        }

        db.prepare(
          `INSERT INTO bank_accounts (
             id, workspace_id, bank_name, account_label, account_number_masked,
             account_number_full, currency, account_type, opening_balance,
             opening_balance_date, is_active, notes, owner, owner_user_id,
             owner_user_name_snapshot, instrument_kind, last4, issuer,
             statement_cycle_day, payment_due_day, reminder_user_id,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             bank_name = excluded.bank_name,
             account_label = excluded.account_label,
             account_number_masked = excluded.account_number_masked,
             account_number_full = excluded.account_number_full,
             currency = excluded.currency,
             account_type = excluded.account_type,
             opening_balance = excluded.opening_balance,
             opening_balance_date = excluded.opening_balance_date,
             is_active = excluded.is_active,
             notes = excluded.notes,
             owner = excluded.owner,
             owner_user_id = excluded.owner_user_id,
             owner_user_name_snapshot = excluded.owner_user_name_snapshot,
             instrument_kind = excluded.instrument_kind,
             last4 = excluded.last4,
             issuer = excluded.issuer,
             statement_cycle_day = excluded.statement_cycle_day,
             payment_due_day = excluded.payment_due_day,
             reminder_user_id = excluded.reminder_user_id,
             updated_at = excluded.updated_at`,
        ).run(
          bankAccountId,
          input.workspaceId,
          input.bankName,
          input.accountLabel.trim(),
          maskedNumber,
          null,
          normalizeCurrency(input.currency),
          input.accountType ?? null,
          input.openingBalance != null ? round2(input.openingBalance) : 0,
          input.openingBalanceDate?.trim() || null,
          input.isActive === false ? 0 : 1,
          input.notes?.trim() || null,
          owner,
          input.ownerUserId?.trim() || null,
          input.ownerUserNameSnapshot?.trim() || null,
          instrumentKind,
          last4,
          input.issuer?.trim() || null,
          input.statementCycleDay ?? null,
          input.paymentDueDay ?? null,
          input.reminderUserId?.trim() || null,
          now,
          now,
        );

        enqueueOutbox(
          db,
          input.workspaceId,
          "bank_account",
          bankAccountId,
          {
            bankName: input.bankName,
            accountLabel: input.accountLabel,
            currency: input.currency,
            accountNumberMasked: input.accountNumberMasked ?? null,
          },
          `sync-${input.commandId}`,
          now,
        );
        recordReceipt(input, now, "success", null);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        recordReceipt(
          input,
          now,
          "failed",
          error instanceof Error ? error.message : "Bank account save failed.",
        );
        throw error;
      }

      return {
        commandId: input.commandId,
        bankAccountId,
        repeated: false,
        summary: `Bank account "${input.accountLabel.trim()}" saved.`,
      };
    },

    importStatement(input: ImportStatementCommand): ImportStatementResult {
      return importTransactions(input);
    },

    addManualTransactions(input: AddManualTransactionsCommand): ImportStatementResult {
      return importTransactions({ ...input, sourceFormat: "manual" });
    },

    deleteImport(input: DeleteImportCommand): TransactionMutationResult {
      const existing = receiptHelpers.getExistingReceipt(input.commandId);
      if (existing?.outcome_status === "success") {
        return {
          commandId: input.commandId,
          transactionId: input.importId,
          repeated: true,
          summary: "Import already deleted.",
        };
      }
      if (existing?.outcome_status === "failed") {
        throw new Error(buildFailedCommandMessage("import delete", existing.error_message));
      }

      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        const found = db
          .prepare(`SELECT * FROM bank_statement_imports WHERE id = ? AND workspace_id = ?`)
          .get(input.importId, input.workspaceId) as Record<string, unknown> | undefined;
        if (!found) throw new Error("Import batch not found.");

        // Snapshot the whole batch (import + its rows + the human layer + links)
        // BEFORE the hard delete so undo can re-insert it verbatim and re-push.
        const snapshotTxns = db
          .prepare(`SELECT * FROM bank_transactions WHERE workspace_id = ? AND import_id = ?`)
          .all(input.workspaceId, input.importId) as Array<Record<string, unknown>>;
        const snapshotTxnIds = snapshotTxns.map((t) => t.id as string);
        const idList = snapshotTxnIds.length
          ? snapshotTxnIds.map(() => "?").join(", ")
          : "''";
        const snapshotAnnotations = snapshotTxnIds.length
          ? (db
              .prepare(`SELECT * FROM transaction_annotations WHERE transaction_id IN (${idList})`)
              .all(...snapshotTxnIds) as Array<Record<string, unknown>>)
          : [];
        const snapshotAllocations = snapshotTxnIds.length
          ? (db
              .prepare(`SELECT * FROM transaction_project_allocations WHERE transaction_id IN (${idList})`)
              .all(...snapshotTxnIds) as Array<Record<string, unknown>>)
          : [];
        const snapshotLinks = snapshotTxnIds.length
          ? (db
              .prepare(`SELECT * FROM transaction_links WHERE transaction_id IN (${idList})`)
              .all(...snapshotTxnIds) as Array<Record<string, unknown>>)
          : [];
        recordUndo(
          db,
          input.workspaceId,
          input.commandId,
          "import_delete",
          (found.original_filename as string | null) || (found.source_format as string) || input.importId,
          {
            import: found,
            transactions: snapshotTxns,
            annotations: snapshotAnnotations,
            allocations: snapshotAllocations,
            links: snapshotLinks,
          },
          now,
        );

        // Remove the imported rows first (their annotations/allocations cascade),
        // then the batch — so a re-import of the same statement is clean.
        db.prepare(`DELETE FROM bank_transactions WHERE workspace_id = ? AND import_id = ?`).run(
          input.workspaceId,
          input.importId,
        );
        db.prepare(`DELETE FROM bank_statement_imports WHERE id = ? AND workspace_id = ?`).run(
          input.importId,
          input.workspaceId,
        );
        enqueueOutbox(
          db,
          input.workspaceId,
          "bank_statement_import",
          input.importId,
          { deleted: true },
          `sync-${input.commandId}`,
          now,
          "delete",
        );
        recordReceipt(input, now, "success", null);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        recordReceipt(
          input,
          now,
          "failed",
          error instanceof Error ? error.message : "Import delete failed.",
        );
        throw error;
      }
      return {
        commandId: input.commandId,
        transactionId: input.importId,
        repeated: false,
        summary: "Import batch removed.",
      };
    },

    correctTransaction(input: CorrectTransactionCommand): TransactionMutationResult {
      const existing = receiptHelpers.getExistingReceipt(input.commandId);
      if (existing?.outcome_status === "success") {
        return {
          commandId: input.commandId,
          transactionId: input.transactionId,
          repeated: true,
          summary: "Transaction correction already applied.",
        };
      }
      if (existing?.outcome_status === "failed") {
        throw new Error(buildFailedCommandMessage("transaction correction", existing.error_message));
      }

      const current = db
        .prepare(`SELECT * FROM bank_transactions WHERE id = ? AND workspace_id = ? LIMIT 1`)
        .get(input.transactionId, input.workspaceId) as Record<string, unknown> | undefined;
      if (!current) throw new Error("Transaction not found for this workspace.");

      const next = {
        txnDate: input.txnDate?.trim() || (current.txn_date as string),
        valueDate: input.valueDate === undefined ? (current.value_date as string | null) : input.valueDate?.trim() || null,
        rawDescription:
          input.rawDescription === undefined ? (current.raw_description as string | null) : input.rawDescription?.trim() || null,
        reference: input.reference === undefined ? (current.reference as string | null) : input.reference?.trim() || null,
        serial: input.serial === undefined ? (current.serial as string | null) : input.serial?.trim() || null,
        amount: input.amount === undefined ? Number(current.amount ?? 0) : round2(input.amount),
        direction: input.direction ?? (current.direction as string),
        runningBalance:
          input.runningBalance === undefined
            ? current.running_balance == null
              ? null
              : Number(current.running_balance)
            : input.runningBalance == null
              ? null
              : round2(input.runningBalance),
      };
      if (next.amount < 0) throw new Error("Transaction amount cannot be negative.");
      if (next.direction !== "credit" && next.direction !== "debit") {
        throw new Error("Transaction direction must be debit or credit.");
      }

      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        recordUndo(
          db,
          input.workspaceId,
          input.commandId,
          "transaction_correction",
          (current.raw_description as string | null) ?? input.transactionId,
          { transactionId: input.transactionId, prior: current },
          now,
        );

        db.prepare(
          `UPDATE bank_transactions
           SET txn_date = ?, value_date = ?, raw_description = ?, reference = ?, serial = ?,
               amount = ?, direction = ?, running_balance = ?
           WHERE id = ? AND workspace_id = ?`,
        ).run(
          next.txnDate,
          next.valueDate,
          next.rawDescription,
          next.reference,
          next.serial,
          next.amount,
          next.direction,
          next.runningBalance,
          input.transactionId,
          input.workspaceId,
        );
        enqueueOutbox(
          db,
          input.workspaceId,
          "bank_transaction",
          input.transactionId,
          {
            correction: next,
            notes: input.notes?.trim() || null,
          },
          `sync-${input.commandId}`,
          now,
        );
        recordReceipt(input, now, "success", null);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        recordReceipt(
          input,
          now,
          "failed",
          error instanceof Error ? error.message : "Transaction correction failed.",
        );
        throw error;
      }

      return {
        commandId: input.commandId,
        transactionId: input.transactionId,
        repeated: false,
        summary: "Transaction corrected.",
      };
    },

    annotateTransaction(input: AnnotateTransactionCommand): TransactionMutationResult {
      const existing = receiptHelpers.getExistingReceipt(input.commandId);
      if (existing?.outcome_status === "success") {
        return {
          commandId: input.commandId,
          transactionId: input.transactionId,
          repeated: true,
          summary: "Transaction already classified.",
        };
      }
      if (existing?.outcome_status === "failed") {
        throw new Error(buildFailedCommandMessage("transaction classify", existing.error_message));
      }

      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        const txn = db
          .prepare(`SELECT id FROM bank_transactions WHERE id = ? AND workspace_id = ? LIMIT 1`)
          .get(input.transactionId, input.workspaceId);
        if (!txn) throw new Error("Transaction not found.");

        const priorAnnotation =
          db.prepare(`SELECT * FROM transaction_annotations WHERE transaction_id = ?`).get(input.transactionId) ?? null;
        recordUndo(
          db,
          input.workspaceId,
          input.commandId,
          "annotation",
          input.concept?.trim() || input.txnKind || input.transactionId,
          { transactionId: input.transactionId, prior: priorAnnotation },
          now,
        );

        db.prepare(
          `INSERT INTO transaction_annotations (
             transaction_id, workspace_id, txn_kind, concept, counterparty,
             counterparty_rnc, expense_category, is_internal_transfer,
             supplier_ncf, dgii_expense_type, withholding_type,
             withholding_rate, withholding_amount, fiscal_period,
             reimbursement_status, claimed_amount, support_doc_file_id, notes,
             classified_by_user_id, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'n/a'), ?, ?, ?, ?, ?)
           ON CONFLICT(transaction_id) DO UPDATE SET
             txn_kind = excluded.txn_kind,
             concept = excluded.concept,
             counterparty = excluded.counterparty,
             counterparty_rnc = excluded.counterparty_rnc,
             expense_category = excluded.expense_category,
             supplier_ncf = excluded.supplier_ncf,
             dgii_expense_type = excluded.dgii_expense_type,
             withholding_type = excluded.withholding_type,
             withholding_rate = excluded.withholding_rate,
             withholding_amount = excluded.withholding_amount,
             fiscal_period = excluded.fiscal_period,
             is_internal_transfer = excluded.is_internal_transfer,
             reimbursement_status = excluded.reimbursement_status,
             claimed_amount = excluded.claimed_amount,
             support_doc_file_id = excluded.support_doc_file_id,
             notes = excluded.notes,
             classified_by_user_id = excluded.classified_by_user_id,
             updated_at = excluded.updated_at`,
        ).run(
          input.transactionId,
          input.workspaceId,
          input.txnKind ?? null,
          input.concept?.trim() || null,
          input.counterparty?.trim() || null,
          input.counterpartyRnc?.trim() || null,
          input.expenseCategory?.trim() || null,
          input.isInternalTransfer ? 1 : 0,
          input.supplierNcf?.trim() || null,
          input.dgiiExpenseType?.trim() || null,
          input.withholdingType?.trim() || null,
          input.withholdingRate != null ? round2(input.withholdingRate) : null,
          input.withholdingAmount != null ? round2(input.withholdingAmount) : null,
          input.fiscalPeriod?.trim() || null,
          input.reimbursementStatus ?? null,
          input.claimedAmount != null ? round2(input.claimedAmount) : null,
          input.supportDocFileId?.trim() || null,
          input.notes?.trim() || null,
          defaultActorUserId,
          now,
        );

        enqueueOutbox(
          db,
          input.workspaceId,
          "transaction_annotation",
          input.transactionId,
          { txnKind: input.txnKind ?? null, concept: input.concept ?? null },
          `sync-${input.commandId}`,
          now,
        );
        recordReceipt(input, now, "success", null);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        recordReceipt(
          input,
          now,
          "failed",
          error instanceof Error ? error.message : "Classify failed.",
        );
        throw error;
      }
      return {
        commandId: input.commandId,
        transactionId: input.transactionId,
        repeated: false,
        summary: "Transaction classified.",
      };
    },

    applyCounterpartyRule(input: ApplyCounterpartyRuleCommand): ApplyCounterpartyRuleResult {
      const existing = receiptHelpers.getExistingReceipt(input.commandId);
      if (existing?.outcome_status === "success") {
        const selected = db
          .prepare(`SELECT raw_description FROM bank_transactions WHERE id = ? AND workspace_id = ? LIMIT 1`)
          .get(input.transactionId, input.workspaceId) as { raw_description: string | null } | undefined;
        const matchPattern = input.matchPattern?.trim() || selected?.raw_description?.trim() || "";
        return {
          commandId: input.commandId,
          transactionId: input.transactionId,
          ruleId: ruleIdFor(input.workspaceId, input.matchType ?? "exact", matchPattern),
          matchPattern,
          affectedCount: 0,
          repeated: true,
          summary: "Classification rule already applied.",
        };
      }
      if (existing?.outcome_status === "failed") {
        throw new Error(buildFailedCommandMessage("classification rule", existing.error_message));
      }

      const now = new Date().toISOString();
      const matchType = input.matchType ?? "exact";
      db.exec("BEGIN");
      try {
        const selected = db
          .prepare(`SELECT raw_description FROM bank_transactions WHERE id = ? AND workspace_id = ? LIMIT 1`)
          .get(input.transactionId, input.workspaceId) as { raw_description: string | null } | undefined;
        if (!selected) throw new Error("Transaction not found.");

        const matchPattern = (input.matchPattern?.trim() || selected.raw_description?.trim() || "").replace(/\s+/g, " ");
        if (!matchPattern) throw new Error("This transaction has no description to remember.");

        const ruleId = ruleIdFor(input.workspaceId, matchType, matchPattern);
        db.prepare(
          `INSERT INTO counterparty_rules (
             id, workspace_id, match_pattern, match_type, default_kind,
             default_category, default_counterparty, priority, is_active,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             default_kind = excluded.default_kind,
             default_category = excluded.default_category,
             default_counterparty = excluded.default_counterparty,
             is_active = 1,
             updated_at = excluded.updated_at`,
        ).run(
          ruleId,
          input.workspaceId,
          matchPattern,
          matchType,
          input.txnKind ?? null,
          input.expenseCategory?.trim() || null,
          input.counterparty?.trim() || null,
          now,
          now,
        );

        const where =
          matchType === "contains"
            ? "UPPER(t.raw_description) LIKE ?"
            : "UPPER(TRIM(t.raw_description)) = ?";
        const param =
          matchType === "contains"
            ? `%${normalizeRuleText(matchPattern)}%`
            : normalizeRuleText(matchPattern);
        const matches = db
          .prepare(
            `SELECT t.id
             FROM bank_transactions t
             LEFT JOIN transaction_annotations a ON a.transaction_id = t.id
             WHERE t.workspace_id = ?
               AND t.raw_description IS NOT NULL
               AND ${where}
               AND (a.transaction_id IS NULL OR a.txn_kind IS NULL)`,
          )
          .all(input.workspaceId, param) as Array<{ id: string }>;

        if (matches.length > 0) {
          const priorBulk = matches.map((match) => ({
            transactionId: match.id,
            prior: db.prepare(`SELECT * FROM transaction_annotations WHERE transaction_id = ?`).get(match.id) ?? null,
          }));
          recordUndo(
            db,
            input.workspaceId,
            input.commandId,
            "annotation_bulk",
            String(matches.length),
            { entries: priorBulk },
            now,
          );
        }

        const upsertAnnotation = db.prepare(
          `INSERT INTO transaction_annotations (
             transaction_id, workspace_id, txn_kind, concept, counterparty,
             counterparty_rnc, expense_category, is_internal_transfer,
             supplier_ncf, dgii_expense_type, withholding_type,
             withholding_rate, withholding_amount, fiscal_period,
             reimbursement_status, claimed_amount, support_doc_file_id, notes,
             classified_by_user_id, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'n/a'), ?, ?, ?, ?, ?)
           ON CONFLICT(transaction_id) DO UPDATE SET
             txn_kind = excluded.txn_kind,
             concept = excluded.concept,
             counterparty = COALESCE(excluded.counterparty, transaction_annotations.counterparty),
             counterparty_rnc = COALESCE(excluded.counterparty_rnc, transaction_annotations.counterparty_rnc),
             expense_category = COALESCE(excluded.expense_category, transaction_annotations.expense_category),
             supplier_ncf = COALESCE(excluded.supplier_ncf, transaction_annotations.supplier_ncf),
             dgii_expense_type = COALESCE(excluded.dgii_expense_type, transaction_annotations.dgii_expense_type),
             withholding_type = COALESCE(excluded.withholding_type, transaction_annotations.withholding_type),
             withholding_rate = COALESCE(excluded.withholding_rate, transaction_annotations.withholding_rate),
             withholding_amount = COALESCE(excluded.withholding_amount, transaction_annotations.withholding_amount),
             fiscal_period = COALESCE(excluded.fiscal_period, transaction_annotations.fiscal_period),
             is_internal_transfer = excluded.is_internal_transfer,
             reimbursement_status = excluded.reimbursement_status,
             claimed_amount = COALESCE(excluded.claimed_amount, transaction_annotations.claimed_amount),
             support_doc_file_id = COALESCE(excluded.support_doc_file_id, transaction_annotations.support_doc_file_id),
             notes = COALESCE(excluded.notes, transaction_annotations.notes),
             classified_by_user_id = excluded.classified_by_user_id,
             updated_at = excluded.updated_at
           WHERE transaction_annotations.txn_kind IS NULL`,
        );

        for (const match of matches) {
          upsertAnnotation.run(
            match.id,
            input.workspaceId,
            input.txnKind ?? null,
            input.concept?.trim() || null,
            input.counterparty?.trim() || null,
            input.counterpartyRnc?.trim() || null,
            input.expenseCategory?.trim() || null,
            input.isInternalTransfer ? 1 : 0,
            input.supplierNcf?.trim() || null,
            input.dgiiExpenseType?.trim() || null,
            input.withholdingType?.trim() || null,
            input.withholdingRate != null ? round2(input.withholdingRate) : null,
            input.withholdingAmount != null ? round2(input.withholdingAmount) : null,
            input.fiscalPeriod?.trim() || null,
            input.reimbursementStatus ?? null,
            input.claimedAmount != null ? round2(input.claimedAmount) : null,
            input.supportDocFileId?.trim() || null,
            input.notes?.trim() || null,
            defaultActorUserId,
            now,
          );
        }

        enqueueOutbox(
          db,
          input.workspaceId,
          "counterparty_rule",
          ruleId,
          {
            matchPattern,
            matchType,
            txnKind: input.txnKind ?? null,
            expenseCategory: input.expenseCategory ?? null,
            affectedCount: matches.length,
          },
          `sync-rule-${input.commandId}`,
          now,
        );
        for (const match of matches) {
          enqueueOutbox(
            db,
            input.workspaceId,
            "transaction_annotation",
            match.id,
            {
              source: "counterparty_rule",
              ruleId,
              txnKind: input.txnKind ?? null,
              expenseCategory: input.expenseCategory ?? null,
            },
            `sync-rule-annotation-${input.commandId}-${match.id}`,
            now,
          );
        }
        recordReceipt(input, now, "success", null);
        db.exec("COMMIT");
        return {
          commandId: input.commandId,
          transactionId: input.transactionId,
          ruleId,
          matchPattern,
          affectedCount: matches.length,
          repeated: false,
          summary: `Applied classification to ${matches.length} movement(s).`,
        };
      } catch (error) {
        db.exec("ROLLBACK");
        recordReceipt(
          input,
          now,
          "failed",
          error instanceof Error ? error.message : "Classification rule failed.",
        );
        throw error;
      }
    },

    setAllocations(input: SetAllocationsCommand): TransactionMutationResult {
      const existing = receiptHelpers.getExistingReceipt(input.commandId);
      if (existing?.outcome_status === "success") {
        return {
          commandId: input.commandId,
          transactionId: input.transactionId,
          repeated: true,
          summary: "Allocations already saved.",
        };
      }
      if (existing?.outcome_status === "failed") {
        throw new Error(buildFailedCommandMessage("allocations", existing.error_message));
      }

      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        const txn = db
          .prepare(`SELECT amount FROM bank_transactions WHERE id = ? AND workspace_id = ? LIMIT 1`)
          .get(input.transactionId, input.workspaceId) as { amount: number } | undefined;
        if (!txn) throw new Error("Transaction not found.");

        const allocationTotal = round2(
          input.allocations.reduce((sum, alloc) => sum + (alloc.amount || 0), 0),
        );
        if (allocationTotal - round2(txn.amount) > 0.005) {
          throw new Error("Allocation total cannot exceed the transaction amount.");
        }

        const priorAllocations = db
          .prepare(`SELECT * FROM transaction_project_allocations WHERE transaction_id = ?`)
          .all(input.transactionId);
        recordUndo(
          db,
          input.workspaceId,
          input.commandId,
          "allocations",
          input.transactionId,
          { transactionId: input.transactionId, prior: priorAllocations },
          now,
        );

        db.prepare(`DELETE FROM transaction_project_allocations WHERE transaction_id = ?`).run(
          input.transactionId,
        );

        const insertAlloc = db.prepare(
          `INSERT INTO transaction_project_allocations (
             id, workspace_id, transaction_id, project_id, project_name_snapshot,
             amount, percent, notes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        input.allocations.forEach((alloc, index) => {
          insertAlloc.run(
            `alloc-${input.commandId}-${index}`,
            input.workspaceId,
            input.transactionId,
            alloc.projectId?.trim() || null,
            alloc.projectNameSnapshot?.trim() || null,
            round2(alloc.amount),
            alloc.percent != null ? alloc.percent : null,
            alloc.notes?.trim() || null,
            now,
            now,
          );
        });

        enqueueOutbox(
          db,
          input.workspaceId,
          "transaction_allocations",
          input.transactionId,
          { count: input.allocations.length, total: allocationTotal },
          `sync-${input.commandId}`,
          now,
        );
        recordReceipt(input, now, "success", null);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        recordReceipt(
          input,
          now,
          "failed",
          error instanceof Error ? error.message : "Allocations save failed.",
        );
        throw error;
      }
      return {
        commandId: input.commandId,
        transactionId: input.transactionId,
        repeated: false,
        summary: "Project allocations saved.",
      };
    },

    reviewReimbursement(input: ReviewReimbursementCommand): TransactionMutationResult {
      const existing = receiptHelpers.getExistingReceipt(input.commandId);
      if (existing?.outcome_status === "success") {
        return {
          commandId: input.commandId,
          transactionId: input.transactionId,
          repeated: true,
          summary: "Review already applied.",
        };
      }
      if (existing?.outcome_status === "failed") {
        throw new Error(buildFailedCommandMessage("reimbursement review", existing.error_message));
      }

      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        const txn = db
          .prepare(`SELECT id FROM bank_transactions WHERE id = ? AND workspace_id = ? LIMIT 1`)
          .get(input.transactionId, input.workspaceId);
        if (!txn) throw new Error("Transaction not found.");

        const priorReviewAnnotation =
          db.prepare(`SELECT * FROM transaction_annotations WHERE transaction_id = ?`).get(input.transactionId) ?? null;
        recordUndo(
          db,
          input.workspaceId,
          input.commandId,
          "annotation",
          input.transactionId,
          { transactionId: input.transactionId, prior: priorReviewAnnotation },
          now,
        );

        // Upsert so a review can be recorded even if the row was never
        // classified through the normal flow.
        db.prepare(
          `INSERT INTO transaction_annotations (
             transaction_id, workspace_id, reimbursement_status, deductible_amount,
             supplier_ncf, dgii_expense_type, withholding_type, withholding_rate,
             withholding_amount, fiscal_period, fiscal_status, notes,
             reviewed_by_user_id, reviewed_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(transaction_id) DO UPDATE SET
             reimbursement_status = excluded.reimbursement_status,
             deductible_amount = excluded.deductible_amount,
             supplier_ncf = COALESCE(excluded.supplier_ncf, transaction_annotations.supplier_ncf),
             dgii_expense_type = COALESCE(excluded.dgii_expense_type, transaction_annotations.dgii_expense_type),
             withholding_type = COALESCE(excluded.withholding_type, transaction_annotations.withholding_type),
             withholding_rate = COALESCE(excluded.withholding_rate, transaction_annotations.withholding_rate),
             withholding_amount = COALESCE(excluded.withholding_amount, transaction_annotations.withholding_amount),
             fiscal_period = COALESCE(excluded.fiscal_period, transaction_annotations.fiscal_period),
             fiscal_status = excluded.fiscal_status,
             notes = COALESCE(excluded.notes, transaction_annotations.notes),
             reviewed_by_user_id = excluded.reviewed_by_user_id,
             reviewed_at = excluded.reviewed_at,
             updated_at = excluded.updated_at`,
        ).run(
          input.transactionId,
          input.workspaceId,
          input.reimbursementStatus,
          input.deductibleAmount != null ? round2(input.deductibleAmount) : null,
          input.supplierNcf?.trim() || null,
          input.dgiiExpenseType?.trim() || null,
          input.withholdingType?.trim() || null,
          input.withholdingRate != null ? round2(input.withholdingRate) : null,
          input.withholdingAmount != null ? round2(input.withholdingAmount) : null,
          input.fiscalPeriod?.trim() || null,
          input.fiscalStatus,
          input.notes?.trim() || null,
          defaultActorUserId,
          now,
          now,
        );

        enqueueOutbox(
          db,
          input.workspaceId,
          "transaction_annotation",
          input.transactionId,
          {
            reimbursementStatus: input.reimbursementStatus,
            deductibleAmount: input.deductibleAmount ?? null,
            supplierNcf: input.supplierNcf?.trim() || null,
            dgiiExpenseType: input.dgiiExpenseType?.trim() || null,
            withholdingType: input.withholdingType?.trim() || null,
            withholdingRate: input.withholdingRate ?? null,
            withholdingAmount: input.withholdingAmount ?? null,
            fiscalPeriod: input.fiscalPeriod?.trim() || null,
            fiscalStatus: input.fiscalStatus,
          },
          `sync-${input.commandId}`,
          now,
        );
        recordReceipt(input, now, "success", null);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        recordReceipt(
          input,
          now,
          "failed",
          error instanceof Error ? error.message : "Review failed.",
        );
        throw error;
      }
      return {
        commandId: input.commandId,
        transactionId: input.transactionId,
        repeated: false,
        summary: "Reimbursement reviewed.",
      };
    },

    linkTransaction(input: LinkTransactionCommand): TransactionMutationResult {
      const existing = receiptHelpers.getExistingReceipt(input.commandId);
      if (existing?.outcome_status === "success") {
        return {
          commandId: input.commandId,
          transactionId: input.transactionId,
          repeated: true,
          summary: "Link already created.",
        };
      }
      if (existing?.outcome_status === "failed") {
        throw new Error(buildFailedCommandMessage("transaction link", existing.error_message));
      }

      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        db.prepare(
          `INSERT INTO transaction_links (
             id, workspace_id, transaction_id, linked_entity_type, linked_entity_id, allocation_status, notes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'matched', ?, ?, ?)
           ON CONFLICT DO NOTHING`,
        ).run(
          `link-${input.commandId}`,
          input.workspaceId,
          input.transactionId,
          input.linkedEntityType,
          input.linkedEntityId,
          input.notes?.trim() || null,
          now,
          now,
        );
        enqueueOutbox(
          db,
          input.workspaceId,
          "transaction_link",
          `link-${input.commandId}`,
          { linkedEntityType: input.linkedEntityType, linkedEntityId: input.linkedEntityId },
          `sync-${input.commandId}`,
          now,
        );
        recordReceipt(input, now, "success", null);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        recordReceipt(
          input,
          now,
          "failed",
          error instanceof Error ? error.message : "Link failed.",
        );
        throw error;
      }
      return {
        commandId: input.commandId,
        transactionId: input.transactionId,
        repeated: false,
        summary: "Transaction linked.",
      };
    },

    deactivatePaymentInstrument(input: DeactivatePaymentInstrumentCommand): BankAccountMutationResult {
      const existing = receiptHelpers.getExistingReceipt(input.commandId);
      if (existing?.outcome_status === "success") {
        return {
          commandId: input.commandId,
          bankAccountId: input.paymentInstrumentId,
          repeated: true,
          summary: "Payment instrument already deactivated.",
        };
      }
      if (existing?.outcome_status === "failed") {
        throw new Error(buildFailedCommandMessage("payment instrument deactivate", existing.error_message));
      }

      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        const priorAccount = db
          .prepare(`SELECT * FROM bank_accounts WHERE workspace_id = ? AND id = ? LIMIT 1`)
          .get(input.workspaceId, input.paymentInstrumentId) as Record<string, unknown> | undefined;
        if (!priorAccount) throw new Error("Payment instrument not found for this workspace.");
        recordUndo(
          db,
          input.workspaceId,
          input.commandId,
          "account",
          String(priorAccount.account_label ?? input.paymentInstrumentId),
          { accountId: input.paymentInstrumentId, prior: priorAccount },
          now,
        );
        db.prepare(`UPDATE bank_accounts SET is_active = 0, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`).run(
          input.notes?.trim() || null,
          now,
          input.paymentInstrumentId,
        );
        enqueueOutbox(
          db,
          input.workspaceId,
          "bank_account",
          input.paymentInstrumentId,
          { paymentInstrumentId: input.paymentInstrumentId, deactivated: true },
          `sync-${input.commandId}`,
          now,
        );
        recordReceipt(input, now, "success", null);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        recordReceipt(input, now, "failed", error instanceof Error ? error.message : "Deactivate failed.");
        throw error;
      }
      return {
        commandId: input.commandId,
        bankAccountId: input.paymentInstrumentId,
        repeated: false,
        summary: "Payment instrument deactivated.",
      };
    },

    assignInvoiceAllocation(input: AssignInvoiceAllocationCommand): InvoiceAllocationMutationResult {
      const allocationId = `txn-link-${input.commandId}`;
      const existing = receiptHelpers.getExistingReceipt(input.commandId);
      if (existing?.outcome_status === "success") {
        return {
          commandId: input.commandId,
          allocationId,
          transactionId: null,
          repeated: true,
          summary: "Invoice allocation already assigned.",
        };
      }
      if (existing?.outcome_status === "failed") {
        throw new Error(buildFailedCommandMessage("invoice allocation assign", existing.error_message));
      }

      const now = new Date().toISOString();
      const amountCurrency = normalizeCurrency(input.amountCurrency);
      const instrument = loadPaymentInstrument(db, input.workspaceId, input.paymentInstrumentId);
      if (!instrument.is_active) throw new Error("Cannot assign invoices to an inactive payment instrument.");
      if (normalizeCurrency(instrument.currency) !== amountCurrency && !input.fxRate) {
        throw new Error("Multicurrency invoice allocations require an FX rate.");
      }
      ensureAllocationTotalWithinEntity(db, { ...input, amountCurrency });

      db.exec("BEGIN");
      try {
        db.prepare(
          `INSERT INTO transaction_links (
             id, workspace_id, transaction_id, payment_instrument_id,
             linked_entity_type, linked_entity_id, amount_applied, amount_currency,
             fx_rate, allocation_status, cycle_start, cycle_end, notes, created_at, updated_at
           ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`,
        ).run(
          allocationId,
          input.workspaceId,
          input.paymentInstrumentId,
          input.linkedEntityType,
          input.linkedEntityId,
          round2(input.amountApplied),
          amountCurrency,
          input.fxRate ?? null,
          input.cycleStart?.trim() || null,
          input.cycleEnd?.trim() || null,
          input.notes?.trim() || null,
          now,
          now,
        );
        enqueueOutbox(
          db,
          input.workspaceId,
          "transaction_link",
          allocationId,
          { linkedEntityType: input.linkedEntityType, linkedEntityId: input.linkedEntityId },
          `sync-${input.commandId}`,
          now,
        );
        recordReceipt(input, now, "success", null);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        recordReceipt(input, now, "failed", error instanceof Error ? error.message : "Allocation assign failed.");
        throw error;
      }

      return {
        commandId: input.commandId,
        allocationId,
        transactionId: null,
        repeated: false,
        summary: "Invoice allocation assigned.",
      };
    },

    linkInvoiceAllocationToTransaction(input: LinkInvoiceAllocationToTransactionCommand): InvoiceAllocationMutationResult {
      const existing = receiptHelpers.getExistingReceipt(input.commandId);
      if (existing?.outcome_status === "success") {
        const allocation = loadAllocation(db, input.workspaceId, input.allocationId);
        return {
          commandId: input.commandId,
          allocationId: input.allocationId,
          transactionId: allocation.transaction_id,
          repeated: true,
          summary: "Invoice allocation already linked.",
        };
      }
      if (existing?.outcome_status === "failed") {
        throw new Error(buildFailedCommandMessage("invoice allocation link", existing.error_message));
      }

      const now = new Date().toISOString();
      const allocation = loadAllocation(db, input.workspaceId, input.allocationId);
      const transaction = loadBankTransaction(db, input.workspaceId, input.transactionId);
      const amountApplied = round2(input.amountApplied ?? allocation.amount_applied ?? transaction.amount);
      const amountCurrency = normalizeCurrency(allocation.amount_currency ?? transaction.currency);
      if (normalizeCurrency(transaction.currency) !== amountCurrency && !input.fxRate) {
        throw new Error("Multicurrency invoice allocation links require an FX rate.");
      }
      ensureAllocationTotalWithinEntity(db, {
        workspaceId: input.workspaceId,
        linkedEntityType: allocation.linked_entity_type,
        linkedEntityId: allocation.linked_entity_id,
        amountApplied,
        amountCurrency,
        excludeAllocationId: input.allocationId,
      });

      db.exec("BEGIN");
      try {
        db.prepare(
          `UPDATE transaction_links
           SET transaction_id = ?,
               amount_applied = ?,
               amount_currency = ?,
               fx_rate = COALESCE(?, fx_rate),
               allocation_status = ?,
               notes = COALESCE(?, notes),
               updated_at = ?
           WHERE workspace_id = ? AND id = ?`,
        ).run(
          input.transactionId,
          amountApplied,
          amountCurrency,
          input.fxRate ?? null,
          amountApplied < round2(transaction.amount) ? "partial" : "matched",
          input.notes?.trim() || null,
          now,
          input.workspaceId,
          input.allocationId,
        );
        enqueueOutbox(
          db,
          input.workspaceId,
          "transaction_link",
          input.allocationId,
          { transactionId: input.transactionId },
          `sync-${input.commandId}`,
          now,
        );
        recordReceipt(input, now, "success", null);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        recordReceipt(input, now, "failed", error instanceof Error ? error.message : "Allocation link failed.");
        throw error;
      }
      return {
        commandId: input.commandId,
        allocationId: input.allocationId,
        transactionId: input.transactionId,
        repeated: false,
        summary: "Invoice allocation linked to transaction.",
      };
    },

    unlinkInvoiceAllocation(input: UnlinkInvoiceAllocationCommand): InvoiceAllocationMutationResult {
      return updateInvoiceAllocationStatus(input, {
        status: "pending",
        transactionId: null,
        summary: "Invoice allocation unlinked.",
        failedLabel: "invoice allocation unlink",
      });
    },

    rejectInvoiceAllocation(input: RejectInvoiceAllocationCommand): InvoiceAllocationMutationResult {
      return updateInvoiceAllocationStatus(input, {
        status: "rejected",
        summary: "Invoice allocation rejected.",
        failedLabel: "invoice allocation reject",
      });
    },

    markInvoiceAllocationReimbursed(input: MarkInvoiceAllocationReimbursedCommand): InvoiceAllocationMutationResult {
      return updateInvoiceAllocationStatus(input, {
        status: "reimbursed",
        summary: "Invoice allocation marked reimbursed.",
        failedLabel: "invoice allocation reimbursed",
      });
    },

    createCardSettlement(input: CreateCardSettlementCommand): InvoiceAllocationMutationResult {
      const settlementId = `txn-link-settlement-${input.commandId}`;
      const existing = receiptHelpers.getExistingReceipt(input.commandId);
      if (existing?.outcome_status === "success") {
        return {
          commandId: input.commandId,
          allocationId: settlementId,
          transactionId: input.transactionId,
          repeated: true,
          summary: "Card settlement already created.",
        };
      }
      if (existing?.outcome_status === "failed") {
        throw new Error(buildFailedCommandMessage("card settlement", existing.error_message));
      }

      const now = new Date().toISOString();
      const instrument = loadPaymentInstrument(db, input.workspaceId, input.paymentInstrumentId);
      const transaction = loadBankTransaction(db, input.workspaceId, input.transactionId);
      db.exec("BEGIN");
      try {
        db.prepare(
          `INSERT INTO transaction_annotations (
             transaction_id, workspace_id, txn_kind, concept, counterparty,
             is_internal_transfer, reimbursement_status, fiscal_status, notes, updated_at
           ) VALUES (?, ?, 'transfer', 'Card settlement', 'Internal transfer', 1, 'n/a', 'pending', ?, ?)
           ON CONFLICT(transaction_id) DO UPDATE SET
             txn_kind = 'transfer',
             concept = COALESCE(transaction_annotations.concept, 'Card settlement'),
             counterparty = COALESCE(transaction_annotations.counterparty, 'Internal transfer'),
             is_internal_transfer = 1,
             notes = COALESCE(?, transaction_annotations.notes),
             updated_at = excluded.updated_at`,
        ).run(input.transactionId, input.workspaceId, input.notes?.trim() || null, now, input.notes?.trim() || null);
        db.prepare(
          `INSERT INTO transaction_links (
             id, workspace_id, transaction_id, payment_instrument_id,
             linked_entity_type, linked_entity_id, amount_applied, amount_currency,
             allocation_status, cycle_start, cycle_end, notes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'card_settlement', ?, ?, ?, 'matched', ?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`,
        ).run(
          settlementId,
          input.workspaceId,
          input.transactionId,
          input.paymentInstrumentId,
          input.paymentInstrumentId,
          round2(transaction.amount),
          normalizeCurrency(transaction.currency),
          input.cycleStart?.trim() || null,
          input.cycleEnd?.trim() || null,
          input.notes?.trim() || null,
          now,
          now,
        );
        if (input.closeAllocations) {
          db.prepare(
            `UPDATE transaction_links
             SET allocation_status = 'reimbursed', updated_at = ?
             WHERE workspace_id = ?
               AND payment_instrument_id = ?
               AND linked_entity_type <> 'card_settlement'
               AND allocation_status IN ('pending', 'matched', 'partial')
               AND (? IS NULL OR cycle_start >= ?)
               AND (? IS NULL OR cycle_end <= ?)`,
          ).run(
            now,
            input.workspaceId,
            input.paymentInstrumentId,
            input.cycleStart ?? null,
            input.cycleStart ?? null,
            input.cycleEnd ?? null,
            input.cycleEnd ?? null,
          );
        }
        enqueueOutbox(
          db,
          input.workspaceId,
          "transaction_annotation",
          input.transactionId,
          { cardSettlement: true },
          `sync-${input.commandId}-annotation`,
          now,
        );
        enqueueOutbox(
          db,
          input.workspaceId,
          "transaction_link",
          settlementId,
          { linkedEntityType: "card_settlement", paymentInstrumentId: instrument.id },
          `sync-${input.commandId}-link`,
          now,
        );
        recordReceipt(input, now, "success", null);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        recordReceipt(input, now, "failed", error instanceof Error ? error.message : "Card settlement failed.");
        throw error;
      }
      return {
        commandId: input.commandId,
        allocationId: settlementId,
        transactionId: input.transactionId,
        repeated: false,
        summary: "Card settlement created.",
      };
    },

    undoLastAction(input: UndoTreasuryActionCommand): TransactionMutationResult {
      const existing = receiptHelpers.getExistingReceipt(input.commandId);
      if (existing?.outcome_status === "success") {
        return {
          commandId: input.commandId,
          transactionId: input.undoId ?? "treasury-undo",
          repeated: true,
          summary: "Undo already applied.",
        };
      }
      if (existing?.outcome_status === "failed") {
        throw new Error(buildFailedCommandMessage("treasury undo", existing.error_message));
      }

      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        const undo = (input.undoId
          ? db
              .prepare(
                `SELECT * FROM treasury_undo_journal WHERE workspace_id = ? AND id = ? AND undone = 0 LIMIT 1`,
              )
              .get(input.workspaceId, input.undoId)
          : db
              .prepare(
                // rowid is the definitive LIFO key: created_at only has
                // millisecond resolution and the id suffix is random, so two
                // edits in the same millisecond would otherwise pop out of order.
                `SELECT * FROM treasury_undo_journal
                 WHERE workspace_id = ? AND undone = 0
                 ORDER BY rowid DESC
                 LIMIT 1`,
              )
              .get(input.workspaceId)) as
          | { id: string; kind: string; label: string; prior_state_json: string | null }
          | undefined;
        if (!undo) throw new Error("No treasury action is available to undo.");

        const state = parseUndoState(undo.prior_state_json);
        let transactionId = undo.id;

        if (undo.kind === "annotation") {
          transactionId = String(state.transactionId ?? undo.id);
          restoreAnnotation(db, input.workspaceId, transactionId, state.prior, now);
          enqueueOutbox(db, input.workspaceId, "transaction_annotation", transactionId, { undoId: undo.id }, `sync-${input.commandId}-annotation`, now);
        } else if (undo.kind === "annotation_bulk") {
          const entries = Array.isArray(state.entries) ? state.entries : [];
          for (const entry of entries) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
            const entryState = entry as Record<string, unknown>;
            const entryTransactionId = String(entryState.transactionId ?? "");
            if (!entryTransactionId) continue;
            restoreAnnotation(db, input.workspaceId, entryTransactionId, entryState.prior, now);
            enqueueOutbox(
              db,
              input.workspaceId,
              "transaction_annotation",
              entryTransactionId,
              { undoId: undo.id },
              `sync-${input.commandId}-annotation-${entryTransactionId}`,
              now,
            );
          }
          transactionId = entries.length ? String((entries[0] as Record<string, unknown>).transactionId ?? undo.id) : undo.id;
        } else if (undo.kind === "allocations") {
          transactionId = String(state.transactionId ?? undo.id);
          restoreAllocations(db, transactionId, state.prior);
          enqueueOutbox(db, input.workspaceId, "transaction_allocations", transactionId, { undoId: undo.id }, `sync-${input.commandId}-allocations`, now);
        } else if (undo.kind === "transaction_correction") {
          transactionId = String(state.transactionId ?? undo.id);
          if (!state.prior || typeof state.prior !== "object" || Array.isArray(state.prior)) {
            throw new Error("Undo snapshot is missing the transaction state.");
          }
          replaceRow(db, "bank_transactions", state.prior as Record<string, unknown>);
          enqueueOutbox(db, input.workspaceId, "bank_transaction", transactionId, { undoId: undo.id }, `sync-${input.commandId}-transaction`, now);
        } else if (undo.kind === "import_delete") {
          const importRow = state.import;
          if (!importRow || typeof importRow !== "object" || Array.isArray(importRow)) {
            throw new Error("Undo snapshot is missing the import state.");
          }
          replaceRow(db, "bank_statement_imports", importRow as Record<string, unknown>);
          const transactions = Array.isArray(state.transactions) ? state.transactions : [];
          const annotations = Array.isArray(state.annotations) ? state.annotations : [];
          const allocations = Array.isArray(state.allocations) ? state.allocations : [];
          const links = Array.isArray(state.links) ? state.links : [];
          for (const row of transactions) {
            if (row && typeof row === "object" && !Array.isArray(row)) replaceRow(db, "bank_transactions", row as Record<string, unknown>);
          }
          for (const row of annotations) {
            if (row && typeof row === "object" && !Array.isArray(row)) replaceRow(db, "transaction_annotations", row as Record<string, unknown>);
          }
          for (const row of allocations) {
            if (row && typeof row === "object" && !Array.isArray(row)) replaceRow(db, "transaction_project_allocations", row as Record<string, unknown>);
          }
          for (const row of links) {
            if (row && typeof row === "object" && !Array.isArray(row)) replaceRow(db, "transaction_links", row as Record<string, unknown>);
          }
          const importId = String((importRow as Record<string, unknown>).id ?? undo.id);
          transactionId = importId;
          enqueueOutbox(db, input.workspaceId, "bank_statement_import", importId, { undoId: undo.id }, `sync-${input.commandId}-import`, now);
          for (const row of annotations) {
            const restoredTransactionId = String((row as Record<string, unknown>).transaction_id ?? "");
            if (!restoredTransactionId) continue;
            enqueueOutbox(db, input.workspaceId, "transaction_annotation", restoredTransactionId, { undoId: undo.id }, `sync-${input.commandId}-annotation-${restoredTransactionId}`, now);
          }
          for (const row of allocations) {
            const restoredTransactionId = String((row as Record<string, unknown>).transaction_id ?? "");
            if (!restoredTransactionId) continue;
            enqueueOutbox(db, input.workspaceId, "transaction_allocations", restoredTransactionId, { undoId: undo.id }, `sync-${input.commandId}-allocations-${restoredTransactionId}`, now);
          }
          for (const row of links) {
            const restoredTransactionId = String((row as Record<string, unknown>).transaction_id ?? "");
            if (!restoredTransactionId) continue;
            enqueueOutbox(db, input.workspaceId, "transaction_link", restoredTransactionId, { undoId: undo.id }, `sync-${input.commandId}-link-${restoredTransactionId}`, now);
          }
        } else if (undo.kind === "account") {
          const accountId = String(state.accountId ?? undo.id);
          transactionId = accountId;
          if (state.prior && typeof state.prior === "object" && !Array.isArray(state.prior)) {
            replaceRow(db, "bank_accounts", state.prior as Record<string, unknown>);
          } else {
            throw new Error("Undo snapshot is missing the account state.");
          }
          enqueueOutbox(db, input.workspaceId, "bank_account", accountId, { undoId: undo.id }, `sync-${input.commandId}-account`, now);
        } else {
          throw new Error(`Unsupported treasury undo kind: ${undo.kind}.`);
        }

        db.prepare(`UPDATE treasury_undo_journal SET undone = 1, undone_at = ? WHERE id = ?`).run(now, undo.id);
        recordReceipt(input, now, "success", null);
        db.exec("COMMIT");
        return {
          commandId: input.commandId,
          transactionId,
          repeated: false,
          summary: `Undid ${undo.label}.`,
        };
      } catch (error) {
        db.exec("ROLLBACK");
        recordReceipt(input, now, "failed", error instanceof Error ? error.message : "Treasury undo failed.");
        throw error;
      }
    },
  };
};

export type TreasuryMutationService = ReturnType<typeof createTreasuryMutationService>;
