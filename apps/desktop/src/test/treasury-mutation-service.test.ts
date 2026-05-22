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
