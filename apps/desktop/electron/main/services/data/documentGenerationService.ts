import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

type PackingSlipPdfPayload = {
  slipNumber: string;
  projectName: string;
  departmentName: string;
  responsibleName: string;
  preparedByName: string;
  issueDate: string;
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

const metadataLogoBuffer = loadOptionalAssetBuffer("apps/desktop/electron/main/assets/logos/metadata-cine-logo.png");

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
    const accentSoft = "#efe8dc";
    const columnGap = 16;
    const headerHeight = 90;
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
      document.fillColor(surfaceText).fontSize(13).text(title, cardLeft, cursorY, { width: cardWidth });
      cursorY += 18;

      if (subtitle) {
        document.fillColor(surfaceMuted).fontSize(10).text(subtitle, cardLeft, cursorY, { width: cardWidth });
        cursorY += 18;
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

    document.roundedRect(cardLeft, top, cardWidth, headerHeight, 18).fillAndStroke(accentBackground, "#22262c");

    const logoWidth = metadataLogoBuffer ? 118 : 0;
    const logoGap = metadataLogoBuffer ? 2 : 0;
    const slipInfoX = cardLeft + 24 + logoWidth + logoGap - 42;

    if (metadataLogoBuffer) {
      document.image(metadataLogoBuffer, cardLeft + 24, top + 24, {
        fit: [118, 44],
        valign: "center",
      });
    }

    document.fillColor("#7d8595").fontSize(10).text("Packing slip", slipInfoX, top + 33, {
      width: 220,
      characterSpacing: 1.2,
    });
    document.fillColor("#f4f5f7").fontSize(22).text(payload.slipNumber, slipInfoX, top + 47, {
      width: 220,
    });
    document.image(qrBuffer, cardLeft + cardWidth - 80, top + 18, {
      width: 56,
      height: 56,
    });

    const drawMetaRow = (label: string, value: string, x: number, y: number, width: number) => {
      document.fillColor(surfaceMuted).fontSize(9).text(label.toUpperCase(), x, y, {
        width,
        characterSpacing: 0.9,
      });
      document.fillColor(surfaceText).fontSize(11).text(value || "—", x, y + 14, {
        width,
      });
    };

    const leftColumnWidth = 280;
    const rightColumnWidth = cardWidth - leftColumnWidth - columnGap;

    drawMetaRow("Project", payload.projectName, cardLeft, cursorY, leftColumnWidth);
    drawMetaRow("Department", payload.departmentName, cardLeft + leftColumnWidth + columnGap, cursorY, rightColumnWidth);

    cursorY += 46;
    drawMetaRow("Responsible", payload.responsibleName, cardLeft, cursorY, leftColumnWidth);
    drawMetaRow("Prepared by", payload.preparedByName, cardLeft + leftColumnWidth + columnGap, cursorY, rightColumnWidth);

    cursorY += 46;
    drawMetaRow("Issued", payload.issueDate, cardLeft, cursorY, 130);
    drawMetaRow("Due", payload.dueDate, cardLeft + 146, cursorY, 130);
    drawMetaRow("Department", payload.departmentName, cardLeft + 292, cursorY, 140);
    drawMetaRow("Items", String(payload.summary.itemCount), cardLeft + 448, cursorY, 56);

    cursorY += 48;

    drawSectionHeading("Issued items", "Grouped view of the exact assets linked to this slip.");

    const columns = [
      { label: "Cantidad", width: 56, align: "right" as const },
      { label: "Nombre", width: 170, align: "left" as const },
      { label: "Código", width: 92, align: "left" as const },
      { label: "Serial", width: 112, align: "left" as const },
      { label: "Location", width: cardWidth - 56 - 170 - 92 - 112, align: "left" as const },
    ] as const;

    const drawTableHeader = () => {
      ensurePageSpace(42);
      const headerHeight = 30;
      document.roundedRect(cardLeft, cursorY, cardWidth, headerHeight, 10).fill(accentBackground);
      let x = cardLeft + 10;
      columns.forEach((column) => {
        document.font("Helvetica-Bold");
        document.fillColor("#eef2f8").fontSize(8.5).text(column.label, x, cursorY + 11, {
          width: column.width - 10,
          align: column.align,
          lineBreak: false,
          ellipsis: true,
        });
        document.font("Helvetica");
        x += column.width;
      });
      cursorY += headerHeight + 10;
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
        const contentHeights = rowValues.map((value, valueIndex) =>
          document.heightOfString(value, {
            width: columns[valueIndex]!.width - 14,
            align: columns[valueIndex]!.align,
          }),
        );
        const rowHeight = Math.max(32, Math.ceil(Math.max(...contentHeights)) + 12);

        if (cursorY + rowHeight > document.page.height - document.page.margins.bottom - footerReserve) {
          document.addPage();
          cursorY = document.page.margins.top;
          drawTableHeader();
        }

        if (index % 2 === 0) {
          document.roundedRect(cardLeft, cursorY - 4, cardWidth, rowHeight, 10).fill(surfaceBackground);
        }

        let x = cardLeft + 10;
        rowValues.forEach((value, valueIndex) => {
          const isPrimaryCell = valueIndex === 1;
          document.font(isPrimaryCell ? "Helvetica-Bold" : "Helvetica");
          document.fillColor(isPrimaryCell ? "#18202a" : surfaceText).fontSize(isPrimaryCell ? 10 : 9.25).text(value, x, cursorY + 6, {
            width: columns[valueIndex]!.width - 14,
            align: columns[valueIndex]!.align,
            ellipsis: valueIndex !== 0,
            lineBreak: false,
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
      fileName: `${payload.slipNumber}.pdf`,
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
});

export type DocumentGenerationService = ReturnType<typeof createDocumentGenerationService>;
