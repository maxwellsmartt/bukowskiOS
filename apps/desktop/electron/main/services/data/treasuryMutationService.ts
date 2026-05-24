import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  AddManualTransactionsCommand,
  AnnotateTransactionCommand,
  ApplyCounterpartyRuleCommand,
  ApplyCounterpartyRuleResult,
  BankAccountMutationResult,
  CorrectTransactionCommand,
  DeleteImportCommand,
  ImportStatementCommand,
  ImportStatementResult,
  LinkTransactionCommand,
  ParsedBankTransaction,
  ReviewReimbursementCommand,
  SetAllocationsCommand,
  TransactionKind,
  TransactionMutationResult,
  UpsertBankAccountCommand,
} from "@contracts";

const defaultActorUserId = "user-ops";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

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
        `SELECT account_number_full, account_number_masked, currency
         FROM bank_accounts WHERE workspace_id = ? AND id <> ?`,
      )
      .all(input.workspaceId, input.bankAccountId) as Array<{
      account_number_full: string | null;
      account_number_masked: string | null;
      currency: string;
    }>;
    const ownAccountNumbers = ownAccounts.flatMap((row) =>
      [row.account_number_full, row.account_number_masked]
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

      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        db.prepare(
          `INSERT INTO bank_accounts (
             id, workspace_id, bank_name, account_label, account_number_masked,
             account_number_full, currency, account_type, opening_balance,
             opening_balance_date, is_active, notes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
             updated_at = excluded.updated_at`,
        ).run(
          bankAccountId,
          input.workspaceId,
          input.bankName,
          input.accountLabel.trim(),
          input.accountNumberMasked?.trim() || null,
          input.accountNumberFull?.trim() || null,
          input.currency.trim().toUpperCase(),
          input.accountType ?? null,
          input.openingBalance != null ? round2(input.openingBalance) : 0,
          input.openingBalanceDate?.trim() || null,
          input.isActive === false ? 0 : 1,
          input.notes?.trim() || null,
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
          .prepare(`SELECT id FROM bank_statement_imports WHERE id = ? AND workspace_id = ?`)
          .get(input.importId, input.workspaceId);
        if (!found) throw new Error("Import batch not found.");
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

        db.prepare(
          `INSERT INTO transaction_annotations (
             transaction_id, workspace_id, txn_kind, concept, counterparty,
             counterparty_rnc, expense_category, is_internal_transfer,
             reimbursement_status, claimed_amount, support_doc_file_id, notes,
             classified_by_user_id, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'n/a'), ?, ?, ?, ?, ?)
           ON CONFLICT(transaction_id) DO UPDATE SET
             txn_kind = excluded.txn_kind,
             concept = excluded.concept,
             counterparty = excluded.counterparty,
             counterparty_rnc = excluded.counterparty_rnc,
             expense_category = excluded.expense_category,
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

        const upsertAnnotation = db.prepare(
          `INSERT INTO transaction_annotations (
             transaction_id, workspace_id, txn_kind, concept, counterparty,
             counterparty_rnc, expense_category, is_internal_transfer,
             reimbursement_status, claimed_amount, support_doc_file_id, notes,
             classified_by_user_id, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'n/a'), ?, ?, ?, ?, ?)
           ON CONFLICT(transaction_id) DO UPDATE SET
             txn_kind = excluded.txn_kind,
             concept = excluded.concept,
             counterparty = COALESCE(excluded.counterparty, transaction_annotations.counterparty),
             counterparty_rnc = COALESCE(excluded.counterparty_rnc, transaction_annotations.counterparty_rnc),
             expense_category = COALESCE(excluded.expense_category, transaction_annotations.expense_category),
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

        // Upsert so a review can be recorded even if the row was never
        // classified through the normal flow.
        db.prepare(
          `INSERT INTO transaction_annotations (
             transaction_id, workspace_id, reimbursement_status, deductible_amount,
             fiscal_status, notes, reviewed_by_user_id, reviewed_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(transaction_id) DO UPDATE SET
             reimbursement_status = excluded.reimbursement_status,
             deductible_amount = excluded.deductible_amount,
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
             id, workspace_id, transaction_id, linked_entity_type, linked_entity_id, notes, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(transaction_id, linked_entity_type, linked_entity_id) DO NOTHING`,
        ).run(
          `link-${input.commandId}`,
          input.workspaceId,
          input.transactionId,
          input.linkedEntityType,
          input.linkedEntityId,
          input.notes?.trim() || null,
          now,
        );
        enqueueOutbox(
          db,
          input.workspaceId,
          "transaction_link",
          input.transactionId,
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
  };
};

export type TreasuryMutationService = ReturnType<typeof createTreasuryMutationService>;
