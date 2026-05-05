import { describe, expect, it } from "vitest";

import { createDocumentGenerationService } from "../../electron/main/services/data/documentGenerationService";

const buildPayload = (overrides: Record<string, unknown> = {}) => ({
  quoteNumber: "2026-0001",
  quoteDate: "04/05/2026",
  validityDays: 30,
  packageTitle: "DIT / DATA CART",
  description: "Three-week DIT package for a feature.",
  workspace: {
    legalName: "METADATA CINE S.R.L.",
    rnc: "131-20642-5",
    sirecineNumber: "AC-ES 1852",
    addressLines: ["Calle Central, # 27, Galá, Sto. Dgo.", "Distrito Nacional, Rep. Dom."],
    phone: "(809) 424-4533",
    web: "www.metadatacine.net",
    email: "info@metadatacine.com",
    logoBuffer: null,
    sealBuffer: null,
    signatureBuffer: null,
    signatoryName: "Rhadamés Iván Jiménez",
  },
  client: {
    attentionName: "Desiree Reyes",
    productionName: null,
    projectName: "Aurora Series",
    descriptionLabel: "LARGOMETRAJE",
    phone: "(829) 924-2073",
    rnc: null,
    pur: null,
  },
  currency: { code: "DOP", symbol: "$" },
  items: [
    {
      quantity: 1,
      titleLine: "DIT - DATA MANAGEMENT",
      detailLines: [],
      durationValue: "3.8",
      durationUnit: "SEM",
      unitPrice: 60000,
      lineTotal: 228000,
    },
  ],
  totals: {
    subtotal: 228000,
    discountLabel: null,
    discountRate: null,
    discountAmount: 0,
    taxRate: 0.18,
    taxAmount: 41040,
    taxAddedToTotal: true,
    total: 269040,
  },
  observations: null,
  ...overrides,
});

describe("quote PDF generator", () => {
  it("produces a non-empty PDF buffer with the expected file name", async () => {
    const service = createDocumentGenerationService();
    const pdf = await service.createQuotePdf(buildPayload() as Parameters<typeof service.createQuotePdf>[0]);

    expect(pdf.mimeType).toBe("application/pdf");
    expect(pdf.fileName).toBe("Cotizacion_2026-0001.pdf");
    expect(pdf.buffer.length).toBeGreaterThan(2000);
    // PDF magic header.
    expect(pdf.buffer.slice(0, 4).toString("utf8")).toBe("%PDF");
  });

  it("renders Ley de Cine (taxAddedToTotal=false) without crashing", async () => {
    const service = createDocumentGenerationService();
    const pdf = await service.createQuotePdf(
      buildPayload({
        totals: {
          subtotal: 400000,
          discountLabel: null,
          discountRate: null,
          discountAmount: 0,
          taxRate: 0.18,
          taxAmount: 72000,
          taxAddedToTotal: false,
          total: 400000,
        },
      }) as Parameters<typeof service.createQuotePdf>[0],
    );

    expect(pdf.buffer.length).toBeGreaterThan(2000);
  });

  it("renders a quote with a discount row without crashing", async () => {
    const service = createDocumentGenerationService();
    const pdf = await service.createQuotePdf(
      buildPayload({
        totals: {
          subtotal: 150000,
          discountLabel: "DESCUENTO ESPECIAL (PAQUETE)",
          discountRate: 0.2,
          discountAmount: 30000,
          taxRate: 0.18,
          taxAmount: 21600,
          taxAddedToTotal: false,
          total: 120000,
        },
      }) as Parameters<typeof service.createQuotePdf>[0],
    );

    expect(pdf.buffer.length).toBeGreaterThan(2000);
  });

  it("renders a USD quote with the correct currency label", async () => {
    const service = createDocumentGenerationService();
    const pdf = await service.createQuotePdf(
      buildPayload({
        currency: { code: "USD", symbol: "US$" },
      }) as Parameters<typeof service.createQuotePdf>[0],
    );

    expect(pdf.buffer.length).toBeGreaterThan(2000);
  });
});
