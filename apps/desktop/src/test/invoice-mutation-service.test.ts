import { describe, expect, it } from "vitest";

import { createInvoiceMutationService } from "../../electron/main/services/data/invoiceMutationService";
import { createInvoiceReadService } from "../../electron/main/services/data/invoiceReadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const baseChannel = { actorType: "user" as const, sourceChannel: "desktop" as const };

const buildInvoice = (commandId: string, overrides: Record<string, unknown> = {}) => ({
  commandId,
  workspaceId: "workspace-metadata",
  ...baseChannel,
  sourceQuoteId: null,
  issueDate: "2026-05-04",
  paymentTermsDays: 30,
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
  taxNotes: null,
  discountRate: null,
  discountAmount: null,
  observations: null,
  items: [{ sortOrder: 1, quantity: 1, title: "DIT operator", unitPrice: 8000, taxBehavior: "taxable" as const }],
  ...overrides,
});

describe("invoice mutation service", () => {
  it("creates and updates a manual draft invoice with line items", () => {
    const { cleanup, database } = createTestDatabase("bukowski-invoice-manual-draft");
    const reads = createInvoiceReadService(database);
    const mutations = createInvoiceMutationService(database);

    const created = mutations.createInvoice(buildInvoice("cmd-manual-invoice-create", {
      clientNameSnapshot: "Manual Client",
      sourceQuoteId: null,
      items: [
        { sortOrder: 1, quantity: 2, title: "DIT package", unitPrice: 12000, taxBehavior: "taxable" as const },
        { sortOrder: 2, quantity: 1, title: "Data wrangling", unitPrice: 8000, taxBehavior: "taxable" as const },
      ],
    }));

    const draft = reads.getInvoiceDetail("workspace-metadata", created.invoiceId);
    expect(draft?.status).toBe("draft");
    expect(draft?.sourceQuoteId).toBeNull();
    expect(draft?.items).toHaveLength(2);
    expect(draft?.totalAmount).toBeGreaterThan(0);

    mutations.updateInvoice({
      ...buildInvoice("cmd-manual-invoice-update", {
        clientNameSnapshot: "Manual Client Updated",
        items: [{ sortOrder: 1, quantity: 3, title: "Updated package", unitPrice: 9000, taxBehavior: "taxable" as const }],
      }),
      invoiceId: created.invoiceId,
    });

    const updated = reads.getInvoiceDetail("workspace-metadata", created.invoiceId);
    expect(updated?.clientNameSnapshot).toBe("Manual Client Updated");
    expect(updated?.items).toHaveLength(1);
    expect(updated?.items[0]?.quantity).toBe(3);

    cleanup();
  });

  it("renumbers invoices without touching NCF and advances the next sequence", () => {
    const { cleanup, database } = createTestDatabase("bukowski-invoice-renumber");
    const reads = createInvoiceReadService(database);
    const mutations = createInvoiceMutationService(database);

    const first = mutations.createInvoice(buildInvoice("cmd-renumber-invoice-1"));
    const second = mutations.createInvoice(buildInvoice("cmd-renumber-invoice-2"));

    const renumbered = mutations.renumberInvoice({
      commandId: "cmd-renumber-invoice-3",
      workspaceId: "workspace-metadata",
      ...baseChannel,
      invoiceId: first.invoiceId,
      invoiceNumber: "2026-42",
    });

    expect(renumbered.invoiceNumber).toBe("2026-0042");
    expect(reads.getInvoiceDetail("workspace-metadata", first.invoiceId)?.invoiceNumber).toBe("2026-0042");
    expect(reads.getInvoiceDetail("workspace-metadata", first.invoiceId)?.ncf).toBeNull();
    expect(() =>
      mutations.renumberInvoice({
        commandId: "cmd-renumber-invoice-duplicate",
        workspaceId: "workspace-metadata",
        ...baseChannel,
        invoiceId: first.invoiceId,
        invoiceNumber: second.invoiceNumber,
      }),
    ).toThrow(/already in use/);

    const next = mutations.createInvoice(buildInvoice("cmd-renumber-invoice-4"));

    expect(next.invoiceNumber).toBe("2026-0043");

    cleanup();
  });
});
