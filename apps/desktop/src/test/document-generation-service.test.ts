import { expect, test } from "vitest";

import { createDocumentGenerationService } from "../../electron/main/services/data/documentGenerationService";

test("document generation service creates a packing slip pdf buffer", async () => {
  const service = createDocumentGenerationService();

  const result = await service.createPackingSlipPdf({
    slipNumber: "PS-2026-0412",
    projectCode: "AUR",
    projectName: "Aurora Campaign",
    departmentCode: "PROD",
    departmentName: "Production",
    responsibleName: "Ana Guerrero",
    preparedByName: "Ops Desk",
    issueDate: "2026-04-12",
    issueDateCompact: "12042026",
    dueDate: "2026-04-14",
    status: "Issued",
    notes: "Confirm camera bodies before transport.",
    primaryCodeValue: "packing-slip-0412",
    summary: {
      itemCount: 2,
      returnedCount: 1,
      pendingCount: 1,
    },
    items: [
      {
        code: "CAM-001",
        name: "Cinema Camera",
        serialNumber: "SN-CAM-001",
        quantity: 1,
        conditionOut: "Good",
        conditionIn: "Good",
        location: "Warehouse A",
        responsible: "Ana Guerrero",
        status: "Returned",
      },
      {
        code: "LGT-101",
        name: "Key Light",
        serialNumber: "SN-LGT-101",
        quantity: 2,
        conditionOut: "Good",
        conditionIn: "",
        location: "Truck 3",
        responsible: "Carlos Pena",
        status: "Out",
      },
    ],
  });

  expect(result.fileName).toBe("PS-2026-0412_AUR_Aurora Campaign_PROD_Packing_12042026.pdf");
  expect(result.mimeType).toBe("application/pdf");
  expect(result.buffer.length).toBeGreaterThan(1000);
  expect(result.buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
});

test("document generation service creates an insurance list pdf buffer", async () => {
  const service = createDocumentGenerationService();

  const result = await service.createPackingSlipInsurancePdf({
    slipNumber: "PS-2026-0412",
    projectCode: "AUR",
    projectName: "Aurora Campaign",
    departmentCode: "PROD",
    departmentName: "Production",
    responsibleName: "Ana Guerrero",
    preparedByName: "Ops Desk",
    issueDate: "2026-04-12",
    issueDateCompact: "12042026",
    dueDate: "2026-04-14",
    status: "Issued",
    notes: "Confirm camera bodies before transport.",
    primaryCodeValue: "packing-slip-0412",
    summary: {
      itemCount: 2,
      returnedCount: 1,
      pendingCount: 1,
      insuredTotal: "$9,200",
    },
    items: [
      {
        code: "CAM-001",
        name: "Cinema Camera",
        serialNumber: "SN-CAM-001",
        quantity: 1,
        purchasePriceAmount: 6800,
        additionalCostsAmount: 400,
        unitInsuredValueAmount: 7200,
        insuredTotalAmount: 7200,
        conditionOut: "Good",
        conditionIn: "Good",
        location: "Warehouse A",
        responsible: "Ana Guerrero",
        status: "Returned",
      },
      {
        code: "LGT-101",
        name: "Key Light",
        serialNumber: "SN-LGT-101",
        quantity: 2,
        purchasePriceAmount: 800,
        additionalCostsAmount: 120,
        unitInsuredValueAmount: 1000,
        insuredTotalAmount: 2000,
        conditionOut: "Good",
        conditionIn: "",
        location: "Truck 3",
        responsible: "Carlos Pena",
        status: "Out",
      },
    ],
  });

  expect(result.fileName).toBe("IL-2026-0412_AUR_Aurora Campaign_PROD_Packing_12042026.pdf");
  expect(result.mimeType).toBe("application/pdf");
  expect(result.buffer.length).toBeGreaterThan(1000);
  expect(result.buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
});

test("document generation service creates a finance report pdf buffer", async () => {
  const service = createDocumentGenerationService();

  const result = await service.createFinanceReportPdf({
    reportTitle: "Finance operating report",
    periodLabel: "This quarter",
    generatedAt: "Generated 2026-04-12 21:02",
    workspaceLabel: "Internal alpha",
    executiveSummary: "$24,200 tracked spend, $12,800 incident exposure and $6,000 reserve coverage in this quarter.",
    metrics: [
      { label: "Incident exposure", value: "$12,800" },
      { label: "Replacement at risk", value: "$36,400" },
      { label: "Tracked spend", value: "$24,200" },
    ],
    totals: [
      { label: "Tracked spend", value: "$24,200", tone: "info" },
      { label: "Incident exposure", value: "$12,800", tone: "critical" },
      { label: "Reserve coverage", value: "$6,000", tone: "warning" },
      { label: "Average burn rate", value: "$8,066", tone: "neutral" },
    ],
    exposureByProject: [
      { project: "Aurora Campaign", exposure: "$9,200", incidentCount: 3, assetsOut: "$18,000" },
      { project: "Archipielado", exposure: "$3,600", incidentCount: 1, assetsOut: "$8,200" },
    ],
    categoryBreakdown: [
      { category: "Transport", amount: "$11,000", percentage: 45.5 },
      { category: "Repair", amount: "$7,800", percentage: 32.2 },
    ],
    pendingCostLinks: [
      {
        incident: "Lens replacement",
        project: "Aurora Campaign",
        severity: "High",
        costEstimate: "$3,600",
        financialStatus: "Missing entry",
      },
    ],
  });

  expect(result.fileName).toBe("bukowski-finance-report.pdf");
  expect(result.mimeType).toBe("application/pdf");
  expect(result.buffer.length).toBeGreaterThan(1000);
  expect(result.buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
});

test("document generation service creates an invoice pdf buffer", async () => {
  const service = createDocumentGenerationService();

  const result = await service.createInvoicePdf({
    invoiceNumber: "INV-2026-0001",
    ncf: "B0100000001",
    status: "ISSUED",
    issueDate: "15/05/2026",
    dueDate: "30/05/2026",
    sourceQuoteNumber: "Q-2026-8400",
    workspace: {
      legalName: "METADATA CINE S.R.L.",
      rnc: "131-20642-5",
      sirecineNumber: "SIRE-001",
      addressLines: ["Calle Central #27", "Santo Domingo"],
      phone: "(809) 424-4533",
      web: "www.metadatacine.net",
      email: "info@metadatacine.com",
      logoBuffer: null,
    },
    client: {
      name: "Ana Guerrero",
      rnc: "001-0000000-0",
      attentionName: "Ana Guerrero",
      phone: "(809) 555-0000",
      productionName: "Shiver",
      productionCompanyName: "Fiction House",
      projectName: "Shiver",
      pur: "PUR-2026",
    },
    currency: { code: "DOP", symbol: "RD$" },
    exchangeRate: {
      rate: 1,
      source: "manual",
      effectiveDate: "15/05/2026",
    },
    items: [
      {
        quantity: 2,
        title: "DIT / Data Cart Package",
        description: "Camera media ingest, backup and editorial handoff.",
        durationValue: 3,
        durationUnit: "day",
        unitPrice: 12000,
        discountAmount: 0,
        taxAmount: 12960,
        lineTotal: 84960,
      },
    ],
    totals: {
      subtotal: 72000,
      discountAmount: 0,
      taxAmount: 12960,
      total: 84960,
      paid: 20000,
      outstanding: 64960,
    },
    payments: [
      {
        paidAt: "20/05/2026",
        amount: 20000,
        method: "Transfer",
        reference: "BPD-123",
      },
    ],
    observations: "Pago inicial recibido. Balance pendiente antes de entrega final.",
  });

  expect(result.fileName).toBe("Factura_INV-2026-0001_Ana Guerrero_B0100000001.pdf");
  expect(result.mimeType).toBe("application/pdf");
  expect(result.buffer.length).toBeGreaterThan(1000);
  expect(result.buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
});
