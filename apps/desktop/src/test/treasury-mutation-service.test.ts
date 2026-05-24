import { describe, expect, it } from "vitest";

import type { ParsedBankTransaction } from "@contracts";

import { createTreasuryMutationService } from "../../electron/main/services/data/treasuryMutationService";
import { createTreasuryReadService } from "../../electron/main/services/data/treasuryReadService";
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
      fiscalStatus: "accepted",
    });

    const [reviewed] = reads.listTransactions({ workspaceId });
    expect(reviewed.annotation?.deductibleAmount).toBe(15000);
    expect(reviewed.annotation?.reimbursementStatus).toBe("partial");

    const overview = reads.getOverview({ workspaceId, period: "custom", customStartDate: "2025-01-01", customEndDate: "2025-12-31" });
    expect(overview.totalExpense).toBe(20000);
    expect(overview.totalDeductibleExpense).toBe(15000);
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
});
