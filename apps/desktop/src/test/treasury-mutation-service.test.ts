import { describe, expect, it } from "vitest";

import type { ParsedBankTransaction } from "@contracts";

import { createTreasuryMutationService } from "../../electron/main/services/data/treasuryMutationService";
import { createTreasuryReadService } from "../../electron/main/services/data/treasuryReadService";
import { buildDeductibleLedgerCsv, buildDeductibleLedgerXlsx } from "../../electron/main/services/data/treasuryDeductibleLedgerExportService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const workspaceId = "workspace-metadata";
const baseChannel = { actorType: "user" as const, sourceChannel: "desktop" as const };

const account = (commandId: string, overrides: Record<string, unknown> = {}) => ({
  commandId,
  workspaceId,
  ...baseChannel,
  bankName: "popular" as const,
  accountLabel: "Popular RD$",
  accountNumberFull: "788565075",
  currency: "DOP",
  openingBalance: 0,
  ...overrides,
});

const rows = (overrides: ParsedBankTransaction[] = []): ParsedBankTransaction[] =>
  overrides.length
    ? overrides
    : [
        {
          txnDate: "2025-10-10",
          rawDescription: "LANTICA PRODUCTION SERVICES RD$",
          amount: 350000,
          direction: "credit",
          runningBalance: 509416.06,
        },
        {
          txnDate: "2025-10-03",
          rawDescription: "VIA LBTR SETUP TECH EQUIP STE SRL",
          amount: 75000,
          direction: "debit",
          runningBalance: 179965.66,
        },
        {
          txnDate: "2025-10-03",
          rawDescription: "EXI COMISIONES LBTR LBTR NUM",
          amount: 100,
          direction: "debit",
          runningBalance: 179865.66,
        },
      ];

describe("treasury mutation service", () => {
  it("imports statement rows and dedupes on re-import", () => {
    const { cleanup, database } = createTestDatabase("treasury-import-dedupe");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);

    mutations.upsertBankAccount(account("cmd-acct-1"));

    const first = mutations.importStatement({
      commandId: "cmd-import-1",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-1",
      sourceFormat: "csv",
      rows: rows(),
    });
    expect(first.insertedCount).toBe(3);
    expect(first.duplicateCount).toBe(0);

    // Re-import the same rows under a NEW command id → all duplicates.
    const second = mutations.importStatement({
      commandId: "cmd-import-2",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-1",
      sourceFormat: "csv",
      rows: rows(),
    });
    expect(second.insertedCount).toBe(0);
    expect(second.duplicateCount).toBe(3);

    const txns = reads.listTransactions({ workspaceId });
    expect(txns).toHaveLength(3);
    cleanup();
  });

  it("does not create an unsafe undo entry for a newly created bank account", () => {
    const { cleanup, database } = createTestDatabase("treasury-account-create-no-undo");
    const mutations = createTreasuryMutationService(database);

    mutations.upsertBankAccount(account("cmd-acct-no-unsafe-undo"));

    const undoCount = database
      .prepare(`SELECT COUNT(*) AS count FROM treasury_undo_journal WHERE command_id = ?`)
      .get("cmd-acct-no-unsafe-undo") as { count: number };
    expect(undoCount.count).toBe(0);

    cleanup();
  });

  it("auto-detects internal transfers and excludes them from totals", () => {
    const { cleanup, database } = createTestDatabase("treasury-internal-transfer");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);

    // Two own accounts: DOP 788565075 and USD 819426362.
    mutations.upsertBankAccount(account("cmd-acct-dop"));
    mutations.upsertBankAccount(
      account("cmd-acct-usd", {
        accountLabel: "Popular US$",
        accountNumberFull: "819426362",
        currency: "USD",
      }),
    );

    // A credit into the USD account that references the DOP account number →
    // internal transfer (fx_exchange, currencies differ).
    mutations.importStatement({
      commandId: "cmd-import-usd",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-usd",
      sourceFormat: "csv",
      rows: [
        {
          txnDate: "2026-03-06",
          rawDescription: "Desde INTERNET 788565075 USD",
          amount: 33000,
          direction: "credit",
          runningBalance: 36655.46,
        },
        {
          txnDate: "2026-03-27",
          rawDescription: "LBTR FILM 055 S.R.L. USD",
          amount: 32175.88,
          direction: "credit",
          runningBalance: 35313.72,
        },
      ],
    });

    const overview = reads.getOverview({ workspaceId, period: "custom", customStartDate: "2026-01-01", customEndDate: "2026-12-31" });
    // Only the FILM 055 credit counts as real income; the internal transfer is excluded.
    expect(overview.totalIncome).toBe(32175.88);
    expect(overview.excludedTransferTotal).toBe(33000);

    const txns = reads.listTransactions({ workspaceId, bankAccountId: "bank-account-cmd-acct-usd" });
    const transfer = txns.find((t) => t.rawDescription?.includes("788565075"));
    expect(transfer?.excludedFromTotals).toBe(true);
    cleanup();
  });

  it("converts treasury overview totals into the requested reporting currency", () => {
    const { cleanup, database } = createTestDatabase("treasury-overview-currency");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);

    mutations.upsertBankAccount(account("cmd-acct-dop"));
    mutations.upsertBankAccount(account("cmd-acct-usd-report", {
      accountLabel: "Popular USD",
      accountNumberFull: "123456789",
      currency: "USD",
    }));
    database
      .prepare(
        `INSERT INTO exchange_rates (
          id, workspace_id, base_currency, quote_currency, rate, rate_type,
          source, source_label, effective_date, fetched_at, created_by_user_id,
          notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "rate-usd-dop-treasury",
        workspaceId,
        "USD",
        "DOP",
        60,
        "sell",
        "manual",
        "Manual",
        "2026-01-01",
        null,
        null,
        null,
        "2026-01-01T00:00:00.000Z",
      );

    mutations.importStatement({
      commandId: "cmd-import-dop-report",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-dop",
      sourceFormat: "csv",
      rows: [{ txnDate: "2026-01-03", rawDescription: "DOP expense", amount: 6000, direction: "debit" }],
    });
    mutations.importStatement({
      commandId: "cmd-import-usd-report",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-usd-report",
      sourceFormat: "csv",
      rows: [{ txnDate: "2026-01-04", rawDescription: "USD expense", amount: 100, direction: "debit" }],
    });

    const dop = reads.getOverview({
      workspaceId,
      period: "custom",
      customStartDate: "2026-01-01",
      customEndDate: "2026-01-31",
      reportCurrency: "DOP",
    });
    expect(dop.totalExpense).toBe(12000);
    expect(dop.reportCurrency).toBe("DOP");
    expect(dop.conversionMissingCount).toBe(0);

    const usd = reads.getOverview({
      workspaceId,
      period: "custom",
      customStartDate: "2026-01-01",
      customEndDate: "2026-01-31",
      reportCurrency: "USD",
    });
    expect(usd.totalExpense).toBe(200);
    expect(usd.reportCurrency).toBe("USD");
    expect(usd.conversionMissingCount).toBe(0);
    cleanup();
  });

  it("auto-classifies bank fees by description", () => {
    const { cleanup, database } = createTestDatabase("treasury-bank-fee");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);
    mutations.upsertBankAccount(account("cmd-acct-fee"));
    mutations.importStatement({
      commandId: "cmd-import-fee",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-fee",
      sourceFormat: "csv",
      rows: [
        { txnDate: "2025-10-03", rawDescription: "EXI COMISIONES LBTR", amount: 100, direction: "debit" },
        { txnDate: "2025-10-04", rawDescription: "PAGO IMPUESTO 0.15 DGII", amount: 374.49, direction: "debit" },
      ],
    });
    const txns = reads.listTransactions({ workspaceId });
    const fee = txns.find((t) => t.rawDescription?.includes("COMISIONES"));
    const tax = txns.find((t) => t.rawDescription?.includes("DGII"));
    expect(fee?.annotation?.txnKind).toBe("bank_fee");
    expect(tax?.annotation?.txnKind).toBe("tax");
    cleanup();
  });

  it("remembers an exact counterparty rule and applies it to matching unclassified movements", () => {
    const { cleanup, database } = createTestDatabase("treasury-counterparty-rules");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);
    mutations.upsertBankAccount(account("cmd-acct-rules"));
    mutations.importStatement({
      commandId: "cmd-import-rules",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-rules",
      sourceFormat: "csv",
      rows: [
        { txnDate: "2026-04-01", rawDescription: "PAGO RECURRENTE SUPLIDOR A", amount: 1000, direction: "debit" },
        { txnDate: "2026-04-02", rawDescription: "PAGO RECURRENTE SUPLIDOR A", amount: 1000, direction: "debit" },
        { txnDate: "2026-04-03", rawDescription: "PAGO RECURRENTE SUPLIDOR B", amount: 1000, direction: "debit" },
      ],
    });

    const target = reads
      .listTransactions({ workspaceId })
      .find((txn) => txn.rawDescription === "PAGO RECURRENTE SUPLIDOR A");
    expect(target).toBeTruthy();

    const preview = reads.previewClassificationRule({
      workspaceId,
      transactionId: target!.id,
      matchType: "exact",
    });
    expect(preview.matchCount).toBe(2);

    const result = mutations.applyCounterpartyRule({
      commandId: "cmd-apply-rule",
      workspaceId,
      ...baseChannel,
      transactionId: target!.id,
      txnKind: "expense",
      expenseCategory: "Servicios",
      matchType: "exact",
    });
    expect(result.affectedCount).toBe(2);

    const outboxRows = database
      .prepare(
        `SELECT entity_type, COUNT(*) AS count
         FROM sync_outbox
         WHERE id LIKE 'sync-rule%'
         GROUP BY entity_type
         ORDER BY entity_type`,
      )
      .all() as Array<{ entity_type: string; count: number }>;
    expect(outboxRows).toEqual([
      { entity_type: "counterparty_rule", count: 1 },
      { entity_type: "transaction_annotation", count: 2 },
    ]);

    const txns = reads.listTransactions({ workspaceId });
    const supplierA = txns.filter((txn) => txn.rawDescription === "PAGO RECURRENTE SUPLIDOR A");
    const supplierB = txns.find((txn) => txn.rawDescription === "PAGO RECURRENTE SUPLIDOR B");
    expect(supplierA.every((txn) => txn.annotation?.txnKind === "expense")).toBe(true);
    expect(supplierA.every((txn) => txn.annotation?.expenseCategory === "Servicios")).toBe(true);
    expect(supplierB?.annotation).toBeNull();
    cleanup();
  });

  it("applies remembered counterparty rules to future imports without overwriting heuristics", () => {
    const { cleanup, database } = createTestDatabase("treasury-counterparty-rules-import");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);
    mutations.upsertBankAccount(account("cmd-acct-rule-import"));
    mutations.importStatement({
      commandId: "cmd-import-rule-seed",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-rule-import",
      sourceFormat: "csv",
      rows: [
        { txnDate: "2026-04-01", rawDescription: "PAGO RECURRENTE SUPLIDOR C", amount: 1000, direction: "debit" },
      ],
    });
    const [seed] = reads.listTransactions({ workspaceId });
    mutations.applyCounterpartyRule({
      commandId: "cmd-apply-rule-import",
      workspaceId,
      ...baseChannel,
      transactionId: seed.id,
      txnKind: "expense",
      expenseCategory: "Servicios",
      matchType: "exact",
    });

    mutations.importStatement({
      commandId: "cmd-import-rule-future",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-rule-import",
      sourceFormat: "csv",
      rows: [
        { txnDate: "2026-05-01", rawDescription: "PAGO RECURRENTE SUPLIDOR C", amount: 1200, direction: "debit" },
        { txnDate: "2026-05-01", rawDescription: "EXI COMISIONES LBTR", amount: 100, direction: "debit" },
      ],
    });

    const future = reads
      .listTransactions({ workspaceId })
      .find((txn) => txn.txnDate === "2026-05-01" && txn.rawDescription === "PAGO RECURRENTE SUPLIDOR C");
    const fee = reads.listTransactions({ workspaceId }).find((txn) => txn.rawDescription === "EXI COMISIONES LBTR");
    expect(future?.annotation?.txnKind).toBe("expense");
    expect(future?.annotation?.expenseCategory).toBe("Servicios");
    expect(fee?.annotation?.txnKind).toBe("bank_fee");
    cleanup();
  });

  it("derives account balance from transactions when a statement has no running balance", () => {
    const { cleanup, database } = createTestDatabase("treasury-derived-balance");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);
    mutations.upsertBankAccount(
      account("cmd-acct-bsc", {
        bankName: "santa_cruz",
        accountLabel: "Santa Cruz RD$",
        accountNumberFull: "123456789",
        openingBalance: 1000,
      }),
    );
    mutations.importStatement({
      commandId: "cmd-import-bsc",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-bsc",
      sourceFormat: "xlsx",
      rows: [
        { txnDate: "2026-04-01", rawDescription: "Deposito cliente", amount: 2500, direction: "credit" },
        { txnDate: "2026-04-02", rawDescription: "Pago suplidor", amount: 750.25, direction: "debit" },
      ],
    });

    const santaCruz = reads.getAccounts(workspaceId).find((row) => row.id === "bank-account-cmd-acct-bsc");
    expect(santaCruz?.currentBalance).toBe(2749.75);
    cleanup();
  });

  it("applies audited transaction corrections idempotently", () => {
    const { cleanup, database } = createTestDatabase("treasury-correct-transaction");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);
    mutations.upsertBankAccount(account("cmd-acct-correct"));
    mutations.importStatement({
      commandId: "cmd-import-correct",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-correct",
      sourceFormat: "csv",
      rows: [{ txnDate: "2026-04-01", rawDescription: "Bad amount", amount: 100, direction: "debit" }],
    });
    const [txn] = reads.listTransactions({ workspaceId });

    const result = mutations.correctTransaction({
      commandId: "cmd-correct-txn",
      workspaceId,
      ...baseChannel,
      transactionId: txn.id,
      txnDate: "2026-04-02",
      rawDescription: "Corrected amount",
      amount: 250,
      direction: "credit",
    });
    expect(result.repeated).toBe(false);

    const repeated = mutations.correctTransaction({
      commandId: "cmd-correct-txn",
      workspaceId,
      ...baseChannel,
      transactionId: txn.id,
      amount: 999,
      direction: "debit",
    });
    expect(repeated.repeated).toBe(true);

    const [updated] = reads.listTransactions({ workspaceId });
    expect(updated.txnDate).toBe("2026-04-02");
    expect(updated.rawDescription).toBe("Corrected amount");
    expect(updated.amount).toBe(250);
    expect(updated.direction).toBe("credit");
    cleanup();
  });

  it("rejects allocations that exceed the transaction amount", () => {
    const { cleanup, database } = createTestDatabase("treasury-alloc-cap");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);
    mutations.upsertBankAccount(account("cmd-acct-alloc"));
    mutations.importStatement({
      commandId: "cmd-import-alloc",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-alloc",
      sourceFormat: "csv",
      rows: [{ txnDate: "2025-11-01", rawDescription: "Catering mixto", amount: 1000, direction: "debit" }],
    });
    const [txn] = reads.listTransactions({ workspaceId });

    expect(() =>
      mutations.setAllocations({
        commandId: "cmd-alloc-over",
        workspaceId,
        ...baseChannel,
        transactionId: txn.id,
        allocations: [
          { projectId: null, projectNameSnapshot: "Shiver", amount: 800 },
          { projectId: null, projectNameSnapshot: "Netflix", amount: 400 },
        ],
      }),
    ).toThrow(/exceed/i);

    // Within bounds works and splits correctly.
    mutations.setAllocations({
      commandId: "cmd-alloc-ok",
      workspaceId,
      ...baseChannel,
      transactionId: txn.id,
      allocations: [
        { projectId: null, projectNameSnapshot: "Shiver", amount: 600 },
        { projectId: null, projectNameSnapshot: "Netflix", amount: 400 },
      ],
    });
    const refreshed = reads.listTransactions({ workspaceId });
    expect(refreshed[0].allocations).toHaveLength(2);
    cleanup();
  });

  it("records a reimbursement review with a reduced deductible amount", () => {
    const { cleanup, database } = createTestDatabase("treasury-review");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);
    mutations.upsertBankAccount(account("cmd-acct-rev"));
    mutations.importStatement({
      commandId: "cmd-import-rev",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-rev",
      sourceFormat: "csv",
      rows: [{ txnDate: "2025-12-01", rawDescription: "Reembolso comida", amount: 20000, direction: "debit" }],
    });
    const [txn] = reads.listTransactions({ workspaceId });

    mutations.annotateTransaction({
      commandId: "cmd-classify-rev",
      workspaceId,
      ...baseChannel,
      transactionId: txn.id,
      txnKind: "reimbursement",
      reimbursementStatus: "pending",
      claimedAmount: 20000,
    });

    mutations.reviewReimbursement({
      commandId: "cmd-review-rev",
      workspaceId,
      ...baseChannel,
      transactionId: txn.id,
      reimbursementStatus: "partial",
      deductibleAmount: 15000,
      supplierNcf: "B0100000999",
      dgiiExpenseType: "01-personal",
      withholdingType: "ISR",
      withholdingRate: 10,
      withholdingAmount: 1500,
      fiscalPeriod: "2025-12",
      fiscalStatus: "accepted",
    });

    const [reviewed] = reads.listTransactions({ workspaceId });
    expect(reviewed.annotation?.deductibleAmount).toBe(15000);
    expect(reviewed.annotation?.reimbursementStatus).toBe("partial");
    expect(reviewed.annotation?.supplierNcf).toBe("B0100000999");
    expect(reviewed.annotation?.dgiiExpenseType).toBe("01-personal");
    expect(reviewed.annotation?.withholdingType).toBe("ISR");
    expect(reviewed.annotation?.withholdingRate).toBe(10);
    expect(reviewed.annotation?.withholdingAmount).toBe(1500);
    expect(reviewed.annotation?.fiscalPeriod).toBe("2025-12");
    const [reviewQueueRow] = reads.getReviewQueue(workspaceId);
    expect(reviewQueueRow).toMatchObject({
      supplierNcf: "B0100000999",
      dgiiExpenseType: "01-personal",
      withholdingType: "ISR",
      withholdingRate: 10,
      withholdingAmount: 1500,
      fiscalPeriod: "2025-12",
    });

    const overview = reads.getOverview({ workspaceId, period: "custom", customStartDate: "2025-01-01", customEndDate: "2025-12-31" });
    expect(overview.totalExpense).toBe(20000);
    expect(overview.totalDeductibleExpense).toBe(15000);
    cleanup();
  });

  it("validates payment instruments and never persists full account numbers", () => {
    const { cleanup, database } = createTestDatabase("treasury-payment-instrument-validation");
    const mutations = createTreasuryMutationService(database);

    expect(() =>
      mutations.upsertBankAccount(
        account("cmd-card-invalid", {
          accountLabel: "Visa personal",
          accountNumberFull: "4111111111111234",
          instrumentKind: "credit_card",
          owner: "user",
          ownerUserId: "user-ops",
          currency: "DOP",
        }),
      ),
    ).toThrow("Active credit cards require statement cycle and payment due days.");

    mutations.upsertBankAccount(
      account("cmd-card-valid", {
        accountLabel: "Visa personal",
        accountNumberFull: "4111111111111234",
        instrumentKind: "credit_card",
        owner: "user",
        ownerUserId: "user-ops",
        statementCycleDay: 15,
        paymentDueDay: 30,
        currency: "DOP",
      }),
    );

    const stored = database
      .prepare(`SELECT account_number_full, account_number_masked, last4, instrument_kind, owner_user_id FROM bank_accounts WHERE id = ?`)
      .get("bank-account-cmd-card-valid") as {
      account_number_full: string | null;
      account_number_masked: string | null;
      last4: string | null;
      instrument_kind: string;
      owner_user_id: string;
    };
    expect(stored.account_number_full).toBeNull();
    expect(stored.account_number_masked).toBe("****1234");
    expect(stored.last4).toBe("1234");
    expect(stored.instrument_kind).toBe("credit_card");
    expect(stored.owner_user_id).toBe("user-ops");

    const reminder = database
      .prepare(`SELECT user_id, title, recurrence_rule, completed_at FROM reminders WHERE id = ?`)
      .get("treasury-card-payment-bank-account-cmd-card-valid") as {
      user_id: string;
      title: string;
      recurrence_rule: string;
      completed_at: string | null;
    };
    expect(reminder.user_id).toBe("user-ops");
    expect(reminder.title).toBe("Pagar tarjeta: Visa personal");
    expect(reminder.recurrence_rule).toBe("FREQ=MONTHLY");
    expect(reminder.completed_at).toBeNull();

    cleanup();
  });

  it("requires a reminder user for shared credit cards and removes reminders on deactivate", () => {
    const { cleanup, database } = createTestDatabase("treasury-card-reminder-user");
    const mutations = createTreasuryMutationService(database);

    expect(() =>
      mutations.upsertBankAccount(
        account("cmd-card-shared-invalid", {
          accountLabel: "Tarjeta shared",
          instrumentKind: "credit_card",
          owner: "shared",
          statementCycleDay: 12,
          paymentDueDay: 27,
        }),
      ),
    ).toThrow("Active shared/company credit cards require a reminder user.");

    mutations.upsertBankAccount(
      account("cmd-card-shared-valid", {
        accountLabel: "Tarjeta shared",
        instrumentKind: "credit_card",
        owner: "shared",
        reminderUserId: "user-ops",
        statementCycleDay: 12,
        paymentDueDay: 27,
      }),
    );

    const reminderBefore = database
      .prepare(`SELECT user_id, recurrence_rule FROM reminders WHERE id = ?`)
      .get("treasury-card-payment-bank-account-cmd-card-shared-valid") as {
      user_id: string;
      recurrence_rule: string;
    };
    expect(reminderBefore).toEqual({ user_id: "user-ops", recurrence_rule: "FREQ=MONTHLY" });

    mutations.deactivatePaymentInstrument({
      commandId: "cmd-card-shared-deactivate",
      workspaceId,
      ...baseChannel,
      paymentInstrumentId: "bank-account-cmd-card-shared-valid",
    });

    const reminderCount = database
      .prepare(`SELECT COUNT(*) AS count FROM reminders WHERE id = ?`)
      .get("treasury-card-payment-bank-account-cmd-card-shared-valid") as { count: number };
    expect(reminderCount.count).toBe(0);

    const outbox = database
      .prepare(`SELECT operation_type FROM sync_outbox WHERE entity_type = 'reminder' AND entity_id = ?`)
      .get("treasury-card-payment-bank-account-cmd-card-shared-valid") as { operation_type: string };
    expect(outbox.operation_type).toBe("delete");

    cleanup();
  });

  it("assigns pending invoice allocations and links them to transactions without exceeding invoice totals", () => {
    const { cleanup, database } = createTestDatabase("treasury-invoice-allocation-flow");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);
    database.exec(`
      CREATE TABLE IF NOT EXISTS invoice_extractions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        original_name TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL DEFAULT 0,
        total REAL,
        currency TEXT,
        supplier_name TEXT,
        supplier_rnc TEXT,
        ncf TEXT,
        invoice_date TEXT,
        uploaded_by_user_id TEXT,
        uploaded_by_name TEXT,
        linked_user_id TEXT,
        linked_user_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    mutations.upsertBankAccount(
      account("cmd-card-allocation", {
        accountLabel: "Visa Carlos",
        accountNumberFull: "4111111111119876",
        instrumentKind: "credit_card",
        owner: "user",
        ownerUserId: "user-ops",
        statementCycleDay: 10,
        paymentDueDay: 25,
      }),
    );
    mutations.upsertBankAccount(
      account("cmd-card-allocation-alt", {
        accountLabel: "Popular Backup",
        accountNumberFull: "123456789",
        instrumentKind: "bank_account",
      }),
    );

    database
      .prepare(
        `INSERT INTO invoice_extractions (
           id, workspace_id, batch_id, status, original_name, storage_path, mime_type,
           byte_size, total, currency, supplier_name, supplier_rnc, ncf, invoice_date,
           uploaded_by_user_id, uploaded_by_name,
           linked_user_id, linked_user_name, created_at, updated_at
         ) VALUES (?, ?, ?, 'extracted', ?, ?, 'application/pdf', 100, ?, 'DOP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "invoice-extraction-allocation-001",
        workspaceId,
        "batch-allocation",
        "factura.pdf",
        "/tmp/factura.pdf",
        1000,
        "Proveedor Uno",
        "101000000",
        "B0100000001",
        "2026-06-08",
        "user-ops",
        "Carlos",
        "user-ops",
        "Carlos",
        "2026-06-08T10:00:00.000Z",
        "2026-06-08T10:00:00.000Z",
      );

    const allocation = mutations.assignInvoiceAllocation({
      commandId: "cmd-allocation-assign",
      workspaceId,
      ...baseChannel,
      paymentInstrumentId: "bank-account-cmd-card-allocation",
      linkedEntityType: "invoice_extraction",
      linkedEntityId: "invoice-extraction-allocation-001",
      amountApplied: 700,
      amountCurrency: "DOP",
      cycleStart: "2026-06-01",
      cycleEnd: "2026-06-30",
    });
    const repeated = mutations.assignInvoiceAllocation({
      commandId: "cmd-allocation-assign",
      workspaceId,
      ...baseChannel,
      paymentInstrumentId: "bank-account-cmd-card-allocation",
      linkedEntityType: "invoice_extraction",
      linkedEntityId: "invoice-extraction-allocation-001",
      amountApplied: 700,
      amountCurrency: "DOP",
    });
    expect(allocation.allocationId).toBe("txn-link-cmd-allocation-assign");
    expect(repeated.repeated).toBe(true);

    const openReimbursements = reads.getReimbursements({ workspaceId, status: "open" });
    expect(openReimbursements.groups).toHaveLength(1);
    expect(openReimbursements.groups[0]).toMatchObject({
      ownerUserId: "user-ops",
      ownerName: "Carlos",
      paymentInstrumentId: "bank-account-cmd-card-allocation",
      paymentInstrumentLabel: "Visa Carlos",
      amount: 700,
      invoiceCount: 1,
      status: "pending",
      cycleStart: "2026-06-01",
      cycleEnd: "2026-06-30",
    });
    expect(openReimbursements.groups[0].items[0]).toMatchObject({
      allocationId: allocation.allocationId,
      originalName: "factura.pdf",
      supplierName: "Proveedor Uno",
      supplierRnc: "101000000",
      ncf: "B0100000001",
      invoiceDate: "2026-06-08",
      amount: 700,
      currency: "DOP",
      status: "pending",
    });

    expect(() =>
      mutations.assignInvoiceAllocation({
        commandId: "cmd-allocation-too-much",
        workspaceId,
        ...baseChannel,
        paymentInstrumentId: "bank-account-cmd-card-allocation",
        linkedEntityType: "invoice_extraction",
        linkedEntityId: "invoice-extraction-allocation-001",
        amountApplied: 400,
        amountCurrency: "DOP",
      }),
    ).toThrow("Invoice allocations cannot exceed the linked document total.");

    const reassigned = mutations.assignInvoiceAllocation({
      commandId: "cmd-allocation-reassign",
      workspaceId,
      ...baseChannel,
      paymentInstrumentId: "bank-account-cmd-card-allocation-alt",
      linkedEntityType: "invoice_extraction",
      linkedEntityId: "invoice-extraction-allocation-001",
      amountApplied: 700,
      amountCurrency: "DOP",
    });
    expect(reassigned.allocationId).toBe(allocation.allocationId);
    const activeAllocations = database
      .prepare(
        `SELECT COUNT(*) AS count, MAX(payment_instrument_id) AS paymentInstrumentId, MAX(amount_applied) AS amountApplied
         FROM transaction_links
         WHERE workspace_id = ?
           AND linked_entity_type = 'invoice_extraction'
           AND linked_entity_id = ?
           AND allocation_status NOT IN ('rejected', 'reimbursed')`,
      )
      .get(workspaceId, "invoice-extraction-allocation-001") as {
      count: number;
      paymentInstrumentId: string;
      amountApplied: number;
    };
    expect(activeAllocations.count).toBe(1);
    expect(activeAllocations.paymentInstrumentId).toBe("bank-account-cmd-card-allocation-alt");
    expect(activeAllocations.amountApplied).toBe(700);

    mutations.importStatement({
      commandId: "cmd-import-allocation-link",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-card-allocation-alt",
      sourceFormat: "manual",
      rows: [{ txnDate: "2026-06-09", rawDescription: "COMPRA FACTURA", amount: 700, direction: "debit" }],
    });
    const txn = database.prepare(`SELECT id FROM bank_transactions WHERE raw_description = ?`).get("COMPRA FACTURA") as {
      id: string;
    };
    const linked = mutations.linkInvoiceAllocationToTransaction({
      commandId: "cmd-allocation-link",
      workspaceId,
      ...baseChannel,
      allocationId: allocation.allocationId,
      transactionId: txn.id,
    });
    expect(linked.transactionId).toBe(txn.id);

    const row = database
      .prepare(`SELECT transaction_id, allocation_status FROM transaction_links WHERE id = ?`)
      .get(allocation.allocationId) as { transaction_id: string; allocation_status: string };
    expect(row.transaction_id).toBe(txn.id);
    expect(row.allocation_status).toBe("matched");

    mutations.markInvoiceAllocationReimbursed({
      commandId: "cmd-allocation-reimbursed",
      workspaceId,
      ...baseChannel,
      allocationId: allocation.allocationId,
    });
    expect(reads.getReimbursements({ workspaceId, status: "open" }).groups).toHaveLength(0);
    const reimbursed = reads.getReimbursements({ workspaceId, status: "reimbursed" });
    expect(reimbursed.groups).toHaveLength(1);
    expect(reimbursed.groups[0].status).toBe("reimbursed");

    const afterReimbursement = mutations.assignInvoiceAllocation({
      commandId: "cmd-allocation-after-reimbursement",
      workspaceId,
      ...baseChannel,
      paymentInstrumentId: "bank-account-cmd-card-allocation",
      linkedEntityType: "invoice_extraction",
      linkedEntityId: "invoice-extraction-allocation-001",
      amountApplied: 700,
      amountCurrency: "DOP",
    });
    expect(afterReimbursement.allocationId).toBe("txn-link-cmd-allocation-after-reimbursement");

    cleanup();
  });

  it("creates card settlements as internal transfers and can close cycle allocations", () => {
    const { cleanup, database } = createTestDatabase("treasury-card-settlement");
    const mutations = createTreasuryMutationService(database);

    mutations.upsertBankAccount(
      account("cmd-card-settlement", {
        accountLabel: "Visa settlement",
        accountNumberFull: "4111111111114321",
        instrumentKind: "credit_card",
        owner: "user",
        ownerUserId: "user-ops",
        statementCycleDay: 15,
        paymentDueDay: 30,
      }),
    );
    mutations.importStatement({
      commandId: "cmd-import-card-settlement",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-card-settlement",
      sourceFormat: "manual",
      rows: [{ txnDate: "2026-06-30", rawDescription: "PAGO TARJETA", amount: 1200, direction: "debit" }],
    });
    const txn = database.prepare(`SELECT id FROM bank_transactions WHERE raw_description = ?`).get("PAGO TARJETA") as {
      id: string;
    };
    const result = mutations.createCardSettlement({
      commandId: "cmd-card-settlement-create",
      workspaceId,
      ...baseChannel,
      paymentInstrumentId: "bank-account-cmd-card-settlement",
      transactionId: txn.id,
      cycleStart: "2026-06-01",
      cycleEnd: "2026-06-30",
      closeAllocations: true,
    });
    expect(result.transactionId).toBe(txn.id);

    const annotation = database
      .prepare(`SELECT txn_kind, is_internal_transfer FROM transaction_annotations WHERE transaction_id = ?`)
      .get(txn.id) as { txn_kind: string; is_internal_transfer: number };
    expect(annotation).toEqual({ txn_kind: "transfer", is_internal_transfer: 1 });

    const link = database
      .prepare(`SELECT linked_entity_type, linked_entity_id, allocation_status FROM transaction_links WHERE id = ?`)
      .get(result.allocationId) as { linked_entity_type: string; linked_entity_id: string; allocation_status: string };
    expect(link).toEqual({
      linked_entity_type: "card_settlement",
      linked_entity_id: "bank-account-cmd-card-settlement",
      allocation_status: "matched",
    });

    cleanup();
  });

  it("builds a deductible ledger with fiscal totals and exportable files", () => {
    const { cleanup, database } = createTestDatabase("treasury-deductible-ledger");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);
    mutations.upsertBankAccount(account("cmd-acct-ledger"));
    mutations.importStatement({
      commandId: "cmd-import-ledger",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-ledger",
      sourceFormat: "csv",
      rows: [
        { txnDate: "2026-05-05", rawDescription: "Proveedor con RNC", amount: 10000, direction: "debit" },
        { txnDate: "2026-05-06", rawDescription: "Cliente ingreso", amount: 15000, direction: "credit" },
      ],
    });
    const [expense] = reads.listTransactions({ workspaceId, direction: "debit" });
    mutations.annotateTransaction({
      commandId: "cmd-ledger-annotate",
      workspaceId,
      ...baseChannel,
      transactionId: expense.id,
      txnKind: "expense",
      concept: "Servicios técnicos",
      counterparty: "Proveedor SRL",
      counterpartyRnc: "131000000",
      expenseCategory: "services",
      supplierNcf: "B0100000001",
      dgiiExpenseType: "02-servicios",
      withholdingType: "isr",
      withholdingRate: 10,
      withholdingAmount: 1000,
      fiscalPeriod: "2026-05",
    });
    mutations.reviewReimbursement({
      commandId: "cmd-ledger-review",
      workspaceId,
      ...baseChannel,
      transactionId: expense.id,
      reimbursementStatus: "partial",
      deductibleAmount: 7500,
      fiscalStatus: "accepted",
    });

    const ledger = reads.getDeductibleLedger({ workspaceId, period: "all" });
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({
      counterparty: "Proveedor SRL",
      counterpartyRnc: "131000000",
      concept: "Servicios técnicos",
      supplierNcf: "B0100000001",
      dgiiExpenseType: "02-servicios",
      withholdingType: "isr",
      withholdingRate: 10,
      withholdingAmount: 1000,
      fiscalPeriod: "2026-05",
      claimedAmount: 10000,
      deductibleAmount: 7500,
      rejectedAmount: 2500,
    });
    expect(ledger.totalsByCurrency).toEqual([
      { currency: "DOP", claimedAmount: 10000, deductibleAmount: 7500, rejectedAmount: 2500 },
    ]);
    expect(buildDeductibleLedgerCsv(ledger)).toContain("Proveedor SRL");
    expect(buildDeductibleLedgerCsv(ledger)).toContain("B0100000001");
    expect(buildDeductibleLedgerXlsx(ledger).length).toBeGreaterThan(1000);

    cleanup();
  });

  it("is idempotent on repeated import command ids", () => {
    const { cleanup, database } = createTestDatabase("treasury-idempotent");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);
    mutations.upsertBankAccount(account("cmd-acct-idem"));
    const input = {
      commandId: "cmd-import-idem",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-idem",
      sourceFormat: "csv" as const,
      rows: rows(),
    };
    mutations.importStatement(input);
    const repeat = mutations.importStatement(input);
    expect(repeat.repeated).toBe(true);
    expect(reads.listTransactions({ workspaceId })).toHaveLength(3);
    cleanup();
  });

  it("undoes treasury annotations and keeps a syncable blank annotation when no prior row existed", () => {
    const { cleanup, database } = createTestDatabase("treasury-undo-annotation");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);
    mutations.upsertBankAccount(account("cmd-acct-undo-ann"));
    mutations.importStatement({
      commandId: "cmd-import-undo-ann",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-undo-ann",
      sourceFormat: "csv",
      rows: [{ txnDate: "2026-05-01", rawDescription: "Pago proveedor puntual", amount: 12000, direction: "debit" }],
    });
    const [txn] = reads.listTransactions({ workspaceId });

    mutations.annotateTransaction({
      commandId: "cmd-annotate-undo-ann",
      workspaceId,
      ...baseChannel,
      transactionId: txn.id,
      txnKind: "tax",
      concept: "ITBIS",
      expenseCategory: "Taxes",
    });
    expect(reads.listTransactions({ workspaceId })[0].annotation?.txnKind).toBe("tax");

    const undo = mutations.undoLastAction({
      commandId: "cmd-undo-ann",
      workspaceId,
      ...baseChannel,
    });
    expect(undo.repeated).toBe(false);

    const restored = reads.listTransactions({ workspaceId })[0];
    expect(restored.annotation?.txnKind).toBeNull();
    expect(restored.annotation?.concept).toBeNull();

    const outbox = database
      .prepare(
        `SELECT entity_type, entity_id FROM sync_outbox WHERE id = ? LIMIT 1`,
      )
      .get("sync-cmd-undo-ann-annotation") as { entity_type: string; entity_id: string };
    expect(outbox).toEqual({ entity_type: "transaction_annotation", entity_id: txn.id });

    const undoRow = database
      .prepare(`SELECT undone FROM treasury_undo_journal WHERE command_id = ? LIMIT 1`)
      .get("cmd-annotate-undo-ann") as { undone: number };
    expect(undoRow.undone).toBe(1);

    cleanup();
  });

  it("previews and restores treasury allocations", () => {
    const { cleanup, database } = createTestDatabase("treasury-undo-allocations");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);
    mutations.upsertBankAccount(account("cmd-acct-undo-alloc"));
    mutations.importStatement({
      commandId: "cmd-import-undo-alloc",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-undo-alloc",
      sourceFormat: "csv",
      rows: [{ txnDate: "2026-05-03", rawDescription: "Rental split", amount: 1000, direction: "debit" }],
    });
    const [txn] = reads.listTransactions({ workspaceId });

    mutations.setAllocations({
      commandId: "cmd-alloc-original",
      workspaceId,
      ...baseChannel,
      transactionId: txn.id,
      allocations: [{ projectId: null, projectNameSnapshot: "Project A", amount: 1000 }],
    });
    mutations.setAllocations({
      commandId: "cmd-alloc-revised",
      workspaceId,
      ...baseChannel,
      transactionId: txn.id,
      allocations: [
        { projectId: null, projectNameSnapshot: "Project A", amount: 300 },
        { projectId: null, projectNameSnapshot: "Project B", amount: 700 },
      ],
    });

    expect(reads.getUndoPreview(workspaceId)).toMatchObject({
      kind: "allocations",
      label: txn.id,
    });

    mutations.undoLastAction({
      commandId: "cmd-undo-alloc-revised",
      workspaceId,
      ...baseChannel,
    });

    const restored = reads.listTransactions({ workspaceId })[0].allocations;
    expect(restored).toHaveLength(1);
    expect(restored[0].projectNameSnapshot).toBe("Project A");
    expect(restored[0].amount).toBe(1000);

    cleanup();
  });

  it("undoes transaction corrections in stack order and keeps undo commands idempotent", () => {
    const { cleanup, database } = createTestDatabase("treasury-undo-correction-stack");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);
    mutations.upsertBankAccount(account("cmd-acct-undo-correct"));
    mutations.importStatement({
      commandId: "cmd-import-undo-correct",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-undo-correct",
      sourceFormat: "csv",
      rows: [{ txnDate: "2026-05-04", rawDescription: "Original row", amount: 100, direction: "debit" }],
    });
    const [txn] = reads.listTransactions({ workspaceId });

    mutations.correctTransaction({
      commandId: "cmd-correct-first",
      workspaceId,
      ...baseChannel,
      transactionId: txn.id,
      rawDescription: "First correction",
      amount: 200,
    });
    mutations.correctTransaction({
      commandId: "cmd-correct-second",
      workspaceId,
      ...baseChannel,
      transactionId: txn.id,
      rawDescription: "Second correction",
      amount: 300,
    });

    const undoSecond = mutations.undoLastAction({
      commandId: "cmd-undo-correct-second",
      workspaceId,
      ...baseChannel,
    });
    const repeatedUndoSecond = mutations.undoLastAction({
      commandId: "cmd-undo-correct-second",
      workspaceId,
      ...baseChannel,
    });
    expect(undoSecond.repeated).toBe(false);
    expect(repeatedUndoSecond.repeated).toBe(true);
    expect(reads.listTransactions({ workspaceId })[0].rawDescription).toBe("First correction");
    expect(reads.getUndoPreview(workspaceId)).toMatchObject({ kind: "transaction_correction" });

    mutations.undoLastAction({
      commandId: "cmd-undo-correct-first",
      workspaceId,
      ...baseChannel,
    });
    const restoredOriginal = reads.listTransactions({ workspaceId })[0];
    expect(restoredOriginal.rawDescription).toBe("Original row");
    expect(restoredOriginal.amount).toBe(100);

    cleanup();
  });

  it("undoes a deleted import batch with transactions and human annotations", () => {
    const { cleanup, database } = createTestDatabase("treasury-undo-import-delete");
    const mutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);
    mutations.upsertBankAccount(account("cmd-acct-undo-import"));
    const imported = mutations.importStatement({
      commandId: "cmd-import-undo-import",
      workspaceId,
      ...baseChannel,
      bankAccountId: "bank-account-cmd-acct-undo-import",
      sourceFormat: "csv",
      originalFilename: "popular-undo.csv",
      rows: [{ txnDate: "2026-05-02", rawDescription: "Servicios Carlos", amount: 25000, direction: "debit" }],
    });
    const [txn] = reads.listTransactions({ workspaceId });
    mutations.annotateTransaction({
      commandId: "cmd-annotate-before-delete",
      workspaceId,
      ...baseChannel,
      transactionId: txn.id,
      txnKind: "expense",
      concept: "Servicios",
      expenseCategory: "Service payments",
    });

    mutations.deleteImport({
      commandId: "cmd-delete-undo-import",
      workspaceId,
      ...baseChannel,
      importId: imported.importId,
    });
    expect(reads.listTransactions({ workspaceId })).toHaveLength(0);

    mutations.undoLastAction({
      commandId: "cmd-undo-import-delete",
      workspaceId,
      ...baseChannel,
    });
    const restored = reads.listTransactions({ workspaceId });
    expect(restored).toHaveLength(1);
    expect(restored[0].annotation?.concept).toBe("Servicios");

    const importOutbox = database
      .prepare(`SELECT entity_type FROM sync_outbox WHERE id = ? LIMIT 1`)
      .get("sync-cmd-undo-import-delete-import") as { entity_type: string };
    expect(importOutbox.entity_type).toBe("bank_statement_import");

    cleanup();
  });
});
