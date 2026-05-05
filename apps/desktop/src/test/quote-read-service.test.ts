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
  clientRncSnapshot: null,
  productionCompanyId: null,
  productionCompanyNameSnapshot: null,
  productionPurSnapshot: null,
  workspaceSirecineSnapshot: null,
  attentionName: null,
  attentionPhone: null,
  projectId: null,
  projectNameSnapshot: null,
  productionName: null,
  description: null,
  packageTitle: "DIT package",
  currency: "DOP",
  baseCurrency: "DOP",
  exchangeRate: 1,
  exchangeRateSource: "manual" as const,
  exchangeRateType: "manual" as const,
  exchangeRateEffectiveDate: null,
  taxProfile: "standard_itbis" as const,
  itbisRate: 0.18,
  taxAddedToTotal: true,
  ...overrides,
});

describe("quote read service", () => {
  it("lists quotes with status, search and date filters", () => {
    const { cleanup, database } = createTestDatabase("bukowski-quote-read-list");
    const reads = createQuoteReadService(database);
    const mutations = createQuoteMutationService(database);

    const altitude = mutations.createQuote({
      commandId: "cmd-list-1",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      ...buildHeader({ clientNameSnapshot: "Altitude Pictures" }),
      items: [{ sortOrder: 1, quantity: 1, title: "DIT", unitPrice: 5000, taxBehavior: "taxable" }],
    });
    const aurora = mutations.createQuote({
      commandId: "cmd-list-2",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      ...buildHeader({ clientNameSnapshot: "Aurora Films", projectNameSnapshot: "Aurora Series" }),
      items: [{ sortOrder: 1, quantity: 1, title: "Backup", unitPrice: 3000, taxBehavior: "taxable" }],
    });

    // Move altitude to "sent" so we can filter by status.
    mutations.setStatus({
      commandId: "cmd-list-status",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      quoteId: altitude.quoteId,
      status: "sent",
    });

    // No filter — returns both
    expect(reads.listQuotes({ workspaceId: "workspace-metadata" })).toHaveLength(2);

    // Status filter — only sent
    const sentOnly = reads.listQuotes({ workspaceId: "workspace-metadata", status: "sent" });
    expect(sentOnly).toHaveLength(1);
    expect(sentOnly[0]?.id).toBe(altitude.quoteId);

    // Search — matches client name
    const auroraOnly = reads.listQuotes({ workspaceId: "workspace-metadata", search: "Aurora" });
    expect(auroraOnly).toHaveLength(1);
    expect(auroraOnly[0]?.id).toBe(aurora.quoteId);

    // Search — matches project name
    expect(
      reads.listQuotes({ workspaceId: "workspace-metadata", search: "Series" }).length,
    ).toBeGreaterThan(0);

    // Date filter — date_from after both
    expect(
      reads.listQuotes({ workspaceId: "workspace-metadata", dateFrom: "2027-01-01" }),
    ).toHaveLength(0);

    cleanup();
  });

  it("returns null when quote does not exist and a full detail when it does", () => {
    const { cleanup, database } = createTestDatabase("bukowski-quote-read-detail");
    const reads = createQuoteReadService(database);
    const mutations = createQuoteMutationService(database);

    expect(reads.getQuoteDetail("workspace-metadata", "missing")).toBeNull();

    const created = mutations.createQuote({
      commandId: "cmd-detail",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      ...buildHeader(),
      items: [
        { sortOrder: 1, quantity: 2, title: "DIT", unitPrice: 8000, taxBehavior: "taxable" },
        { sortOrder: 2, quantity: 1, title: "Backup", unitPrice: 5000, taxBehavior: "taxable" },
      ],
    });

    const detail = reads.getQuoteDetail("workspace-metadata", created.quoteId);
    expect(detail).not.toBeNull();
    expect(detail?.items).toHaveLength(2);
    expect(detail?.items[0]?.sortOrder).toBe(1);
    expect(detail?.items[0]?.title).toBe("DIT");
    expect(detail?.subtotalAmount).toBe(21000);
    expect(detail?.taxAddedToTotal).toBe(true);
    expect(detail?.totalAmount).toBe(24780);

    cleanup();
  });

  it("scopes results to the requested workspace", () => {
    const { cleanup, database } = createTestDatabase("bukowski-quote-read-scope");
    const reads = createQuoteReadService(database);
    const mutations = createQuoteMutationService(database);

    mutations.createQuote({
      commandId: "cmd-scope-1",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      ...buildHeader(),
      items: [{ sortOrder: 1, quantity: 1, title: "X", unitPrice: 100, taxBehavior: "exempt" }],
    });

    // A different workspace id returns no results, even when the quote exists.
    expect(reads.listQuotes({ workspaceId: "workspace-other" })).toHaveLength(0);

    cleanup();
  });
});
