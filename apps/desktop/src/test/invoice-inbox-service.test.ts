import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ParsedBankTransaction } from "@contracts";

import { createTreasuryMutationService } from "../../electron/main/services/data/treasuryMutationService";
import { createTreasuryReadService } from "../../electron/main/services/data/treasuryReadService";
import {
  createInvoiceInboxService,
  type InvoiceExtractionFields,
} from "../../electron/main/services/data/invoiceInboxService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const workspaceId = "workspace-metadata";
const baseChannel = { actorType: "user" as const, sourceChannel: "desktop" as const };

// 1x1 transparent PNG.
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const fields: InvoiceExtractionFields = {
  supplierName: "Setup Tech Equip SRL",
  supplierRnc: "131223344",
  ncf: "B0100000123",
  invoiceDate: "2025-10-02",
  subtotal: 63559.32,
  itbis: 11440.68,
  total: 75000,
  currency: "DOP",
  dgiiExpenseType: "09",
  expenseCategory: "Equipo técnico",
  confidence: 0.9,
  rawText: "factura",
};

const debitStatement: ParsedBankTransaction[] = [
  {
    txnDate: "2025-10-03",
    rawDescription: "VIA LBTR SETUP TECH EQUIP STE SRL",
    amount: 75000,
    direction: "debit",
    runningBalance: 179965.66,
  },
];

const tempDirs: string[] = [];
const makeUserDataPath = () => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-inbox-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("invoice inbox service", () => {
  it("enqueues a document, suggests a matching movement and applies it to the deductible ledger", () => {
    const { cleanup, database } = createTestDatabase("invoice-inbox-apply");
    const treasuryMutations = createTreasuryMutationService(database);
    const reads = createTreasuryReadService(database);

    treasuryMutations.upsertBankAccount({
      commandId: "cmd-acct-1",
      workspaceId,
      ...baseChannel,
      bankName: "popular",
      accountLabel: "Popular RD$",
      accountNumberFull: "788565075",
      currency: "DOP",
      openingBalance: 0,
    });
    treasuryMutations.importStatement({
      commandId: "cmd-import-1",
      workspaceId,
      ...baseChannel,
      bankAccountId: (reads.getAccounts(workspaceId)[0]?.id ?? ""),
      sourceFormat: "manual",
      rows: debitStatement,
    });

    const inbox = createInvoiceInboxService(database, {
      userDataPath: makeUserDataPath(),
      treasuryMutations,
    });

    const { result, ids } = inbox.enqueueBatch({
      workspaceId,
      files: [{ name: "factura.png", mimeType: "image/png", dataUrl: PNG_DATA_URL }],
    });
    expect(result.queuedCount).toBe(1);
    expect(ids).toHaveLength(1);

    const match = inbox.autoMatch(workspaceId, fields);
    expect(match).not.toBeNull();

    inbox.recordExtraction(ids[0], fields, match);
    const extracted = inbox.list({ workspaceId });
    expect(extracted[0]?.status).toBe("extracted");
    expect(extracted[0]?.suggestedTransactionId).toBe(match?.transactionId);

    const applied = inbox.applyExtraction({
      workspaceId,
      extractionId: ids[0],
      transactionId: match!.transactionId,
    });
    expect(applied.status).toBe("applied");

    const ledger = reads.getDeductibleLedger({ workspaceId, period: "all" });
    const ncfs = ledger.rows.map((row) => row.supplierNcf);
    expect(ncfs).toContain("B0100000123");

    cleanup();
  });

  it("enqueues a sync_outbox row so invoices propagate across machines", () => {
    const { cleanup, database } = createTestDatabase("invoice-inbox-sync");
    const treasuryMutations = createTreasuryMutationService(database);
    const inbox = createInvoiceInboxService(database, {
      userDataPath: makeUserDataPath(),
      treasuryMutations,
    });

    const { ids } = inbox.enqueueBatch({
      workspaceId,
      files: [{ name: "factura.png", mimeType: "image/png", dataUrl: PNG_DATA_URL }],
    });
    expect(ids).toHaveLength(1);

    const outboxAfterEnqueue = database
      .prepare(
        `SELECT COUNT(*) AS count FROM sync_outbox WHERE entity_type = 'invoice_extraction' AND entity_id = ?`,
      )
      .get(ids[0]) as { count: number };
    expect(outboxAfterEnqueue.count).toBeGreaterThan(0);

    inbox.recordExtraction(ids[0], fields, null);
    inbox.update({ workspaceId, extractionId: ids[0], expenseCategory: "Catering" });

    const outboxAfterUpdates = database
      .prepare(
        `SELECT COUNT(*) AS count FROM sync_outbox WHERE entity_type = 'invoice_extraction' AND entity_id = ?`,
      )
      .get(ids[0]) as { count: number };
    // enqueue + recordExtraction + update each enqueue a push.
    expect(outboxAfterUpdates.count).toBeGreaterThanOrEqual(3);

    cleanup();
  });

  it("links a user and project tags, and bulk-links many invoices at once", () => {
    const { cleanup, database } = createTestDatabase("invoice-inbox-link");
    const treasuryMutations = createTreasuryMutationService(database);
    const inbox = createInvoiceInboxService(database, {
      userDataPath: makeUserDataPath(),
      treasuryMutations,
    });

    const { ids } = inbox.enqueueBatch({
      workspaceId,
      files: [
        { name: "a.png", mimeType: "image/png", dataUrl: PNG_DATA_URL },
        { name: "b.png", mimeType: "image/png", dataUrl: PNG_DATA_URL },
      ],
    });
    expect(ids).toHaveLength(2);

    // Single update: link a user + two project tags.
    inbox.update({
      workspaceId,
      extractionId: ids[0],
      linkedUserId: "user-ivan",
      linkedUserName: "Iván",
      projects: [
        { projectId: "project-shiver", projectName: "Shiver" },
        { projectId: "project-netflix", projectName: "Netflix" },
      ],
    });
    const single = inbox.list({ workspaceId }).find((row) => row.id === ids[0]);
    expect(single?.linkedUserName).toBe("Iván");
    expect(single?.projects.map((p) => p.projectId).sort()).toEqual(["project-netflix", "project-shiver"]);

    // Bulk-link a user to both invoices.
    const result = inbox.bulkLink({
      workspaceId,
      extractionIds: ids,
      linkedUserId: "user-carlos",
      linkedUserName: "Carlos",
    });
    expect(result.updatedCount).toBe(2);
    const all = inbox.list({ workspaceId });
    expect(all.every((row) => row.linkedUserName === "Carlos")).toBe(true);
    // Project tags survive the user-only bulk update on the first invoice.
    expect(all.find((row) => row.id === ids[0])?.projects).toHaveLength(2);

    cleanup();
  });

  it("skips unsupported attachments and never matches without a plausible movement", () => {
    const { cleanup, database } = createTestDatabase("invoice-inbox-skip");
    const treasuryMutations = createTreasuryMutationService(database);
    const inbox = createInvoiceInboxService(database, {
      userDataPath: makeUserDataPath(),
      treasuryMutations,
    });

    const { result } = inbox.enqueueBatch({
      workspaceId,
      files: [{ name: "notes.txt", mimeType: "text/plain", dataUrl: "data:text/plain;base64,aGk=" }],
    });
    expect(result.queuedCount).toBe(0);
    expect(result.skippedCount).toBe(1);

    // No bank movements seeded → no suggestion.
    expect(inbox.autoMatch(workspaceId, fields)).toBeNull();

    cleanup();
  });
});
