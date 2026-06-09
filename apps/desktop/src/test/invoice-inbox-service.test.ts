import fs, { mkdtempSync, rmSync } from "node:fs";
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
    const storedPath = (
      database.prepare("SELECT storage_path FROM invoice_extractions WHERE id = ?").get(ids[0]) as { storage_path: string }
    ).storage_path;
    if (process.platform !== "win32") {
      expect(fs.statSync(storedPath).mode & 0o777).toBe(0o600);
    }

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

  it("shows the latest open invoice allocation before rejected historical rows", () => {
    const { cleanup, database } = createTestDatabase("invoice-inbox-open-allocation");
    const treasuryMutations = createTreasuryMutationService(database);
    treasuryMutations.upsertBankAccount({
      commandId: "cmd-open-allocation-account",
      workspaceId,
      ...baseChannel,
      bankName: "popular",
      accountLabel: "Popular RD$",
      accountNumberFull: "788565075",
      currency: "DOP",
      openingBalance: 0,
    });
    treasuryMutations.upsertBankAccount({
      commandId: "cmd-rejected-allocation-account",
      workspaceId,
      ...baseChannel,
      bankName: "santa_cruz",
      accountLabel: "Santa Cruz RD$",
      accountNumberFull: "1234563024",
      currency: "DOP",
      openingBalance: 0,
    });
    const bankAccountId = (
      database.prepare(`SELECT id FROM bank_accounts WHERE account_label = ? LIMIT 1`).get("Popular RD$") as { id: string }
    ).id;
    const rejectedBankAccountId = (
      database.prepare(`SELECT id FROM bank_accounts WHERE account_label = ? LIMIT 1`).get("Santa Cruz RD$") as { id: string }
    ).id;
    const inbox = createInvoiceInboxService(database, {
      userDataPath: makeUserDataPath(),
      treasuryMutations,
    });
    const { ids } = inbox.enqueueBatch({
      workspaceId,
      files: [{ name: "factura.png", mimeType: "image/png", dataUrl: PNG_DATA_URL }],
    });
    inbox.recordExtraction(ids[0], fields, null);
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO transaction_links (
           id, workspace_id, transaction_id, payment_instrument_id,
           linked_entity_type, linked_entity_id, amount_applied, amount_currency,
           allocation_status, created_at, updated_at
         ) VALUES (?, ?, NULL, ?, 'invoice_extraction', ?, 75000, 'DOP', 'pending', ?, ?)`,
      )
      .run("txn-link-open", workspaceId, bankAccountId, ids[0], "2026-06-08T10:00:00.000Z", "2026-06-08T10:00:00.000Z");
    database
      .prepare(
        `INSERT INTO transaction_links (
           id, workspace_id, transaction_id, payment_instrument_id,
           linked_entity_type, linked_entity_id, amount_applied, amount_currency,
           allocation_status, created_at, updated_at
         ) VALUES (?, ?, NULL, ?, 'invoice_extraction', ?, 75000, 'DOP', 'rejected', ?, ?)`,
      )
      .run("txn-link-rejected-newer", workspaceId, rejectedBankAccountId, ids[0], now, now);

    const row = inbox.list({ workspaceId })[0];
    expect(row?.allocation?.id).toBe("txn-link-open");
    expect(row?.allocation?.allocationStatus).toBe("pending");

    cleanup();
  });

  it("retries failed or extracted invoices without requeueing applied/dismissed rows", () => {
    const { cleanup, database } = createTestDatabase("invoice-inbox-retry");
    const treasuryMutations = createTreasuryMutationService(database);
    const inbox = createInvoiceInboxService(database, {
      userDataPath: makeUserDataPath(),
      treasuryMutations,
    });

    const { ids } = inbox.enqueueBatch({
      workspaceId,
      files: [
        { name: "failed.png", mimeType: "image/png", dataUrl: PNG_DATA_URL },
        { name: "extracted.png", mimeType: "image/png", dataUrl: PNG_DATA_URL },
        { name: "dismissed.png", mimeType: "image/png", dataUrl: PNG_DATA_URL },
      ],
    });

    inbox.recordFailure(ids[0], "DOMMatrix is not defined");
    inbox.recordExtraction(ids[1], fields, { transactionId: "txn-test", confidence: 0.88 });
    inbox.dismiss({ workspaceId, extractionId: ids[2] });

    const result = inbox.retry({ workspaceId, extractionIds: ids });
    expect(result.queuedCount).toBe(2);
    expect(result.skippedCount).toBe(1);
    expect(result.extractionIds).toEqual([ids[0], ids[1]]);

    const rows = inbox.list({ workspaceId, includeResolved: true });
    const retriedFailed = rows.find((row) => row.id === ids[0]);
    const retriedExtracted = rows.find((row) => row.id === ids[1]);
    const skippedDismissed = rows.find((row) => row.id === ids[2]);
    expect(retriedFailed?.status).toBe("pending");
    expect(retriedFailed?.errorMessage).toBeNull();
    expect(retriedExtracted?.status).toBe("pending");
    expect(retriedExtracted?.suggestedTransactionId).toBeNull();
    expect(skippedDismissed?.status).toBe("dismissed");

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

  it("uploads document bytes and downloads them on demand when the local file is missing", async () => {
    const { cleanup, database } = createTestDatabase("invoice-inbox-storage");
    const treasuryMutations = createTreasuryMutationService(database);
    const cloud = new Map<string, Buffer>();
    const storage = {
      enabled: true,
      upload: async (key: string, buffer: Buffer) => {
        cloud.set(key, buffer);
        return true;
      },
      download: async (key: string) => cloud.get(key) ?? null,
    };
    const inbox = createInvoiceInboxService(database, {
      userDataPath: makeUserDataPath(),
      treasuryMutations,
      storage,
    });

    const { ids } = inbox.enqueueBatch({
      workspaceId,
      files: [{ name: "factura.png", mimeType: "image/png", dataUrl: PNG_DATA_URL }],
    });
    expect(ids).toHaveLength(1);

    await inbox.uploadDocument(ids[0]);
    expect(cloud.size).toBe(1);

    // Simulate a second machine: the row synced but the local file is absent.
    const row = database
      .prepare(`SELECT storage_path FROM invoice_extractions WHERE id = ?`)
      .get(ids[0]) as { storage_path: string };
    rmSync(row.storage_path);

    const file = await inbox.getFileBuffer(ids[0]);
    expect(file).not.toBeNull();
    expect(file?.buffer.length).toBeGreaterThan(0);

    cleanup();
  });

  it("detects exact-duplicate invoices by content hash across uploads", () => {
    const { cleanup, database } = createTestDatabase("invoice-inbox-dedupe");
    const treasuryMutations = createTreasuryMutationService(database);
    const inbox = createInvoiceInboxService(database, {
      userDataPath: makeUserDataPath(),
      treasuryMutations,
    });

    // Same bytes uploaded twice (simulating home + office).
    inbox.enqueueBatch({ workspaceId, files: [{ name: "casa.png", mimeType: "image/png", dataUrl: PNG_DATA_URL }] });
    inbox.enqueueBatch({ workspaceId, files: [{ name: "oficina.png", mimeType: "image/png", dataUrl: PNG_DATA_URL }] });

    const groups = inbox.findDuplicateGroups(workspaceId);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
    expect(new Set(groups[0].items.map((i) => i.originalName))).toEqual(new Set(["casa.png", "oficina.png"]));

    // Dismissing one collapses the group.
    inbox.dismiss({ workspaceId, extractionId: groups[0].items[1].id });
    expect(inbox.findDuplicateGroups(workspaceId)).toHaveLength(0);

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
