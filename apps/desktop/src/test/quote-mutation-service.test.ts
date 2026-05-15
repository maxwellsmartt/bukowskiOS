import { describe, expect, it } from "vitest";

import { createQuoteMutationService } from "../../electron/main/services/data/quoteMutationService";
import { createQuoteReadService } from "../../electron/main/services/data/quoteReadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const baseChannel = { actorType: "user" as const, sourceChannel: "desktop" as const };

const buildHeader = (overrides: Record<string, unknown> = {}) => ({
  quoteDate: "2026-05-04",
  validityDays: 30,
  clientId: null,
  clientNameSnapshot: "Altitude Pictures",
  clientRncSnapshot: "1-30-12345-6",
  productionCompanyId: null,
  productionCompanyNameSnapshot: "Altitude Productions",
  productionPurSnapshot: "PUR-2026-001",
  workspaceSirecineSnapshot: "SIR-2026-0001",
  attentionName: "Carlos Director",
  attentionPhone: "+1 809 555 0100",
  projectId: null,
  projectNameSnapshot: "Aurora Series",
  productionName: "Aurora",
  description: "DIT package for two units across the December block.",
  packageTitle: "DIT / Data Management",
  currency: "DOP",
  baseCurrency: "DOP",
  exchangeRate: 1,
  exchangeRateSource: "manual" as const,
  exchangeRateType: "manual" as const,
  exchangeRateEffectiveDate: "2026-05-01",
  taxProfile: "standard_itbis" as const,
  itbisRate: 0.18,
  taxAddedToTotal: true,
  ...overrides,
});

describe("quote mutation service", () => {
  it("creates a quote with sequential numbering and persists items", () => {
    const { cleanup, database } = createTestDatabase("bukowski-quote-create");
    const reads = createQuoteReadService(database);
    const mutations = createQuoteMutationService(database);

    const result = mutations.createQuote({
      commandId: "cmd-quote-1",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      ...buildHeader(),
      items: [
        {
          sortOrder: 1,
          quantity: 5,
          title: "DIT operator",
          unitPrice: 8000,
          taxBehavior: "follows_quote",
          durationValue: 5,
          durationUnit: "day",
        },
        {
          sortOrder: 2,
          quantity: 1,
          title: "Backup drives 18 TB",
          unitPrice: 25000,
          taxBehavior: "follows_quote",
        },
      ],
    });

    expect(result.repeated).toBe(false);
    expect(result.quoteNumber).toBe("2026-0001");

    const detail = reads.getQuoteDetail("workspace-metadata", result.quoteId);
    expect(detail).not.toBeNull();
    expect(detail?.items).toHaveLength(2);
    // Item 1: qty 5 × unit 8000 × duration 5 days = 200,000.
    // Item 2: qty 1 × unit 25,000 × no duration (treated as 1) = 25,000.
    // Subtotal = 225,000; ITBIS 0.18 → 40,500; total 265,500.
    expect(detail?.subtotalAmount).toBe(225000);
    expect(detail?.taxAmount).toBe(40500);
    expect(detail?.totalAmount).toBe(265500);
    expect(detail?.validUntil).toBe("2026-06-03");

    const second = mutations.createQuote({
      commandId: "cmd-quote-2",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      ...buildHeader(),
      items: [{ sortOrder: 1, quantity: 1, title: "Single", unitPrice: 1000, taxBehavior: "exempt" }],
    });
    expect(second.quoteNumber).toBe("2026-0002");

    cleanup();
  });

  it("supports status transitions and rejects invalid ones", () => {
    const { cleanup, database } = createTestDatabase("bukowski-quote-status");
    const mutations = createQuoteMutationService(database);

    const created = mutations.createQuote({
      commandId: "cmd-status-1",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      ...buildHeader(),
      items: [{ sortOrder: 1, quantity: 1, title: "Item", unitPrice: 1000, taxBehavior: "taxable" }],
    });

    mutations.setStatus({
      commandId: "cmd-status-2",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      quoteId: created.quoteId,
      status: "sent",
    });

    mutations.setStatus({
      commandId: "cmd-status-3",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      quoteId: created.quoteId,
      status: "approved",
    });

    // Approved → cancelled requires reason
    expect(() =>
      mutations.setStatus({
        commandId: "cmd-status-4",
        workspaceId: "workspace-metadata",
        ...baseChannel,
        quoteId: created.quoteId,
        status: "cancelled",
      }),
    ).toThrow(/reason/);

    // Cannot go from approved back to sent
    expect(() =>
      mutations.setStatus({
        commandId: "cmd-status-5",
        workspaceId: "workspace-metadata",
        ...baseChannel,
        quoteId: created.quoteId,
        status: "sent",
      }),
    ).toThrow(/Cannot transition/);

    cleanup();
  });

  it("duplicates a quote into a fresh draft with a new number", () => {
    const { cleanup, database } = createTestDatabase("bukowski-quote-duplicate");
    const reads = createQuoteReadService(database);
    const mutations = createQuoteMutationService(database);

    const original = mutations.createQuote({
      commandId: "cmd-dup-1",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      ...buildHeader(),
      items: [{ sortOrder: 1, quantity: 2, title: "Original", unitPrice: 5000, taxBehavior: "taxable" }],
    });

    const duplicate = mutations.duplicateQuote({
      commandId: "cmd-dup-2",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      quoteId: original.quoteId,
    });

    expect(duplicate.quoteId).not.toBe(original.quoteId);
    expect(duplicate.quoteNumber).not.toBe(original.quoteNumber);

    const detail = reads.getQuoteDetail("workspace-metadata", duplicate.quoteId);
    expect(detail?.status).toBe("draft");
    expect(detail?.items).toHaveLength(1);

    cleanup();
  });

  it("restoreQuoteFromVersion rebuilds the draft from a past version and preserves history", () => {
    const { cleanup, database } = createTestDatabase("bukowski-quote-restore");
    const reads = createQuoteReadService(database);
    const mutations = createQuoteMutationService(database);

    // v1: create with two items.
    const created = mutations.createQuote({
      commandId: "cmd-restore-1",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      ...buildHeader(),
      items: [
        { sortOrder: 1, quantity: 5, title: "DIT operator", unitPrice: 8000, taxBehavior: "follows_quote" },
        { sortOrder: 2, quantity: 1, title: "Backup drives", unitPrice: 25000, taxBehavior: "follows_quote" },
      ],
    });

    // v2: edit — drop second item, bump first item's price.
    mutations.updateQuote({
      commandId: "cmd-restore-2",
      workspaceId: "workspace-metadata",
      quoteId: created.quoteId,
      ...baseChannel,
      ...buildHeader({ observations: "Updated to a smaller scope." }),
      items: [
        { sortOrder: 1, quantity: 5, title: "DIT operator", unitPrice: 9000, taxBehavior: "follows_quote" },
      ],
      changeSummary: "Removed backup drives.",
    });

    const versionsAfterUpdate = reads.listQuoteVersions("workspace-metadata", created.quoteId);
    expect(versionsAfterUpdate).toHaveLength(2);
    // listQuoteVersions returns DESC: [v2, v1].
    expect(versionsAfterUpdate[0]?.versionNumber).toBe(2);
    expect(versionsAfterUpdate[1]?.versionNumber).toBe(1);

    // Restore back to v1 — must produce v3 on top.
    const restored = mutations.restoreQuoteFromVersion({
      commandId: "cmd-restore-3",
      workspaceId: "workspace-metadata",
      quoteId: created.quoteId,
      versionNumber: 1,
      ...baseChannel,
    });
    expect(restored.summary).toContain("v1");

    // Live row should now match v1's content (two items, original price).
    const detailAfterRestore = reads.getQuoteDetail("workspace-metadata", created.quoteId);
    expect(detailAfterRestore?.items).toHaveLength(2);
    expect(detailAfterRestore?.items.find((i) => i.title === "DIT operator")?.unitPrice).toBe(8000);

    // History must include v1, v2, and the new v3.
    const versionsAfterRestore = reads.listQuoteVersions("workspace-metadata", created.quoteId);
    expect(versionsAfterRestore.map((v) => v.versionNumber)).toEqual([3, 2, 1]);
    expect(versionsAfterRestore[0]?.changeSummary).toBe("Restored from v1");

    // Idempotency: replaying the same restore command returns repeated=true.
    const replay = mutations.restoreQuoteFromVersion({
      commandId: "cmd-restore-3",
      workspaceId: "workspace-metadata",
      quoteId: created.quoteId,
      versionNumber: 1,
      ...baseChannel,
    });
    expect(replay.repeated).toBe(true);

    cleanup();
  });

  it("expires overdue draft and sent quotes", () => {
    const { cleanup, database } = createTestDatabase("bukowski-quote-expire");
    const mutations = createQuoteMutationService(database);

    mutations.createQuote({
      commandId: "cmd-expire-1",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      ...buildHeader({ quoteDate: "2026-01-01", validityDays: 5 }),
      items: [{ sortOrder: 1, quantity: 1, title: "Old", unitPrice: 100, taxBehavior: "exempt" }],
    });

    const result = mutations.expireOverdueQuotes("workspace-metadata", "2026-05-04");
    expect(result.expiredCount).toBeGreaterThanOrEqual(1);

    cleanup();
  });
});
