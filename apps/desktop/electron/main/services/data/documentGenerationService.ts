import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

type PackingSlipPdfPayload = {
  slipNumber: string;
  projectCode: string;
  projectName: string;
  departmentCode: string;
  departmentName: string;
  responsibleName: string;
  preparedByName: string;
  issueDate: string;
  issueDateCompact: string;
  dueDate: string;
  status: string;
  notes: string;
  primaryCodeValue: string;
  summary: {
    itemCount: number;
    returnedCount: number;
    pendingCount: number;
  };
  items: Array<{
    code: string;
    name: string;
    serialNumber: string;
    quantity: number;
    conditionOut: string;
    conditionIn: string;
    location: string;
    responsible: string;
    status: string;
  }>;
};

type PackingSlipInsurancePdfPayload = Omit<PackingSlipPdfPayload, "summary" | "items"> & {
  summary: PackingSlipPdfPayload["summary"] & {
    insuredTotal: string;
  };
  items: Array<PackingSlipPdfPayload["items"][number] & {
    purchasePriceAmount: number | null;
    additionalCostsAmount: number | null;
    unitInsuredValueAmount: number | null;
    insuredTotalAmount: number | null;
  }>;
};

type FinanceReportPdfPayload = {
  reportTitle: string;
  periodLabel: string;
  generatedAt: string;
  workspaceLabel: string;
  executiveSummary: string;
  metrics: Array<{
    label: string;
    value: string;
  }>;
  totals: Array<{
    label: string;
    value: string;
    tone?: "info" | "warning" | "critical" | "neutral";
  }>;
  exposureByProject: Array<{
    project: string;
    exposure: string;
    incidentCount: number;
    assetsOut: string;
  }>;
  categoryBreakdown: Array<{
    category: string;
    amount: string;
    percentage: number;
  }>;
  pendingCostLinks: Array<{
    incident: string;
    project: string;
    severity: string;
    costEstimate: string;
    financialStatus: string;
  }>;
};

export type QuotePdfPayload = {
  quoteNumber: string;
  quoteDate: string; // dd/mm/yyyy
  validityDays: number;
  packageTitle: string | null;
  description: string | null;
  workspace: {
    legalName: string;
    rnc: string;
    sirecineNumber: string | null;
    addressLines: string[];
    phone: string;
    web: string;
    email: string;
    logoBuffer: Buffer | null;
    sealBuffer: Buffer | null;
    signatureBuffer: Buffer | null;
    signatoryName: string;
  };
  client: {
    attentionName: string | null;
    productionName: string | null;
    projectName: string | null;
    descriptionLabel: string | null;
    phone: string | null;
    rnc: string | null;
    pur: string | null;
  };
  currency: {
    code: string; // DOP / USD / EUR
    symbol: string; // $ / US$ / €
  };
  items: Array<{
    quantity: number;
    titleLine: string;
    detailLines: string[];
    durationValue: string | null;
    durationUnit: string | null;
    unitPrice: number;
    lineTotal: number;
  }>;
  totals: {
    subtotal: number;
    discountLabel: string | null; // e.g., "DESCUENTO ESPECIAL (PAQUETE)"
    discountRate: number | null; // 0.20
    discountAmount: number; // negative or zero
    taxRate: number; // 0.18
    taxAmount: number; // computed ITBIS in DOP
    taxAddedToTotal: boolean;
    total: number;
  };
  observations: string | null;
};

export type InvoicePdfPayload = {
  invoiceNumber: string;
  ncf: string | null;
  status: string;
  issueDate: string;
  dueDate: string | null;
  sourceQuoteNumber: string | null;
  workspace: {
    legalName: string;
    rnc: string;
    sirecineNumber: string | null;
    addressLines: string[];
    phone: string;
    web: string;
    email: string;
    logoBuffer: Buffer | null;
  };
  client: {
    name: string;
    rnc: string | null;
    attentionName: string | null;
    phone: string | null;
    productionName: string | null;
    productionCompanyName: string | null;
    projectName: string | null;
    pur: string | null;
  };
  currency: {
    code: string;
    symbol: string;
  };
  exchangeRate: {
    rate: number;
    source: string;
    effectiveDate: string | null;
  };
  items: Array<{
    quantity: number;
    title: string;
    description: string | null;
    durationValue: number | null;
    durationUnit: string | null;
    unitPrice: number;
    discountAmount: number;
    taxAmount: number;
    lineTotal: number;
  }>;
  totals: {
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
    total: number;
    paid: number;
    outstanding: number;
  };
  payments: Array<{
    paidAt: string;
    amount: number;
    method: string | null;
    reference: string | null;
  }>;
  observations: string | null;
};

type ProjectSetupSummaryPdfPayload = {
  projectCode: string;
  projectName: string;
  status: string;
  windowLabel: string;
  preproductionLabel: string | null;
  clientName: string;
  productionCompanyName: string;
  description: string;
  packingSourceLabel: string;
  totals: {
    assetCount: number;
    crewCount: number;
    additionalUnitCount: number;
  };
  mainUnit: {
    assetNames: string[];
    crewNames: string[];
  };
  additionalUnits: Array<{
    name: string;
    dateLabel: string;
    assetCount: number;
    crewCount: number;
    assetNames: string[];
    crewNames: string[];
  }>;
  conflictGroups: Array<{
    title: string;
    items: Array<{
      resourceLabel: string;
      conflictingProject: string;
      conflictingUnit: string | null;
      overlapLabel: string;
    }>;
  }>;
};

const collectPdfBuffer = (document: PDFKit.PDFDocument) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];

    document.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);

const loadOptionalAssetBuffer = (relativePath: string) => {
  const normalizedRelativePath = relativePath.replace(/^apps\/desktop\//, "");
  const candidates = [
    path.resolve(process.cwd(), relativePath),
    path.resolve(process.cwd(), normalizedRelativePath),
    path.resolve(currentDirPath, "../", normalizedRelativePath),
    path.resolve(currentDirPath, "../../", normalizedRelativePath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate);
    }
  }

  return null;
};

const metadataLogoBuffer =
  loadOptionalAssetBuffer("apps/desktop/src/shared/assets/inbox/logos/metadata-logo-black@2x.png") ??
  loadOptionalAssetBuffer("apps/desktop/electron/main/assets/logos/metadata-cine-logo.png");

const formatPdfCurrency = (value: number | null | undefined) =>
  typeof value === "number"
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value)
    : "—";

const sanitizePdfFileNamePart = (value: string | null | undefined, fallback: string) => {
  const sanitized = (value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ");

  return sanitized || fallback;
};

const buildPackingSlipPdfFileName = (payload: PackingSlipPdfPayload, prefix: "PS" | "IL") => {
  const slipNumericId = payload.slipNumber.replace(/^PS[-_\s]*/i, "");
  const slipLabel = `${prefix}-${sanitizePdfFileNamePart(slipNumericId, payload.slipNumber)}`;
  const projectCode = sanitizePdfFileNamePart(payload.projectCode, "NO-PROJECT");
  const projectName = sanitizePdfFileNamePart(payload.projectName, "Unassigned");
  const departmentCode = sanitizePdfFileNamePart(payload.departmentCode, "NO-DEPT");
  const issuedDate = sanitizePdfFileNamePart(payload.issueDateCompact, "undated");

  return `${slipLabel}_${projectCode}_${projectName}_${departmentCode}_Packing_${issuedDate}.pdf`;
};

const buildInvoicePdfFileName = (payload: InvoicePdfPayload) => {
  const invoiceNumber = sanitizePdfFileNamePart(payload.invoiceNumber, "invoice");
  const client = sanitizePdfFileNamePart(payload.client.name, "client");
  const ncf = sanitizePdfFileNamePart(payload.ncf, "draft");

  return `Factura_${invoiceNumber}_${client}_${ncf}.pdf`;
};

const drawMetadataLogo = (document: PDFKit.PDFDocument, x: number, y: number, color = "#141619") => {
  if (metadataLogoBuffer) {
    document.image(metadataLogoBuffer, x, y, {
      fit: [66, 46],
    });
    return;
  }

  document.font("Helvetica-Bold").fillColor(color).fontSize(16).text("META", x, y, {
    width: 66,
    characterSpacing: 1.4,
    lineBreak: false,
  });
  document.text("DATA", x, y + 15, {
    width: 66,
    characterSpacing: 1.4,
    lineBreak: false,
  });
  document.font("Helvetica").fontSize(7).text("C I N E", x + 2, y + 34, {
    width: 60,
    characterSpacing: 4,
    lineBreak: false,
  });
};

export const createDocumentGenerationService = () => ({
  async createPackingSlipPdf(payload: PackingSlipPdfPayload) {
    const qrBuffer = await QRCode.toBuffer(payload.primaryCodeValue, {
      margin: 1,
      width: 240,
      color: {
        dark: "#141619",
        light: "#ffffff",
      },
    });

    const document = new PDFDocument({
      margin: 40,
      size: "A4",
    });
    const bufferPromise = collectPdfBuffer(document);

    const pageWidth = document.page.width - document.page.margins.left - document.page.margins.right;
    const cardWidth = pageWidth;
    const cardLeft = document.page.margins.left;
    const top = document.page.margins.top;
    const surfaceBorder = "#d7dbe2";
    const surfaceMuted = "#6c7585";
    const surfaceText = "#1a2029";
    const surfaceBackground = "#f7f8fa";
    const accentBackground = "#141619";
    const columnGap = 16;
    const headerHeight = 78;
    const footerReserve = 124;
    let cursorY = top + headerHeight + 18;

    const ensurePageSpace = (spaceNeeded: number) => {
      if (cursorY + spaceNeeded <= document.page.height - document.page.margins.bottom) {
        return;
      }

      document.addPage();
      cursorY = document.page.margins.top;
    };

    const drawSectionHeading = (title: string, subtitle?: string) => {
      ensurePageSpace(40);
      document.fillColor(surfaceText).fontSize(11).text(title, cardLeft, cursorY, { width: cardWidth });
      cursorY += 15;

      if (subtitle) {
        document.fillColor(surfaceMuted).fontSize(8).text(subtitle, cardLeft, cursorY, { width: cardWidth });
        cursorY += 14;
      }
    };

    const groupedItems = Array.from(
      payload.items.reduce<
        Map<
          string,
          {
            name: string;
            code: string;
            location: string;
            quantity: number;
            serialNumbers: string[];
          }
        >
      >((map, item) => {
        const key = [item.code, item.name, item.location || "—"].join("::");
        const existing = map.get(key);

        if (existing) {
          existing.quantity += item.quantity;
          if (item.serialNumber && item.serialNumber !== "—" && !existing.serialNumbers.includes(item.serialNumber)) {
            existing.serialNumbers.push(item.serialNumber);
          }
          return map;
        }

        map.set(key, {
          name: item.name,
          code: item.code,
          location: item.location || "—",
          quantity: item.quantity,
          serialNumbers: item.serialNumber && item.serialNumber !== "—" ? [item.serialNumber] : [],
        });
        return map;
      }, new Map()),
    ).map(([, item]) => ({
      ...item,
      serialLabel: item.serialNumbers.length ? item.serialNumbers.join(" · ") : "—",
    }));

    document.roundedRect(cardLeft, top, cardWidth, headerHeight, 16).strokeColor(accentBackground).lineWidth(1.1).stroke();
    drawMetadataLogo(document, cardLeft + 20, top + 16);

    const slipInfoX = cardLeft + 112;
    document.fillColor(surfaceMuted).fontSize(8).text("PACKING SLIP", slipInfoX, top + 18, {
      width: 180,
      characterSpacing: 1.1,
      lineBreak: false,
    });
    document.fillColor(surfaceText).fontSize(20).text(payload.slipNumber, slipInfoX, top + 31, {
      width: 180,
      lineBreak: false,
      ellipsis: true,
    });
    document.fillColor(surfaceMuted).fontSize(8).text("Crew handoff / return control", slipInfoX, top + 56, {
      width: 220,
      lineBreak: false,
      ellipsis: true,
    });
    document.image(qrBuffer, cardLeft + cardWidth - 70, top + 14, {
      width: 50,
      height: 50,
    });

    const drawMetaRow = (label: string, value: string, x: number, y: number, width: number) => {
      document.fillColor(surfaceMuted).fontSize(7.5).text(label.toUpperCase(), x, y, {
        width,
        characterSpacing: 0.9,
        lineBreak: false,
        ellipsis: true,
      });
      document.fillColor(surfaceText).fontSize(9.5).text(value || "—", x, y + 12, {
        width,
        lineBreak: false,
        ellipsis: true,
      });
    };

    const metaColumnWidth = Math.floor((cardWidth - columnGap * 2) / 3);

    drawMetaRow("Project", payload.projectName, cardLeft, cursorY, metaColumnWidth);
    drawMetaRow("Department", payload.departmentName, cardLeft + metaColumnWidth + columnGap, cursorY, metaColumnWidth);
    drawMetaRow("Responsible", payload.responsibleName, cardLeft + (metaColumnWidth + columnGap) * 2, cursorY, metaColumnWidth);

    cursorY += 34;
    drawMetaRow("Prepared by", payload.preparedByName, cardLeft, cursorY, metaColumnWidth);
    drawMetaRow("Issued / due", `${payload.issueDate} -> ${payload.dueDate}`, cardLeft + metaColumnWidth + columnGap, cursorY, metaColumnWidth);
    drawMetaRow("Items", String(payload.summary.itemCount), cardLeft + (metaColumnWidth + columnGap) * 2, cursorY, metaColumnWidth);

    cursorY += 42;

    drawSectionHeading("Issued items", "Grouped view of the exact assets linked to this slip.");

    const tableInset = 10;
    const tableContentWidth = cardWidth - tableInset * 2;
    const columns = [
      { label: "Qty", width: 48, align: "right" as const },
      { label: "Asset", width: 160, align: "left" as const },
      { label: "Code", width: 86, align: "left" as const },
      { label: "Serial", width: 108, align: "left" as const },
      { label: "Location", width: tableContentWidth - 48 - 160 - 86 - 108, align: "left" as const },
    ] as const;

    const drawTableHeader = () => {
      ensurePageSpace(42);
      const headerHeight = 24;
      document.roundedRect(cardLeft, cursorY, cardWidth, headerHeight, 8).fill(accentBackground);
      let x = cardLeft + tableInset;
      columns.forEach((column) => {
        document.font("Helvetica-Bold");
        document.fillColor("#eef2f8").fontSize(7.4).text(column.label, x, cursorY + 8, {
          width: column.width - 10,
          align: column.align,
          lineBreak: false,
          ellipsis: true,
        });
        document.font("Helvetica");
        x += column.width;
      });
      cursorY += headerHeight + 9;
    };

    drawTableHeader();

    if (!groupedItems.length) {
      document.roundedRect(cardLeft, cursorY - 2, cardWidth, 42, 10).fillAndStroke(surfaceBackground, surfaceBorder);
      document.fillColor(surfaceMuted).fontSize(10).text("No issued items are linked to this packing slip yet.", cardLeft + 14, cursorY + 12, {
        width: cardWidth - 28,
      });
      cursorY += 54;
    } else {
      groupedItems.forEach((item, index) => {
        const rowValues = [
          String(item.quantity),
          item.name,
          item.code || "—",
          item.serialLabel,
          item.location,
        ];
        const contentHeights = rowValues.map((value, valueIndex) => {
          const isPrimaryCell = valueIndex === 1;
          document.font(isPrimaryCell ? "Helvetica-Bold" : "Helvetica").fontSize(isPrimaryCell ? 8.4 : 7.8);
          return document.heightOfString(value, {
            width: columns[valueIndex]!.width - 14,
            align: columns[valueIndex]!.align,
            lineBreak: isPrimaryCell,
          });
        });
        document.font("Helvetica");
        const rowHeight = Math.max(30, Math.ceil(Math.max(...contentHeights)) + 16);

        if (cursorY + rowHeight > document.page.height - document.page.margins.bottom - footerReserve) {
          document.addPage();
          cursorY = document.page.margins.top;
          drawTableHeader();
        }

        if (index % 2 === 0) {
          document.roundedRect(cardLeft, cursorY - 3, cardWidth, rowHeight, 8).fill(surfaceBackground);
        }

        let x = cardLeft + tableInset;
        rowValues.forEach((value, valueIndex) => {
          const isPrimaryCell = valueIndex === 1;
          document.font(isPrimaryCell ? "Helvetica-Bold" : "Helvetica");
          document.fillColor(isPrimaryCell ? "#18202a" : surfaceText).fontSize(isPrimaryCell ? 8.4 : 7.8).text(value, x, cursorY + 5, {
            width: columns[valueIndex]!.width - 14,
            align: columns[valueIndex]!.align,
            ellipsis: valueIndex !== 0 && !isPrimaryCell,
            lineBreak: valueIndex === 1,
            height: rowHeight - 8,
          });
          document.font("Helvetica");
          x += columns[valueIndex]!.width;
        });

        cursorY += rowHeight;
      });
    }

    cursorY += 14;

    if (payload.notes.trim()) {
      const notesHeight = Math.max(
        44,
        Math.ceil(
          document.heightOfString(payload.notes, {
            width: cardWidth - 28,
          }),
        ) + 24,
      );

      if (cursorY + notesHeight > document.page.height - document.page.margins.bottom - footerReserve) {
        document.addPage();
        cursorY = document.page.margins.top;
      }

      document.roundedRect(cardLeft, cursorY, cardWidth, notesHeight, 12).fillAndStroke(surfaceBackground, surfaceBorder);
      document.fillColor(surfaceMuted).fontSize(8).text("NOTES", cardLeft + 14, cursorY + 10, {
        width: cardWidth - 28,
        characterSpacing: 0.9,
      });
      document.fillColor(surfaceText).fontSize(9).text(payload.notes, cardLeft + 14, cursorY + 22, {
        width: cardWidth - 28,
      });
      cursorY += notesHeight + 14;
    }

    const signatureLabelY = document.page.height - document.page.margins.bottom - 58;
    const signatureLineY = document.page.height - document.page.margins.bottom - 22;

    if (cursorY > signatureLabelY - 18) {
      document.addPage();
      cursorY = document.page.margins.top;
    }

    const signatureWidth = Math.floor((cardWidth - columnGap) / 2);

    document.fillColor(surfaceMuted).fontSize(8).text("PREPARED BY", cardLeft, signatureLabelY, {
      width: signatureWidth,
      characterSpacing: 0.9,
    });
    document.fillColor(surfaceMuted).fontSize(8).text("RECEIVED BY", cardLeft + signatureWidth + columnGap, signatureLabelY, {
      width: signatureWidth,
      characterSpacing: 0.9,
    });

    document.moveTo(cardLeft, signatureLineY).lineTo(cardLeft + signatureWidth - 18, signatureLineY).strokeColor(surfaceBorder).lineWidth(1).stroke();
    document
      .moveTo(cardLeft + signatureWidth + columnGap, signatureLineY)
      .lineTo(cardLeft + cardWidth, signatureLineY)
      .strokeColor(surfaceBorder)
      .lineWidth(1)
      .stroke();

    document.fillColor(surfaceMuted).fontSize(8).text(payload.preparedByName || "Operations", cardLeft, signatureLineY + 6, {
      width: signatureWidth,
    });
    document.fillColor(surfaceMuted).fontSize(8).text("Name / signature", cardLeft + signatureWidth + columnGap, signatureLineY + 6, {
      width: signatureWidth,
    });

    document.end();

    return {
      fileName: buildPackingSlipPdfFileName(payload, "PS"),
      mimeType: "application/pdf" as const,
      buffer: await bufferPromise,
    };
  },

  async createPackingSlipInsurancePdf(payload: PackingSlipInsurancePdfPayload) {
    const document = new PDFDocument({
      margin: 40,
      size: "A4",
    });
    const bufferPromise = collectPdfBuffer(document);

    const pageWidth = document.page.width - document.page.margins.left - document.page.margins.right;
    const cardLeft = document.page.margins.left;
    const surfaceBorder = "#d7dbe2";
    const surfaceMuted = "#6c7585";
    const surfaceText = "#1a2029";
    const surfaceBackground = "#f7f8fa";
    const accentBackground = "#141619";
    const columnGap = 16;
    const footerReserve = 120;
    let cursorY = document.page.margins.top;

    const ensurePageSpace = (spaceNeeded: number) => {
      if (cursorY + spaceNeeded <= document.page.height - document.page.margins.bottom) {
        return;
      }

      document.addPage();
      cursorY = document.page.margins.top;
    };

    const groupedItems = Array.from(
      payload.items.reduce<
        Map<
          string,
          {
            name: string;
            code: string;
            serialNumbers: string[];
            quantity: number;
            purchasePriceAmount: number | null;
            additionalCostsAmount: number | null;
            unitInsuredValueAmount: number | null;
            insuredTotalAmount: number | null;
          }
        >
      >((map, item) => {
        const key = [item.code, item.name, item.unitInsuredValueAmount ?? "pending"].join("::");
        const existing = map.get(key);

        if (existing) {
          existing.quantity += item.quantity;
          existing.insuredTotalAmount =
            typeof existing.insuredTotalAmount === "number" || typeof item.insuredTotalAmount === "number"
              ? (existing.insuredTotalAmount ?? 0) + (item.insuredTotalAmount ?? 0)
              : null;
          if (item.serialNumber && item.serialNumber !== "—" && !existing.serialNumbers.includes(item.serialNumber)) {
            existing.serialNumbers.push(item.serialNumber);
          }
          return map;
        }

        map.set(key, {
          name: item.name,
          code: item.code,
          serialNumbers: item.serialNumber && item.serialNumber !== "—" ? [item.serialNumber] : [],
          quantity: item.quantity,
          purchasePriceAmount: item.purchasePriceAmount,
          additionalCostsAmount: item.additionalCostsAmount,
          unitInsuredValueAmount: item.unitInsuredValueAmount,
          insuredTotalAmount: item.insuredTotalAmount,
        });
        return map;
      }, new Map()),
    ).map(([, item]) => ({
      ...item,
      serialLabel: item.serialNumbers.length ? item.serialNumbers.join(" · ") : "—",
      purchasePrice: formatPdfCurrency(item.purchasePriceAmount),
      additionalCosts: formatPdfCurrency(item.additionalCostsAmount),
      unitInsuredValue: formatPdfCurrency(item.unitInsuredValueAmount),
      insuredTotal: formatPdfCurrency(item.insuredTotalAmount),
    }));

    const missingValueCount = payload.items.filter((item) => item.unitInsuredValueAmount === null).length;
    const headerHeight = 78;

    document.roundedRect(cardLeft, cursorY, pageWidth, headerHeight, 16).strokeColor(accentBackground).lineWidth(1.1).stroke();
    drawMetadataLogo(document, cardLeft + 20, cursorY + 16);

    const headerTop = cursorY;
    const slipInfoX = cardLeft + 112;
    document.fillColor(surfaceMuted).fontSize(8).text("INSURANCE LIST", slipInfoX, headerTop + 18, {
      width: 180,
      characterSpacing: 1.1,
      lineBreak: false,
    });
    document.fillColor(surfaceText).fontSize(20).text(payload.slipNumber, slipInfoX, headerTop + 31, {
      width: 180,
      lineBreak: false,
      ellipsis: true,
    });
    document.fillColor(surfaceMuted).fontSize(8).text("Production / insurance only", slipInfoX, headerTop + 56, {
      width: 220,
      lineBreak: false,
      ellipsis: true,
    });

    cursorY += headerHeight + 18;

    const drawMetaRow = (label: string, value: string, x: number, y: number, width: number) => {
      document.fillColor(surfaceMuted).fontSize(7.5).text(label.toUpperCase(), x, y, {
        width,
        characterSpacing: 0.9,
        lineBreak: false,
        ellipsis: true,
      });
      document.fillColor(surfaceText).fontSize(9.5).text(value || "—", x, y + 12, {
        width,
        lineBreak: false,
        ellipsis: true,
      });
    };

    const metaColumnWidth = Math.floor((pageWidth - columnGap * 2) / 3);
    drawMetaRow("Project", payload.projectName, cardLeft, cursorY, metaColumnWidth);
    drawMetaRow("Department", payload.departmentName, cardLeft + metaColumnWidth + columnGap, cursorY, metaColumnWidth);
    drawMetaRow("Responsible", payload.responsibleName, cardLeft + (metaColumnWidth + columnGap) * 2, cursorY, metaColumnWidth);
    cursorY += 34;
    drawMetaRow("Issued / due", `${payload.issueDate} -> ${payload.dueDate}`, cardLeft, cursorY, metaColumnWidth);
    drawMetaRow("Items", String(payload.summary.itemCount), cardLeft + metaColumnWidth + columnGap, cursorY, metaColumnWidth);
    drawMetaRow("Pending values", String(missingValueCount), cardLeft + (metaColumnWidth + columnGap) * 2, cursorY, metaColumnWidth);
    cursorY += 42;

    const tableInset = 10;
    const tableContentWidth = pageWidth - tableInset * 2;
    const columns = [
      { label: "Qty", width: 28, align: "right" as const },
      { label: "Asset", width: 110, align: "left" as const },
      { label: "Code", width: 42, align: "left" as const },
      { label: "Serial", width: 54, align: "left" as const },
      { label: "Purchase", width: 62, align: "right" as const },
      { label: "Add. costs", width: 58, align: "right" as const },
      { label: "Unit value", width: 68, align: "right" as const },
      { label: "Total", width: tableContentWidth - 28 - 110 - 42 - 54 - 62 - 58 - 68, align: "right" as const },
    ] as const;

    const drawTableHeader = () => {
      ensurePageSpace(42);
      document.roundedRect(cardLeft, cursorY, pageWidth, 24, 8).fill(accentBackground);
      let x = cardLeft + tableInset;
      columns.forEach((column) => {
        document.font("Helvetica-Bold");
        document.fillColor("#eef2f8").fontSize(6.6).text(column.label, x, cursorY + 8, {
          width: column.width - 10,
          align: column.align,
          lineBreak: false,
          ellipsis: true,
        });
        document.font("Helvetica");
        x += column.width;
      });
      cursorY += 33;
    };

    drawTableHeader();

    if (!groupedItems.length) {
      document.roundedRect(cardLeft, cursorY - 2, pageWidth, 42, 10).fillAndStroke(surfaceBackground, surfaceBorder);
      document.fillColor(surfaceMuted).fontSize(10).text("No issued items are linked to this packing slip yet.", cardLeft + 14, cursorY + 12, {
        width: pageWidth - 28,
      });
      cursorY += 54;
    } else {
      groupedItems.forEach((item, index) => {
        const rowValues = [
          String(item.quantity),
          item.name,
          item.code || "—",
          item.serialLabel,
          item.purchasePrice,
          item.additionalCosts,
          item.unitInsuredValue,
          item.insuredTotal,
        ];
        const contentHeights = rowValues.map((value, valueIndex) =>
          document.heightOfString(value, {
            width: columns[valueIndex]!.width - 14,
            align: columns[valueIndex]!.align,
          }),
        );
        const rowHeight = Math.max(26, Math.ceil(Math.max(...contentHeights)) + 10);

        if (cursorY + rowHeight > document.page.height - document.page.margins.bottom - footerReserve) {
          document.addPage();
          cursorY = document.page.margins.top;
          drawTableHeader();
        }

        if (index % 2 === 0) {
          document.roundedRect(cardLeft, cursorY - 3, pageWidth, rowHeight, 8).fill(surfaceBackground);
        }

        let x = cardLeft + tableInset;
        rowValues.forEach((value, valueIndex) => {
          const isPrimaryCell = valueIndex === 1;
          document.font(isPrimaryCell ? "Helvetica-Bold" : "Helvetica");
          document.fillColor(isPrimaryCell ? "#18202a" : surfaceText).fontSize(isPrimaryCell ? 7.2 : 6.6).text(value, x, cursorY + 5, {
            width: columns[valueIndex]!.width - 14,
            align: columns[valueIndex]!.align,
            ellipsis: valueIndex !== 0,
            lineBreak: valueIndex === 1,
            height: rowHeight - 8,
          });
          document.font("Helvetica");
          x += columns[valueIndex]!.width;
        });

        cursorY += rowHeight;
      });
    }

    cursorY += 12;
    ensurePageSpace(44);
    document.roundedRect(cardLeft, cursorY, pageWidth, 34, 10).fillAndStroke(surfaceBackground, surfaceBorder);
    document.fillColor(surfaceMuted).fontSize(7.5).text("INSURED TOTAL", cardLeft + pageWidth - 220, cursorY + 12, {
      width: 100,
      align: "right",
      characterSpacing: 0.8,
      lineBreak: false,
    });
    document.font("Helvetica-Bold").fillColor(surfaceText).fontSize(10.5).text(payload.summary.insuredTotal, cardLeft + pageWidth - 108, cursorY + 10, {
      width: 94,
      align: "right",
      lineBreak: false,
      ellipsis: true,
    });
    document.font("Helvetica");
    cursorY += 54;

    const signatureLabelY = document.page.height - document.page.margins.bottom - 58;
    const signatureLineY = document.page.height - document.page.margins.bottom - 22;

    if (cursorY > signatureLabelY - 18) {
      document.addPage();
      cursorY = document.page.margins.top;
    }

    const signatureWidth = Math.floor((pageWidth - columnGap) / 2);

    document.fillColor(surfaceMuted).fontSize(8).text("PREPARED BY", cardLeft, signatureLabelY, {
      width: signatureWidth,
      characterSpacing: 0.9,
    });
    document.fillColor(surfaceMuted).fontSize(8).text("PRODUCTION / INSURANCE", cardLeft + signatureWidth + columnGap, signatureLabelY, {
      width: signatureWidth,
      characterSpacing: 0.9,
    });

    document.moveTo(cardLeft, signatureLineY).lineTo(cardLeft + signatureWidth - 18, signatureLineY).strokeColor(surfaceBorder).lineWidth(1).stroke();
    document
      .moveTo(cardLeft + signatureWidth + columnGap, signatureLineY)
      .lineTo(cardLeft + pageWidth, signatureLineY)
      .strokeColor(surfaceBorder)
      .lineWidth(1)
      .stroke();

    document.fillColor(surfaceMuted).fontSize(8).text(payload.preparedByName || "Operations", cardLeft, signatureLineY + 6, {
      width: signatureWidth,
    });
    document.fillColor(surfaceMuted).fontSize(8).text("Name / signature", cardLeft + signatureWidth + columnGap, signatureLineY + 6, {
      width: signatureWidth,
    });

    document.end();

    return {
      fileName: buildPackingSlipPdfFileName(payload, "IL"),
      mimeType: "application/pdf" as const,
      buffer: await bufferPromise,
    };
  },

  async createFinanceReportPdf(payload: FinanceReportPdfPayload) {
    const document = new PDFDocument({
      margin: 40,
      size: "A4",
    });
    const bufferPromise = collectPdfBuffer(document);
    const pageWidth = document.page.width - document.page.margins.left - document.page.margins.right;
    const cardLeft = document.page.margins.left;
    const surfaceBorder = "#d7dbe2";
    const surfaceMuted = "#6c7585";
    const surfaceText = "#1a2029";
    const surfaceBackground = "#f7f8fa";
    const accentBackground = "#141619";
    const accentSoft = "#efe8dc";
    const columnGap = 14;
    let cursorY = document.page.margins.top;

    const ensurePageSpace = (spaceNeeded: number) => {
      if (cursorY + spaceNeeded <= document.page.height - document.page.margins.bottom) {
        return;
      }

      document.addPage();
      cursorY = document.page.margins.top;
    };

    const drawSectionHeading = (title: string, subtitle?: string) => {
      ensurePageSpace(42);
      document.fillColor(surfaceText).fontSize(13).text(title, cardLeft, cursorY, { width: pageWidth });
      cursorY += 18;

      if (subtitle) {
        document.fillColor(surfaceMuted).fontSize(10).text(subtitle, cardLeft, cursorY, { width: pageWidth });
        cursorY += 18;
      }
    };

    const drawMetricCards = (rows: FinanceReportPdfPayload["totals"]) => {
      const cardWidth = Math.floor((pageWidth - columnGap * 2) / 3);
      const toneMap = {
        critical: "#b94f52",
        info: "#5176b9",
        neutral: "#596273",
        warning: "#a1723a",
      } as const;

      for (let index = 0; index < rows.length; index += 3) {
        const slice = rows.slice(index, index + 3);
        ensurePageSpace(80);

        slice.forEach((row, offset) => {
          const x = cardLeft + offset * (cardWidth + columnGap);
          document.roundedRect(x, cursorY, cardWidth, 62, 14).fillAndStroke(surfaceBackground, surfaceBorder);
          document
            .fillColor(surfaceMuted)
            .fontSize(9)
            .text(row.label.toUpperCase(), x + 14, cursorY + 12, { width: cardWidth - 28, characterSpacing: 0.9 });
          document
            .fillColor(toneMap[row.tone ?? "neutral"])
            .fontSize(18)
            .text(row.value, x + 14, cursorY + 28, { width: cardWidth - 28 });
        });

        cursorY += 76;
      }
    };

    const drawSimpleTable = (
      columns: Array<{ label: string; width: number; align?: "left" | "right" }>,
      rows: string[][],
      emptyLabel: string,
    ) => {
      const headerHeight = 26;
      const rowHeight = 34;
      const drawHeader = () => {
        document.roundedRect(cardLeft, cursorY, pageWidth, headerHeight, 10).fill(accentBackground);
        let x = cardLeft + 10;
        columns.forEach((column) => {
          document.fillColor("#aab2bf").fontSize(9).text(column.label.toUpperCase(), x, cursorY + 8, {
            width: column.width - 10,
            align: column.align ?? "left",
            characterSpacing: 0.8,
          });
          x += column.width;
        });
        cursorY += headerHeight + 8;
      };

      ensurePageSpace(40);
      drawHeader();

      if (!rows.length) {
        document
          .roundedRect(cardLeft, cursorY - 2, pageWidth, 42, 10)
          .fillAndStroke(surfaceBackground, surfaceBorder);
        document.fillColor(surfaceMuted).fontSize(10).text(emptyLabel, cardLeft + 14, cursorY + 12, {
          width: pageWidth - 28,
        });
        cursorY += 54;
        return;
      }

      rows.forEach((row, index) => {
        ensurePageSpace(48);
        if (cursorY + rowHeight > document.page.height - document.page.margins.bottom) {
          document.addPage();
          cursorY = document.page.margins.top;
          drawHeader();
        }

        if (index % 2 === 0) {
          document.roundedRect(cardLeft, cursorY - 4, pageWidth, rowHeight, 10).fill(surfaceBackground);
        }

        let x = cardLeft + 10;
        row.forEach((cell, cellIndex) => {
          document.fillColor(surfaceText).fontSize(10).text(cell, x, cursorY + 4, {
            width: columns[cellIndex]!.width - 12,
            align: columns[cellIndex]!.align ?? "left",
            ellipsis: true,
          });
          x += columns[cellIndex]!.width;
        });
        cursorY += rowHeight;
      });

      cursorY += 10;
    };

    document.roundedRect(cardLeft, cursorY, pageWidth, 120, 18).fillAndStroke(accentBackground, "#22262c");
    document.fillColor("#7d8595").fontSize(10).text("FINANCE REPORT", cardLeft + 24, cursorY + 16, {
      width: 220,
      characterSpacing: 1.2,
    });
    document.fillColor("#f4f5f7").fontSize(24).text(payload.reportTitle, cardLeft + 24, cursorY + 34, {
      width: pageWidth - 48,
    });
    document.fillColor("#c2c7d0").fontSize(11).text(payload.periodLabel, cardLeft + 24, cursorY + 68, {
      width: 260,
    });
    document.fillColor("#8f98a8").fontSize(10).text(payload.generatedAt, cardLeft + 24, cursorY + 90, {
      width: 260,
    });
    document
      .roundedRect(cardLeft + pageWidth - 160, cursorY + 20, 136, 74, 14)
      .fill(accentSoft);
    document.fillColor("#5d4a2d").fontSize(9).text("WORKSPACE", cardLeft + pageWidth - 144, cursorY + 34, {
      width: 108,
      characterSpacing: 0.9,
    });
    document.fillColor("#1f2126").fontSize(14).text(payload.workspaceLabel, cardLeft + pageWidth - 144, cursorY + 50, {
      width: 108,
    });

    cursorY += 142;

    drawSectionHeading("Executive summary");
    document
      .roundedRect(cardLeft, cursorY, pageWidth, 62, 14)
      .fillAndStroke(surfaceBackground, surfaceBorder);
    document.fillColor(surfaceText).fontSize(11).text(payload.executiveSummary, cardLeft + 16, cursorY + 16, {
      width: pageWidth - 32,
      height: 32,
    });
    cursorY += 78;

    drawSectionHeading("Core metrics", "Snapshot values taken from the active finance window.");
    drawMetricCards(payload.totals);

    drawSectionHeading("Operational metrics");
    drawSimpleTable(
      [
        { label: "Metric", width: 220 },
        { label: "Value", width: pageWidth - 220, align: "right" },
      ],
      payload.metrics.map((metric) => [metric.label, metric.value]),
      "No operational finance metrics are available for this period.",
    );

    drawSectionHeading("Project exposure", "Projects carrying the most linked incident pressure in the selected window.");
    drawSimpleTable(
      [
        { label: "Project", width: 220 },
        { label: "Exposure", width: 108, align: "right" },
        { label: "Incidents", width: 74, align: "right" },
        { label: "Assets out", width: 120, align: "right" },
      ],
      payload.exposureByProject.slice(0, 12).map((row) => [
        row.project,
        row.exposure,
        String(row.incidentCount),
        row.assetsOut,
      ]),
      "No projects are carrying measurable exposure in this period.",
    );

    drawSectionHeading("Category mix", "Tracked spend grouped by category for the selected period.");
    drawSimpleTable(
      [
        { label: "Category", width: 220 },
        { label: "Amount", width: 120, align: "right" },
        { label: "Share", width: 80, align: "right" },
      ],
      payload.categoryBreakdown.slice(0, 10).map((row) => [row.category, row.amount, `${row.percentage}%`]),
      "No tracked spend categories are available for this period.",
    );

    drawSectionHeading("Pending cost-link queue", "Incidents still waiting on financial follow-through.");
    drawSimpleTable(
      [
        { label: "Incident", width: 170 },
        { label: "Project", width: 150 },
        { label: "Severity", width: 74 },
        { label: "Estimate", width: 100, align: "right" },
        { label: "Status", width: 80, align: "right" },
      ],
      payload.pendingCostLinks.slice(0, 10).map((row) => [
        row.incident,
        row.project,
        row.severity,
        row.costEstimate,
        row.financialStatus,
      ]),
      "No pending cost-link items are waiting in the selected finance queue.",
    );

    document
      .fontSize(9)
      .fillColor("#8f98a8")
      .text("Generated by BukowskiOS internal alpha finance reporting.", cardLeft, document.page.height - 52, {
        width: pageWidth,
        align: "left",
      });

    document.end();

    return {
      fileName: "bukowski-finance-report.pdf",
      mimeType: "application/pdf" as const,
      buffer: await bufferPromise,
    };
  },

  async createProjectSetupPdf(payload: ProjectSetupSummaryPdfPayload) {
    const document = new PDFDocument({
      margin: 40,
      size: "A4",
    });
    const bufferPromise = collectPdfBuffer(document);
    const pageWidth = document.page.width - document.page.margins.left - document.page.margins.right;
    const cardLeft = document.page.margins.left;
    const surfaceBorder = "#d7dbe2";
    const surfaceMuted = "#6c7585";
    const surfaceText = "#1a2029";
    const surfaceBackground = "#f7f8fa";
    const accentBackground = "#141619";
    const accentSoft = "#efe8dc";
    const columnGap = 14;
    let cursorY = document.page.margins.top;

    const ensurePageSpace = (spaceNeeded: number) => {
      if (cursorY + spaceNeeded <= document.page.height - document.page.margins.bottom) {
        return;
      }

      document.addPage();
      cursorY = document.page.margins.top;
    };

    const drawSectionHeading = (title: string, subtitle?: string) => {
      ensurePageSpace(42);
      document.fillColor(surfaceText).fontSize(13).text(title, cardLeft, cursorY, { width: pageWidth });
      cursorY += 18;

      if (subtitle) {
        document.fillColor(surfaceMuted).fontSize(10).text(subtitle, cardLeft, cursorY, { width: pageWidth });
        cursorY += 18;
      }
    };

    const drawMetricCards = (rows: Array<{ label: string; value: string }>) => {
      const cardWidth = Math.floor((pageWidth - columnGap * 2) / 3);
      ensurePageSpace(84);

      rows.forEach((row, index) => {
        const x = cardLeft + index * (cardWidth + columnGap);
        document.roundedRect(x, cursorY, cardWidth, 62, 14).fillAndStroke(surfaceBackground, surfaceBorder);
        document.fillColor(surfaceMuted).fontSize(9).text(row.label.toUpperCase(), x + 14, cursorY + 12, {
          width: cardWidth - 28,
          characterSpacing: 0.9,
        });
        document.fillColor(surfaceText).fontSize(18).text(row.value, x + 14, cursorY + 28, {
          width: cardWidth - 28,
        });
      });

      cursorY += 76;
    };

    const drawCompactList = (items: string[], emptyLabel: string) => {
      ensurePageSpace(42);

      if (!items.length) {
        document.roundedRect(cardLeft, cursorY, pageWidth, 42, 10).fillAndStroke(surfaceBackground, surfaceBorder);
        document.fillColor(surfaceMuted).fontSize(10).text(emptyLabel, cardLeft + 14, cursorY + 14, {
          width: pageWidth - 28,
        });
        cursorY += 54;
        return;
      }

      items.forEach((item, index) => {
        ensurePageSpace(24);

        if (index % 2 === 0) {
          document.roundedRect(cardLeft, cursorY - 2, pageWidth, 22, 8).fill(surfaceBackground);
        }

        document.fillColor(surfaceText).fontSize(10).text(item, cardLeft + 12, cursorY + 5, {
          width: pageWidth - 24,
        });
        cursorY += 24;
      });

      cursorY += 6;
    };

    document.roundedRect(cardLeft, cursorY, pageWidth, 128, 18).fillAndStroke(accentBackground, "#22262c");
    document.fillColor("#7d8595").fontSize(10).text("PROJECT SETUP", cardLeft + 24, cursorY + 16, {
      width: 220,
      characterSpacing: 1.2,
    });
    document.fillColor("#f4f5f7").fontSize(24).text(`${payload.projectCode} · ${payload.projectName}`, cardLeft + 24, cursorY + 34, {
      width: pageWidth - 200,
    });
    document.fillColor("#c2c7d0").fontSize(11).text(payload.windowLabel, cardLeft + 24, cursorY + 70, {
      width: 260,
    });
    document.fillColor("#8f98a8").fontSize(10).text(`Status · ${payload.status}`, cardLeft + 24, cursorY + 92, {
      width: 160,
    });

    document.roundedRect(cardLeft + pageWidth - 160, cursorY + 20, 136, 82, 14).fill(accentSoft);
    document.fillColor("#5d4a2d").fontSize(9).text("PACKING SOURCE", cardLeft + pageWidth - 144, cursorY + 32, {
      width: 108,
      characterSpacing: 0.9,
    });
    document.fillColor("#1f2126").fontSize(12).text(payload.packingSourceLabel, cardLeft + pageWidth - 144, cursorY + 48, {
      width: 108,
      height: 40,
    });

    cursorY += 146;

    drawSectionHeading("General info");
    document.roundedRect(cardLeft, cursorY, pageWidth, 94, 14).fillAndStroke(surfaceBackground, surfaceBorder);
    document.fillColor(surfaceMuted).fontSize(9).text("CLIENT", cardLeft + 16, cursorY + 14, {
      width: 160,
      characterSpacing: 0.9,
    });
    document.fillColor(surfaceText).fontSize(11).text(payload.clientName, cardLeft + 16, cursorY + 28, {
      width: 220,
    });
    document.fillColor(surfaceMuted).fontSize(9).text("PRODUCTION COMPANY", cardLeft + 260, cursorY + 14, {
      width: 180,
      characterSpacing: 0.9,
    });
    document.fillColor(surfaceText).fontSize(11).text(payload.productionCompanyName, cardLeft + 260, cursorY + 28, {
      width: 220,
    });
    document.fillColor(surfaceMuted).fontSize(9).text("PRE-PRODUCTION", cardLeft + 16, cursorY + 58, {
      width: 180,
      characterSpacing: 0.9,
    });
    document.fillColor(surfaceText).fontSize(10).text(payload.preproductionLabel ?? "Not scheduled for this setup.", cardLeft + 16, cursorY + 72, {
      width: pageWidth - 32,
    });
    cursorY += 108;

    if (payload.description.trim()) {
      drawSectionHeading("Setup note");
      document.roundedRect(cardLeft, cursorY, pageWidth, 58, 14).fillAndStroke(surfaceBackground, surfaceBorder);
      document.fillColor(surfaceText).fontSize(10).text(payload.description, cardLeft + 16, cursorY + 16, {
        width: pageWidth - 32,
        height: 28,
      });
      cursorY += 74;
    }

    drawSectionHeading("Resource summary");
    drawMetricCards([
      { label: "Main unit assets", value: String(payload.totals.assetCount) },
      { label: "Crew linked", value: String(payload.totals.crewCount) },
      { label: "Additional units", value: String(payload.totals.additionalUnitCount) },
    ]);

    drawSectionHeading("Main unit");
    document.fillColor(surfaceMuted).fontSize(10).text("Assets", cardLeft, cursorY, { width: pageWidth / 2 });
    cursorY += 16;
    drawCompactList(payload.mainUnit.assetNames, "No assets linked yet.");
    document.fillColor(surfaceMuted).fontSize(10).text("Crew", cardLeft, cursorY, { width: pageWidth / 2 });
    cursorY += 16;
    drawCompactList(payload.mainUnit.crewNames, "No crew linked yet.");

    drawSectionHeading("Additional units", "Compact review of extra units included in this setup.");
    if (!payload.additionalUnits.length) {
      drawCompactList([], "No additional units configured.");
    } else {
      payload.additionalUnits.forEach((unit) => {
        ensurePageSpace(96);
        document.roundedRect(cardLeft, cursorY, pageWidth, 82, 14).fillAndStroke(surfaceBackground, surfaceBorder);
        document.fillColor(surfaceText).fontSize(12).text(unit.name, cardLeft + 16, cursorY + 14, { width: 220 });
        document.fillColor(surfaceMuted).fontSize(10).text(unit.dateLabel, cardLeft + 16, cursorY + 32, { width: 220 });
        document.fillColor(surfaceMuted).fontSize(10).text(`${unit.assetCount} assets · ${unit.crewCount} crew`, cardLeft + 16, cursorY + 50, {
          width: 220,
        });
        const assetPreview = unit.assetNames.slice(0, 3).join(", ") || "No assets";
        const crewPreview = unit.crewNames.slice(0, 3).join(", ") || "No crew";
        document.fillColor(surfaceText).fontSize(9).text(`Assets: ${assetPreview}`, cardLeft + 270, cursorY + 18, {
          width: pageWidth - 286,
        });
        document.fillColor(surfaceText).fontSize(9).text(`Crew: ${crewPreview}`, cardLeft + 270, cursorY + 40, {
          width: pageWidth - 286,
        });
        cursorY += 94;
      });
    }

    drawSectionHeading("Conflict review");
    if (!payload.conflictGroups.some((group) => group.items.length > 0)) {
      drawCompactList([], "No blocking conflicts detected in this draft.");
    } else {
      payload.conflictGroups.forEach((group) => {
        if (!group.items.length) {
          return;
        }

        ensurePageSpace(34);
        document.fillColor(surfaceText).fontSize(11).text(group.title, cardLeft, cursorY, {
          width: pageWidth,
        });
        cursorY += 18;

        group.items.forEach((item, index) => {
          ensurePageSpace(40);
          if (index % 2 === 0) {
            document.roundedRect(cardLeft, cursorY - 2, pageWidth, 36, 10).fill(surfaceBackground);
          }

          const unitSuffix = item.conflictingUnit ? ` / ${item.conflictingUnit}` : "";
          document.fillColor(surfaceText).fontSize(10).text(`${item.resourceLabel} · ${item.conflictingProject}${unitSuffix}`, cardLeft + 12, cursorY + 4, {
            width: pageWidth - 24,
          });
          document.fillColor(surfaceMuted).fontSize(9).text(item.overlapLabel, cardLeft + 12, cursorY + 20, {
            width: pageWidth - 24,
          });
          cursorY += 38;
        });

        cursorY += 8;
      });
    }

    document
      .fontSize(9)
      .fillColor("#8f98a8")
      .text("Generated by BukowskiOS project setup wizard", cardLeft, document.page.height - 52, {
        width: pageWidth,
        align: "left",
      });

    document.end();

    return {
      fileName: `${payload.projectCode.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "project-setup-summary"}.pdf`,
      mimeType: "application/pdf" as const,
      buffer: await bufferPromise,
    };
  },

  async createInvoicePdf(payload: InvoicePdfPayload) {
    const document = new PDFDocument({ margin: 38, size: "A4" });
    const bufferPromise = collectPdfBuffer(document);

    const pageLeft = document.page.margins.left;
    const pageRight = document.page.width - document.page.margins.right;
    const pageWidth = pageRight - pageLeft;
    const pageBottom = document.page.height - document.page.margins.bottom;
    const ink = "#11151b";
    const muted = "#677282";
    const hairline = "#d7dce4";
    const panel = "#f6f8fb";
    const accent = "#101418";
    let cursorY = document.page.margins.top;

    const drawPageBackground = () => {
      document.save();
      document.rect(0, 0, document.page.width, document.page.height).fill("#ffffff");
      document.restore();
    };

    drawPageBackground();

    const formatAmount = (value: number) =>
      `${payload.currency.symbol} ${Number.isFinite(value) ? value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) : "0.00"}`;

    const formatDate = (value: string | null) => {
      if (!value) return "—";
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
      if (!match) return value;
      return `${match[3]}/${match[2]}/${match[1]}`;
    };

    const labelText = (label: string, value: string | null, x: number, y: number, width: number) => {
      document.font("Helvetica-Bold").fillColor(muted).fontSize(7.4).text(label.toUpperCase(), x, y, {
        width,
        characterSpacing: 0.7,
        lineBreak: false,
        ellipsis: true,
      });
      document.font("Helvetica").fillColor(ink).fontSize(9.2).text(value?.trim() || "—", x, y + 12, {
        width,
        lineBreak: false,
        ellipsis: true,
      });
    };

    const ensureSpace = (height: number) => {
      if (cursorY + height <= pageBottom - 34) return;
      document.addPage();
      drawPageBackground();
      cursorY = document.page.margins.top;
    };

    const logoBoxW = 104;
    const logoBoxH = 72;
    if (payload.workspace.logoBuffer) {
      try {
        document.image(payload.workspace.logoBuffer, pageLeft, cursorY, { fit: [logoBoxW, logoBoxH] });
      } catch {
        drawMetadataLogo(document, pageLeft + 16, cursorY + 9);
      }
    } else {
      drawMetadataLogo(document, pageLeft + 16, cursorY + 9);
    }

    document.font("Helvetica-Bold").fillColor(ink).fontSize(22).text("FACTURA", pageRight - 230, cursorY + 2, {
      width: 230,
      align: "right",
      lineBreak: false,
    });
    document.font("Helvetica").fillColor(muted).fontSize(10).text(payload.invoiceNumber, pageRight - 230, cursorY + 30, {
      width: 230,
      align: "right",
      lineBreak: false,
    });
    document.font("Helvetica-Bold").fillColor(payload.ncf ? ink : "#9a6a17").fontSize(9.4).text(
      payload.ncf ? `NCF ${payload.ncf}` : "BORRADOR SIN NCF",
      pageRight - 230,
      cursorY + 48,
      { width: 230, align: "right", lineBreak: false },
    );

    cursorY += 84;

    document.roundedRect(pageLeft, cursorY, pageWidth, 54, 12).fill(accent);
    document.font("Helvetica-Bold").fillColor("#ffffff").fontSize(12).text(payload.workspace.legalName, pageLeft + 14, cursorY + 11, {
      width: pageWidth * 0.55,
      lineBreak: false,
      ellipsis: true,
    });
    document.font("Helvetica").fillColor("#d7dde7").fontSize(8.6);
    document.text(`RNC: ${payload.workspace.rnc}`, pageLeft + 14, cursorY + 30, {
      width: pageWidth * 0.35,
      lineBreak: false,
    });
    if (payload.workspace.sirecineNumber) {
      document.text(`SIRECINE: ${payload.workspace.sirecineNumber}`, pageLeft + pageWidth * 0.36, cursorY + 30, {
        width: pageWidth * 0.28,
        lineBreak: false,
        ellipsis: true,
      });
    }
    document.text([payload.workspace.phone, payload.workspace.email].filter(Boolean).join(" · "), pageLeft + pageWidth * 0.63, cursorY + 30, {
      width: pageWidth * 0.35,
      align: "right",
      lineBreak: false,
      ellipsis: true,
    });
    cursorY += 70;

    const infoGap = 14;
    const infoWidth = (pageWidth - infoGap) / 2;
    const infoHeight = 128;
    document.roundedRect(pageLeft, cursorY, infoWidth, infoHeight, 10).fillAndStroke(panel, hairline);
    document.roundedRect(pageLeft + infoWidth + infoGap, cursorY, infoWidth, infoHeight, 10).fillAndStroke(panel, hairline);

    document.font("Helvetica-Bold").fillColor(ink).fontSize(10.5).text("CLIENTE", pageLeft + 14, cursorY + 13, {
      width: infoWidth - 28,
      lineBreak: false,
    });
    labelText("Nombre", payload.client.name, pageLeft + 14, cursorY + 34, infoWidth - 28);
    labelText("RNC", payload.client.rnc, pageLeft + 14, cursorY + 66, (infoWidth - 34) / 2);
    labelText("Atención", payload.client.attentionName, pageLeft + 22 + (infoWidth - 34) / 2, cursorY + 66, (infoWidth - 34) / 2);
    labelText("Producción", payload.client.productionName ?? payload.client.projectName, pageLeft + 14, cursorY + 98, infoWidth - 28);

    const docX = pageLeft + infoWidth + infoGap + 14;
    document.font("Helvetica-Bold").fillColor(ink).fontSize(10.5).text("DOCUMENTO", docX, cursorY + 13, {
      width: infoWidth - 28,
      lineBreak: false,
    });
    labelText("Emisión", formatDate(payload.issueDate), docX, cursorY + 34, (infoWidth - 34) / 2);
    labelText("Vence", formatDate(payload.dueDate), docX + 8 + (infoWidth - 34) / 2, cursorY + 34, (infoWidth - 34) / 2);
    labelText("Estado", payload.status, docX, cursorY + 66, (infoWidth - 34) / 2);
    labelText("Cotización fuente", payload.sourceQuoteNumber, docX + 8 + (infoWidth - 34) / 2, cursorY + 66, (infoWidth - 34) / 2);
    labelText(
      "Tasa",
      `${payload.exchangeRate.rate.toLocaleString("en-US", { maximumFractionDigits: 4 })} · ${payload.exchangeRate.source}${payload.exchangeRate.effectiveDate ? ` · ${formatDate(payload.exchangeRate.effectiveDate)}` : ""}`,
      docX,
      cursorY + 98,
      infoWidth - 28,
    );
    cursorY += infoHeight + 22;

    document.font("Helvetica-Bold").fillColor(ink).fontSize(11).text("DETALLE", pageLeft, cursorY, {
      width: pageWidth,
      lineBreak: false,
    });
    cursorY += 18;

    const columns = [
      { label: "Cant.", width: 42, align: "right" as const },
      { label: "Descripción", width: pageWidth - 42 - 54 - 72 - 72 - 82, align: "left" as const },
      { label: "Dur.", width: 54, align: "center" as const },
      { label: "Precio", width: 72, align: "right" as const },
      { label: "ITBIS", width: 72, align: "right" as const },
      { label: "Total", width: 82, align: "right" as const },
    ];

    const drawTableHeader = () => {
      ensureSpace(34);
      document.roundedRect(pageLeft, cursorY, pageWidth, 24, 7).fill(accent);
      let x = pageLeft + 10;
      columns.forEach((column) => {
        document.font("Helvetica-Bold").fillColor("#eef2f7").fontSize(7.4).text(column.label, x, cursorY + 8, {
          width: column.width - 12,
          align: column.align,
          lineBreak: false,
          ellipsis: true,
        });
        x += column.width;
      });
      cursorY += 32;
    };

    drawTableHeader();

    payload.items.forEach((item, index) => {
      const duration =
        item.durationValue === null || item.durationValue === undefined
          ? "—"
          : `${item.durationValue.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${item.durationUnit ?? ""}`.trim();
      document.font("Helvetica-Bold").fontSize(8.6);
      const titleHeight = document.heightOfString(item.title, { width: columns[1]!.width - 16 });
      document.font("Helvetica").fontSize(7.5);
      const descriptionHeight = item.description
        ? document.heightOfString(item.description, { width: columns[1]!.width - 16 })
        : 0;
      const rowHeight = Math.max(34, Math.ceil(titleHeight + descriptionHeight) + 16);
      if (cursorY + rowHeight > pageBottom - 112) {
        document.addPage();
        drawPageBackground();
        cursorY = document.page.margins.top;
        drawTableHeader();
      }
      if (index % 2 === 0) {
        document.roundedRect(pageLeft, cursorY - 3, pageWidth, rowHeight, 7).fill(panel);
      }

      const values = [
        item.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 }),
        item.title,
        duration,
        formatAmount(item.unitPrice),
        formatAmount(item.taxAmount),
        formatAmount(item.lineTotal),
      ];
      let x = pageLeft + 10;
      values.forEach((value, valueIndex) => {
        const isDescription = valueIndex === 1;
        document.font(isDescription ? "Helvetica-Bold" : "Helvetica").fillColor(ink).fontSize(isDescription ? 8.6 : 8);
        document.text(value, x, cursorY + 6, {
          width: columns[valueIndex]!.width - 12,
          align: columns[valueIndex]!.align,
          lineBreak: isDescription,
          ellipsis: !isDescription,
          height: rowHeight - 10,
        });
        x += columns[valueIndex]!.width;
      });
      if (item.description) {
        document.font("Helvetica").fillColor(muted).fontSize(7.5).text(item.description, pageLeft + 10 + columns[0]!.width, cursorY + 18, {
          width: columns[1]!.width - 12,
          height: rowHeight - 20,
          ellipsis: true,
        });
      }
      cursorY += rowHeight;
    });

    cursorY += 14;
    ensureSpace(176);

    const notesW = pageWidth * 0.55;
    const totalsX = pageLeft + notesW + 18;
    const totalsW = pageWidth - notesW - 18;
    document.roundedRect(pageLeft, cursorY, notesW, 118, 10).fillAndStroke(panel, hairline);
    document.font("Helvetica-Bold").fillColor(muted).fontSize(7.5).text("OBSERVACIONES", pageLeft + 12, cursorY + 12, {
      width: notesW - 24,
      characterSpacing: 0.8,
    });
    document.font("Helvetica").fillColor(ink).fontSize(8.7).text(payload.observations?.trim() || "—", pageLeft + 12, cursorY + 28, {
      width: notesW - 24,
      height: 72,
      ellipsis: true,
    });

    const drawTotalRow = (label: string, value: number, bold = false, tone: string = ink) => {
      document.font(bold ? "Helvetica-Bold" : "Helvetica").fillColor(bold ? ink : muted).fontSize(bold ? 10 : 8.6);
      document.text(label, totalsX, cursorY, { width: totalsW * 0.52, lineBreak: false });
      document.fillColor(tone).text(formatAmount(value), totalsX + totalsW * 0.52, cursorY, {
        width: totalsW * 0.48,
        align: "right",
        lineBreak: false,
      });
      cursorY += bold ? 18 : 15;
    };

    const totalsStartY = cursorY;
    document.roundedRect(totalsX - 12, totalsStartY, totalsW + 12, 118, 10).fillAndStroke("#ffffff", hairline);
    cursorY += 12;
    drawTotalRow("Subtotal", payload.totals.subtotal);
    drawTotalRow("Descuento", -Math.abs(payload.totals.discountAmount));
    drawTotalRow("ITBIS", payload.totals.taxAmount);
    drawTotalRow("Total", payload.totals.total, true);
    drawTotalRow("Pagado", payload.totals.paid, false, "#17694a");
    drawTotalRow("Pendiente", payload.totals.outstanding, true, payload.totals.outstanding > 0 ? "#9a4f10" : "#17694a");
    cursorY = totalsStartY + 138;

    if (payload.payments.length) {
      ensureSpace(70);
      document.font("Helvetica-Bold").fillColor(ink).fontSize(10.5).text("PAGOS REGISTRADOS", pageLeft, cursorY, {
        width: pageWidth,
        lineBreak: false,
      });
      cursorY += 18;
      payload.payments.slice(0, 6).forEach((payment) => {
        document.font("Helvetica").fillColor(ink).fontSize(8.4).text(
          `${formatDate(payment.paidAt)} · ${payment.method ?? "Pago"}${payment.reference ? ` · ${payment.reference}` : ""}`,
          pageLeft,
          cursorY,
          { width: pageWidth * 0.65, lineBreak: false, ellipsis: true },
        );
        document.text(formatAmount(payment.amount), pageLeft + pageWidth * 0.65, cursorY, {
          width: pageWidth * 0.35,
          align: "right",
          lineBreak: false,
        });
        cursorY += 14;
      });
    }

    const footerY = pageBottom - 28;
    document.moveTo(pageLeft, footerY - 10).lineTo(pageRight, footerY - 10).strokeColor(hairline).lineWidth(0.7).stroke();
    document.font("Helvetica").fillColor(muted).fontSize(7.4).text(
      "Documento generado por bukowskiOS. Verifique NCF, RNC, montos y condiciones antes de enviar al cliente.",
      pageLeft,
      footerY,
      { width: pageWidth, align: "center", lineBreak: false, ellipsis: true },
    );

    document.end();

    return {
      fileName: buildInvoicePdfFileName(payload),
      mimeType: "application/pdf" as const,
      buffer: await bufferPromise,
    };
  },

  /**
   * Quote PDF — pixel-faithful recreation of the Metadata Cine quote model
   * (cotizaciones 2025-8400..8405). A4 portrait, single page.
   *
   * Visual hierarchy:
   *  1. Logo (top-left, ~140x110), "COTIZACIÓN" + number (top-right).
   *  2. Black header bar with "METADATA CINE S.R.L." + RNC + SIRECINE NO.
   *  3. Address block left, contact form right (4 lines × 2 cols).
   *  4. Section title (uppercase bold) + "VALIDITY: N DAYS" right-aligned.
   *  5. Items table (5 cols: Cant. | Descripción | Duración | Precio | Costo).
   *     Always renders ~12 row slots (empty rows fill remaining space).
   *  6. Totals block: SUB-TOTAL, optional discount, ITBIS (with `**` marker if
   *     not added to total), TOTAL GENERAL.
   *  7. "Observaciones :" + signature image + sello + signatory name.
   *  8. "Recibido por:" right.
   */
  async createQuotePdf(payload: QuotePdfPayload) {
    // bufferPages keeps every page in memory so we can drop overflow pages
    // before flushing to disk. autoFirstPage is on by default; we never want
    // pdfkit to auto-create a second page from cursor drift.
    const document = new PDFDocument({ margin: 32, size: "A4", bufferPages: true });
    const bufferPromise = collectPdfBuffer(document);

    const pageLeft = document.page.margins.left;
    const pageRight = document.page.width - document.page.margins.right;
    const pageWidth = pageRight - pageLeft;
    const pageBottom = document.page.height - document.page.margins.bottom;
    const top = document.page.margins.top;
    const ink = "#0d0f12";
    const muted = "#5b6573";
    const hairline = "#cdd2da";

    // Helpers --------------------------------------------------------------
    const formatAmount = (value: number) => {
      // Metadata format: thousands separator, no decimals.
      const safe = Number.isFinite(value) ? Math.round(value) : 0;
      return safe.toLocaleString("en-US");
    };

    // 1. Logo (top-left) — kept compact (~78pt tall) to match Iván's layout.
    const logoBoxX = pageLeft;
    const logoBoxY = top;
    const logoBoxW = 110;
    const logoBoxH = 78;
    if (payload.workspace.logoBuffer) {
      try {
        document.image(payload.workspace.logoBuffer, logoBoxX, logoBoxY, {
          fit: [logoBoxW, logoBoxH],
        });
      } catch {
        drawMetadataLogo(document, logoBoxX + 22, logoBoxY + 8);
      }
    } else {
      // Fallback: stacked META / DATA / CINE text blocks.
      document.font("Helvetica-Bold").fillColor(ink).fontSize(22);
      document.text("META", logoBoxX, logoBoxY, { lineBreak: false, characterSpacing: 1.4 });
      document.text("DATA", logoBoxX, logoBoxY + 21, { lineBreak: false, characterSpacing: 1.4 });
      document.font("Helvetica").fontSize(9);
      document.text("C I N E", logoBoxX + 3, logoBoxY + 50, {
        lineBreak: false,
        characterSpacing: 6,
      });
    }

    // 2. "COTIZACIÓN" + number (top-right) ---------------------------------
    document.font("Helvetica").fillColor(muted).fontSize(11);
    document.text("COTIZACIÓN", pageRight - 220, top + 2, {
      width: 220,
      align: "right",
      lineBreak: false,
    });
    document.font("Helvetica-Bold").fillColor(ink).fontSize(15);
    document.text(payload.quoteNumber, pageRight - 220, top + 18, {
      width: 220,
      align: "right",
      lineBreak: false,
    });

    // 3. Black header bar with workspace identity --------------------------
    const headerBarY = top + 38;
    const headerBarH = 42;
    const headerBarLeft = pageLeft + logoBoxW + 12;
    const headerBarRight = pageRight;
    const headerBarW = headerBarRight - headerBarLeft;
    document.rect(headerBarLeft, headerBarY, headerBarW, headerBarH).fill(ink);

    document.font("Helvetica").fillColor("#ffffff").fontSize(13);
    document.text(payload.workspace.legalName, headerBarLeft + 14, headerBarY + 8, {
      width: headerBarW - 28,
      lineBreak: false,
    });
    document.font("Helvetica").fontSize(9.5);
    document.text(`RNC: ${payload.workspace.rnc}`, headerBarLeft + 14, headerBarY + 26, {
      width: headerBarW * 0.55,
      lineBreak: false,
    });
    if (payload.workspace.sirecineNumber) {
      document.text(`SIRECINE NO.: ${payload.workspace.sirecineNumber}`, headerBarLeft + headerBarW * 0.55, headerBarY + 26, {
        width: headerBarW * 0.45 - 14,
        align: "right",
        lineBreak: false,
      });
    }

    // 4. Address block (left, under logo) ----------------------------------
    //
    // Width is clamped to the logo column so the address never bleeds into
    // the client form on the right (Iván's PDFs keep the same vertical alley).
    const addressColumnW = 150;
    let addressY = top + logoBoxH + 12;
    document.font("Helvetica").fillColor(ink).fontSize(8);
    payload.workspace.addressLines.forEach((line) => {
      document.text(line, pageLeft, addressY, { width: addressColumnW, lineBreak: false, ellipsis: true });
      addressY += 11;
    });
    document.font("Helvetica-Bold").fontSize(8);
    document.text(`T `, pageLeft, addressY, { width: addressColumnW, continued: true });
    document.font("Helvetica").text(payload.workspace.phone, { lineBreak: false });
    addressY += 11;
    document.font("Helvetica-Bold").text(`W `, pageLeft, addressY, { width: addressColumnW, continued: true });
    document.font("Helvetica").text(payload.workspace.web, { lineBreak: false });
    addressY += 11;
    document.font("Helvetica-Bold").text(`E `, pageLeft, addressY, { width: addressColumnW, continued: true });
    document.font("Helvetica").text(payload.workspace.email, { lineBreak: false });

    // 5. Client form block (right, under header bar) -----------------------
    //
    // The form's left edge is pushed past the address column to keep a clean
    // alley between the two — `addressColumnW + 16pt` of breathing room.
    const formY = headerBarY + headerBarH + 14;
    const formLeft = pageLeft + addressColumnW + 16;
    const formW = pageRight - formLeft;
    const formColW = formW / 2;
    const formLineH = 16;

    const drawFormRow = (
      leftLabel: string,
      leftValue: string | null,
      rightLabel: string,
      rightValue: string | null,
      lineIndex: number,
    ) => {
      const y = formY + lineIndex * formLineH;
      document.font("Helvetica").fillColor(ink).fontSize(9.5);
      document.text(`${leftLabel} : `, formLeft, y, { continued: true, lineBreak: false });
      document.font(leftValue ? "Helvetica-Bold" : "Helvetica");
      document.text(leftValue ?? "", { lineBreak: false });

      document.font("Helvetica").fontSize(9.5);
      document.text(`${rightLabel} : `, formLeft + formColW, y, { continued: true, lineBreak: false });
      document.font(rightValue ? "Helvetica-Bold" : "Helvetica");
      document.text(rightValue ?? "", { lineBreak: false });
      document.font("Helvetica");
    };

    drawFormRow("ATENCIÓN", payload.client.attentionName, "FECHA", payload.quoteDate, 0);
    drawFormRow("PRODUCCIÓN", payload.client.productionName, "TEL", payload.client.phone, 1);
    drawFormRow(
      "NOMBRE DEL PROJECTO",
      payload.client.projectName,
      "RNC",
      payload.client.rnc,
      2,
    );
    drawFormRow(
      "DESCRIPCIÓN",
      payload.client.descriptionLabel,
      "PUR",
      payload.client.pur,
      3,
    );

    // 6. Section title (package title) + validity --------------------------
    let cursorY = formY + 4 * formLineH + 14;
    if (payload.packageTitle) {
      document.font("Helvetica-Bold").fillColor(ink).fontSize(11);
      document.text(payload.packageTitle.toUpperCase(), pageLeft, cursorY, {
        width: pageWidth * 0.65,
        lineBreak: false,
      });
    }
    document.font("Helvetica").fillColor(muted).fontSize(8.5);
    document.text(`VALIDITY: ${payload.validityDays} DAYS`, pageLeft, cursorY + 4, {
      width: pageWidth,
      align: "right",
      lineBreak: false,
    });
    cursorY += 22;

    // 7. Items table -------------------------------------------------------
    //
    // Strategy: compute the vertical area we have left after reserving space
    // for the totals block, observations, and signature. Real items get their
    // natural height (varies with description detail lines); empty slots
    // share whatever height is left, so the table always fills the page
    // without overflowing onto a second page.
    const colCantW = 48;
    const colDurNumW = 34;
    const colDurUnitW = 42;
    const colPrecioW = 78;
    const colCostoW = 86;
    const colDescW = pageWidth - colCantW - colDurNumW - colDurUnitW - colPrecioW - colCostoW;

    const headerHeight = 20;
    const minRowHeight = 30;
    const totalsRowH = 18;

    // Reserve space for everything that comes AFTER the items table.
    const reservedTotals =
      totalsRowH * 3 + // SUB-TOTAL + ITBIS + TOTAL GENERAL
      (payload.totals.discountAmount && payload.totals.discountAmount !== 0 ? totalsRowH : 0);
    const reservedFooter = 18 + 22 + 76; // observaciones gap + line + signature block
    const tableTopY = cursorY;
    const tableBottomLimit = pageBottom - reservedTotals - reservedFooter;
    const tableAvailable = Math.max(headerHeight + minRowHeight, tableBottomLimit - tableTopY);

    // Table header
    document.rect(pageLeft, cursorY, pageWidth, headerHeight).strokeColor(hairline).lineWidth(0.7).stroke();
    document.font("Helvetica-Bold").fillColor(ink).fontSize(8);
    let tx = pageLeft;
    const drawHeader = (label: string, w: number) => {
      document.text(label, tx, cursorY + 6, { width: w, align: "center", lineBreak: false });
      tx += w;
    };
    drawHeader("CANT.", colCantW);
    drawHeader("DESCRIPCIÓN", colDescW);
    drawHeader("DURACIÓN", colDurNumW + colDurUnitW);
    drawHeader("PRECIO", colPrecioW);
    drawHeader("COSTO", colCostoW);

    // Vertical column dividers in header
    {
      let dx = pageLeft + colCantW;
      [colDescW, colDurNumW + colDurUnitW, colPrecioW].forEach((w) => {
        document.moveTo(dx, cursorY).lineTo(dx, cursorY + headerHeight).strokeColor(hairline).stroke();
        dx += w;
      });
    }

    cursorY += headerHeight;

    const drawItemRow = (
      item: QuotePdfPayload["items"][number] | null,
      rowY: number,
      rowHeight: number,
    ) => {
      // Row outer rect
      document.rect(pageLeft, rowY, pageWidth, rowHeight).strokeColor(hairline).lineWidth(0.7).stroke();
      // Vertical dividers
      let cx = pageLeft + colCantW;
      [colDescW, colDurNumW, colDurUnitW, colPrecioW].forEach((w) => {
        document.moveTo(cx, rowY).lineTo(cx, rowY + rowHeight).strokeColor(hairline).stroke();
        cx += w;
      });

      if (!item) return;

      // Quantity (vertical center)
      document.font("Helvetica").fillColor(ink).fontSize(9);
      document.text(formatAmount(item.quantity), pageLeft, rowY + rowHeight / 2 - 5, {
        width: colCantW,
        align: "center",
        lineBreak: false,
      });
      // Description: bold title + smaller details. When the item has no
      // detail lines, vertically center the title; otherwise top-anchor.
      const descX = pageLeft + colCantW;
      const hasDetail = item.detailLines.length > 0;
      document.font("Helvetica-Bold").fontSize(9);
      const titleY = hasDetail ? rowY + 5 : rowY + rowHeight / 2 - 5;
      document.text(item.titleLine, descX + 6, titleY, {
        width: colDescW - 12,
        align: "center",
        lineBreak: false,
        ellipsis: true,
      });
      if (hasDetail) {
        document.font("Helvetica").fontSize(7.5);
        document.text(item.detailLines.join("\n"), descX + 6, rowY + 16, {
          width: colDescW - 12,
          align: "center",
        });
      }
      const durX = descX + colDescW;
      document.font("Helvetica").fontSize(9);
      document.text(item.durationValue ?? "", durX, rowY + rowHeight / 2 - 5, {
        width: colDurNumW,
        align: "center",
        lineBreak: false,
      });
      document.text(item.durationUnit ?? "", durX + colDurNumW, rowY + rowHeight / 2 - 5, {
        width: colDurUnitW,
        align: "center",
        lineBreak: false,
      });
      const precioX = durX + colDurNumW + colDurUnitW;
      document.text(formatAmount(item.unitPrice), precioX, rowY + rowHeight / 2 - 5, {
        width: colPrecioW,
        align: "center",
        lineBreak: false,
      });
      document.text(formatAmount(item.lineTotal), precioX + colPrecioW, rowY + rowHeight / 2 - 5, {
        width: colCostoW,
        align: "center",
        lineBreak: false,
      });
    };

    // Compute heights for each real item based on title + ACTUAL wrapped
    // detail height (heightOfString takes column width and font into account
    // so we never have detail text spilling into the next row).
    const realItems = payload.items;
    const realHeights = realItems.map((item) => {
      let detailHeight = 0;
      if (item.detailLines.length) {
        const detailText = item.detailLines.join("\n");
        document.font("Helvetica").fontSize(7.5);
        detailHeight = document.heightOfString(detailText, {
          width: colDescW - 12,
          align: "center",
        });
      }
      // 5pt top padding + ~12pt for bold title + detailHeight + 4pt bottom
      const naturalHeight = 5 + 12 + detailHeight + 4;
      return Math.max(minRowHeight, Math.ceil(naturalHeight));
    });
    const realHeightTotal = realHeights.reduce((acc, h) => acc + h, 0);

    // Distribute remaining space across empty rows. Cap empty row count so
    // they don't get absurdly tall when there are very few real items.
    const remainingForEmpties = Math.max(0, tableAvailable - headerHeight - realHeightTotal);
    const maxEmptyRows = 8;
    let emptyCount = Math.min(
      maxEmptyRows,
      Math.max(0, Math.floor(remainingForEmpties / minRowHeight)),
    );
    // Leave at least one full empty row for visual breathing when we have room.
    if (remainingForEmpties >= minRowHeight && emptyCount === 0) emptyCount = 1;

    let emptyRowHeight = minRowHeight;
    if (emptyCount > 0) {
      emptyRowHeight = Math.max(minRowHeight, Math.floor(remainingForEmpties / emptyCount));
    }

    realItems.forEach((item, index) => {
      drawItemRow(item, cursorY, realHeights[index]!);
      cursorY += realHeights[index]!;
    });
    for (let i = 0; i < emptyCount; i += 1) {
      drawItemRow(null, cursorY, emptyRowHeight);
      cursorY += emptyRowHeight;
    }

    // 8. Totals rows -------------------------------------------------------
    const totalsLabelW = pageWidth - colCostoW - colPrecioW;

    const drawTotalsRow = (label: string, valueText: string, isBold = false) => {
      document.rect(pageLeft, cursorY, pageWidth, totalsRowH).strokeColor(hairline).lineWidth(0.7).stroke();
      // Last separator
      document
        .moveTo(pageLeft + totalsLabelW + colPrecioW, cursorY)
        .lineTo(pageLeft + totalsLabelW + colPrecioW, cursorY + totalsRowH)
        .stroke();
      document.font(isBold ? "Helvetica-Bold" : "Helvetica").fillColor(ink).fontSize(9.5);
      document.text(label, pageLeft + 8, cursorY + 5, {
        width: totalsLabelW + colPrecioW - 16,
        align: "right",
        lineBreak: false,
      });
      document.font(isBold ? "Helvetica-Bold" : "Helvetica");
      document.text(valueText, pageLeft + totalsLabelW + colPrecioW, cursorY + 5, {
        width: colCostoW,
        align: "center",
        lineBreak: false,
      });
      cursorY += totalsRowH;
    };

    const ccy = payload.currency.code.toUpperCase();
    const sym = payload.currency.symbol || "$";

    drawTotalsRow(`( ${ccy} ) ${sym} SUB-TOTAL :`, formatAmount(payload.totals.subtotal));

    if (payload.totals.discountAmount && payload.totals.discountAmount !== 0) {
      const ratePart =
        payload.totals.discountRate && payload.totals.discountRate > 0
          ? `${(payload.totals.discountRate * 100).toFixed(2)}%`
          : "";
      const discountLabel = payload.totals.discountLabel ?? "DESCUENTO";
      // Render label + rate as one line, amount on the right.
      document.rect(pageLeft, cursorY, pageWidth, totalsRowH).strokeColor(hairline).lineWidth(0.7).stroke();
      document
        .moveTo(pageLeft + totalsLabelW, cursorY)
        .lineTo(pageLeft + totalsLabelW, cursorY + totalsRowH)
        .stroke();
      document
        .moveTo(pageLeft + totalsLabelW + colPrecioW, cursorY)
        .lineTo(pageLeft + totalsLabelW + colPrecioW, cursorY + totalsRowH)
        .stroke();
      document.font("Helvetica").fillColor(ink).fontSize(9.5);
      document.text(discountLabel, pageLeft + 8, cursorY + 5, {
        width: totalsLabelW - 16,
        align: "right",
        lineBreak: false,
      });
      document.text(ratePart, pageLeft + totalsLabelW, cursorY + 5, {
        width: colPrecioW,
        align: "center",
        lineBreak: false,
      });
      const signedAmount = -Math.abs(payload.totals.discountAmount);
      document.text(formatAmount(signedAmount), pageLeft + totalsLabelW + colPrecioW, cursorY + 5, {
        width: colCostoW,
        align: "center",
        lineBreak: false,
      });
      cursorY += totalsRowH;
    }

    // ITBIS row
    {
      document.rect(pageLeft, cursorY, pageWidth, totalsRowH).strokeColor(hairline).lineWidth(0.7).stroke();
      document
        .moveTo(pageLeft + totalsLabelW, cursorY)
        .lineTo(pageLeft + totalsLabelW, cursorY + totalsRowH)
        .stroke();
      document
        .moveTo(pageLeft + totalsLabelW + colPrecioW, cursorY)
        .lineTo(pageLeft + totalsLabelW + colPrecioW, cursorY + totalsRowH)
        .stroke();
      const itbisPrefix = payload.totals.taxAddedToTotal ? "" : "** ";
      document.font("Helvetica").fillColor(ink).fontSize(9.5);
      document.text(`${itbisPrefix}ITBIS :`, pageLeft + 8, cursorY + 5, {
        width: totalsLabelW - 16,
        align: "right",
        lineBreak: false,
      });
      document.text(`${(payload.totals.taxRate * 100).toFixed(2)}%`, pageLeft + totalsLabelW, cursorY + 5, {
        width: colPrecioW,
        align: "center",
        lineBreak: false,
      });
      // Show amount only when ITBIS is added to the total. Ley de Cine prints
      // the rate but leaves the amount column blank.
      if (payload.totals.taxAddedToTotal) {
        document.text(formatAmount(payload.totals.taxAmount), pageLeft + totalsLabelW + colPrecioW, cursorY + 5, {
          width: colCostoW,
          align: "center",
          lineBreak: false,
        });
      }
      cursorY += totalsRowH;
    }

    drawTotalsRow(`( ${ccy} ) ${sym} TOTAL GENERAL :`, formatAmount(payload.totals.total), true);

    // 9. Observaciones + signature/sello -----------------------------------
    //
    // Pin everything below to fixed Y coordinates measured from the bottom
    // margin. This guarantees the signature, signatory name, legal name and
    // "Recibido por:" all land on page 1 regardless of how tall the items
    // table ended up.
    const observacionesY = cursorY + 14;
    document.font("Helvetica").fillColor(ink).fontSize(9);
    document.text("Observaciones :", pageLeft, observacionesY, { lineBreak: false });
    if (payload.observations && payload.observations.trim()) {
      document.text(payload.observations.trim(), pageLeft + 90, observacionesY, {
        width: pageWidth - 90,
      });
    }

    // Signature block: anchored from page bottom so it never overflows.
    const signatureBoxW = 230;
    const signatureBlockY = pageBottom - 76;
    const signatureLineY = pageBottom - 24;

    if (payload.workspace.signatureBuffer) {
      try {
        document.image(payload.workspace.signatureBuffer, pageLeft + 6, signatureBlockY, {
          fit: [signatureBoxW - 12, 50],
        });
      } catch {
        /* ignore */
      }
    }
    if (payload.workspace.sealBuffer) {
      try {
        document.image(payload.workspace.sealBuffer, pageLeft + signatureBoxW - 36, signatureBlockY - 12, {
          fit: [96, 96],
        });
      } catch {
        /* ignore */
      }
    }

    // Signature line + names (left side).
    document
      .moveTo(pageLeft, signatureLineY)
      .lineTo(pageLeft + signatureBoxW, signatureLineY)
      .strokeColor(ink)
      .lineWidth(0.6)
      .stroke();
    document.font("Helvetica").fontSize(9).fillColor(ink);
    document.text(payload.workspace.signatoryName, pageLeft, signatureLineY + 3, {
      width: signatureBoxW,
      align: "center",
      lineBreak: false,
    });
    document.font("Helvetica").fontSize(8.5).fillColor(ink);
    document.text(payload.workspace.legalName, pageLeft, signatureLineY + 14, {
      width: signatureBoxW,
      align: "center",
      lineBreak: false,
    });

    // Recibido por (right-side).
    document.font("Helvetica").fontSize(9).fillColor(ink);
    document.text("Recibido por:", pageRight - 220, signatureLineY + 3, {
      width: 220,
      align: "right",
      lineBreak: false,
    });

    // pdfkit may have auto-created extra pages from cursor drift on text()
    // calls near the page bottom. Force the document down to a single page
    // by switching back to page 0 and dropping every later page from the
    // page tree before flush.
    const range = document.bufferedPageRange();
    if (range.count > 1) {
      // PDFKit does not expose a public removePage API. The internal page
      // list lives on `document._root.data.Pages.data.Kids` and the count
      // on `Count`. We splice the kids and update the count so only the
      // first page remains.
      const root = (document as unknown as {
        _root: { data: { Pages: { data: { Kids: unknown[]; Count: number } } } };
      })._root;
      const kids = root.data.Pages.data.Kids;
      if (Array.isArray(kids) && kids.length > 1) {
        kids.length = 1;
        root.data.Pages.data.Count = 1;
      }
    }
    document.end();

    const safeNumber = payload.quoteNumber.replace(/[^a-z0-9_-]+/gi, "_");
    return {
      fileName: `Cotizacion_${safeNumber}.pdf`,
      mimeType: "application/pdf" as const,
      buffer: await bufferPromise,
    };
  },
});

export type DocumentGenerationService = ReturnType<typeof createDocumentGenerationService>;
