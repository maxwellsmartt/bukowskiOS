import { describe, expect, it } from "vitest";

import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createFinanceMutationService } from "../../electron/main/services/data/financeMutationService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("finance mutation service", () => {
  it("creates and updates finance entries while keeping read models in sync", () => {
    const { cleanup, database } = createTestDatabase("bukowski-finance-mutation-test");
    const reads = createFoundationReadService(database);
    const mutations = createFinanceMutationService(database);

    const created = mutations.createEntry({
      commandId: "cmd-test-finance-create",
      workspaceId: "workspace-metadata",
      entryType: "invoice",
      category: "Production billing",
      amount: 1450,
      currency: "USD",
      status: "Draft",
      projectId: "project-aurora",
      assetId: "asset-smallhd-cine7",
      incidentId: null,
      entryDate: "2026-04-12",
      description: "Invoice draft for monitor replacement hold.",
      notes: "Ready for finance review.",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(created.repeated).toBe(false);
    expect(created.entryId).toBe("finance-cmd-test-finance-create");

    let entry = reads.getFinanceEntries().find((row) => row.id === created.entryId);
    expect(entry?.type).toBe("invoice");
    expect(entry?.projectId).toBe("project-aurora");
    expect(entry?.assetId).toBe("asset-smallhd-cine7");
    expect(entry?.description).toContain("Invoice draft");

    const updated = mutations.updateEntry({
      commandId: "cmd-test-finance-update",
      workspaceId: "workspace-metadata",
      entryId: created.entryId,
      entryType: "invoice",
      category: "Production billing",
      amount: 1700,
      currency: "USD",
      status: "Approved",
      projectId: "project-aurora",
      assetId: "asset-smallhd-cine7",
      incidentId: "incident-cine7-scratch",
      entryDate: "2026-04-12",
      description: "Approved invoice tied to the monitor incident.",
      notes: "Estimate confirmed by ops.",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(updated.repeated).toBe(false);

    entry = reads.getFinanceEntries().find((row) => row.id === created.entryId);
    expect(entry?.status).toBe("Approved");
    expect(entry?.amountValue).toBe(1700);
    expect(entry?.incidentId).toBe("incident-cine7-scratch");

    const receipt = database
      .prepare("SELECT outcome_status FROM command_receipts WHERE command_id = ? LIMIT 1")
      .get("cmd-test-finance-update") as { outcome_status: string } | undefined;
    expect(receipt?.outcome_status).toBe("success");

    const outboxRow = database
      .prepare("SELECT entity_type, operation_type FROM sync_outbox WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(created.entryId) as { entity_type: string; operation_type: string } | undefined;
    expect(outboxRow).toEqual({
      entity_type: "financial_entry",
      operation_type: "upsert",
    });

    cleanup();
  });
});
