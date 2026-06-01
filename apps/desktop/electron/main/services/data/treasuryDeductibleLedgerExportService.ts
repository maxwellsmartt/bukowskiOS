import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

import type { TreasuryDeductibleLedger } from "@contracts";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);

const loadOptionalAssetBuffer = (relativePath: string) => {
  const normalizedRelativePath = relativePath.replace(/^apps\/desktop\//, "");
  const resourcePath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    resourcePath ? path.resolve(resourcePath, path.basename(relativePath)) : null,
    resourcePath ? path.resolve(resourcePath, normalizedRelativePath) : null,
    path.resolve(process.cwd(), relativePath),
    path.resolve(process.cwd(), normalizedRelativePath),
    path.resolve(currentDirPath, "../", normalizedRelativePath),
    path.resolve(currentDirPath, "../../", normalizedRelativePath),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate);
  }
  return null;
};

const metadataLogoBuffer = loadOptionalAssetBuffer("apps/desktop/src/shared/assets/inbox/logos/metadata-logo-black@2x.png");

const collectPdfBuffer = (document: PDFKit.PDFDocument) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

const formatMoney = (value: number, currency: string) =>
  `${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;

const categoryLabelsEs: Record<string, string> = {
  uncategorized: "Sin clasificar",
  crew_fees: "Pagos honorarios",
  services: "Pagos servicios",
  taxes: "Impuestos",
  social_security: "Seguridad social (TSS)",
  bank_fees: "Comisiones bancarias",
  bank_fee: "Comisión bancaria",
  credit_card: "Tarjeta de crédito",
  loan_financing: "Préstamos y financiamiento",
  production_income: "Ingresos de producción",
  interest_income: "Intereses",
  internal_transfer: "Transferencias internas",
  other_expenses: "Otros gastos",
  other_small: "Otros menores",
};

const titleCaseInternalCode = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatCategoryLabel = (value: string | null | undefined) => {
  const normalized = value?.trim();
  if (!normalized) return "";
  return categoryLabelsEs[normalized] ?? titleCaseInternalCode(normalized);
};

const hasValue = (value: string | number | null | undefined) => String(value ?? "").trim().length > 0;

const fiscalStatusLabel = (value: string) => {
  if (value === "accepted") return "Aceptado";
  if (value === "partial") return "Parcial";
  if (value === "rejected") return "Rechazado";
  return "Pendiente";
};

const displayPeriodLabel = (label: string) => {
  if (label.startsWith("FY ")) return `Año fiscal ${label.slice(3)}`;
  return label;
};

const getLedgerQuality = (ledger: TreasuryDeductibleLedger) => {
  const deductibleRows = ledger.rows.filter((row) => row.deductibleAmount > 0);
  return {
    rowCount: ledger.rows.length,
    pendingRows: ledger.rows.filter((row) => row.fiscalStatus === "pending").length,
    missingNcf: deductibleRows.filter((row) => !hasValue(row.supplierNcf)).length,
    missingRnc: deductibleRows.filter((row) => !hasValue(row.counterpartyRnc)).length,
    missingDgiiType: deductibleRows.filter((row) => !hasValue(row.dgiiExpenseType)).length,
    rejectedRows: ledger.rows.filter((row) => row.rejectedAmount > 0).length,
  };
};

const csvCell = (value: string | number | null | undefined) => {
  const raw = value == null ? "" : String(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};

export const buildDeductibleLedgerFileBaseName = (ledger: TreasuryDeductibleLedger) =>
  `treasury-deductible-ledger-${ledger.activePeriodLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "all"}`;

export const buildDeductibleLedgerCsv = (ledger: TreasuryDeductibleLedger) => {
  const headers = [
    "Fecha",
    "Cuenta",
    "Proveedor / contraparte",
    "RNC",
    "NCF proveedor",
    "Tipo DGII",
    "Concepto",
    "Categoría interna",
    "Monto reclamado",
    "Monto deducible",
    "Monto rechazado",
    "Moneda",
    "Tipo retención",
    "Retención %",
    "Monto retenido",
    "Período fiscal",
    "Estado fiscal",
    "Soporte",
    "Referencia",
    "Descripción banco",
  ];
  const lines = [
    headers.map(csvCell).join(","),
    ...ledger.rows.map((row) =>
      [
        row.txnDate,
        row.accountLabel,
        row.counterparty,
        row.counterpartyRnc,
        row.supplierNcf,
        row.dgiiExpenseType,
        row.concept,
        formatCategoryLabel(row.expenseCategory),
        row.claimedAmount,
        row.deductibleAmount,
        row.rejectedAmount,
        row.currency,
        row.withholdingType,
        row.withholdingRate,
        row.withholdingAmount,
        row.fiscalPeriod,
        row.fiscalStatus,
        row.supportDocFileId,
        row.reference,
        row.rawDescription,
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  return `\uFEFF${lines.join("\n")}\n`;
};

export const buildDeductibleLedgerXlsx = (ledger: TreasuryDeductibleLedger) => {
  const workbook = XLSX.utils.book_new();
  const quality = getLedgerQuality(ledger);
  const summaryRows = [
    ["Reporte", "Ledger deducible"],
    ["Período", ledger.activePeriodLabel],
    ["Filas", quality.rowCount],
    ["Pendientes de revisión", quality.pendingRows],
    ["Deducibles sin NCF", quality.missingNcf],
    ["Deducibles sin RNC", quality.missingRnc],
    ["Deducibles sin tipo DGII", quality.missingDgiiType],
    ["Filas con monto rechazado", quality.rejectedRows],
    [],
    ["Moneda", "Monto reclamado", "Monto deducible", "Monto rechazado"],
    ...ledger.totalsByCurrency.map((row) => [row.currency, row.claimedAmount, row.deductibleAmount, row.rejectedAmount]),
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 26 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumen");

  const rows = ledger.rows.map((row) => ({
    Fecha: row.txnDate,
    Cuenta: row.accountLabel,
    "Proveedor / contraparte": row.counterparty ?? "",
    RNC: row.counterpartyRnc ?? "",
    "NCF proveedor": row.supplierNcf ?? "",
    "Tipo DGII": row.dgiiExpenseType ?? "",
    Concepto: row.concept ?? "",
    "Categoría interna": formatCategoryLabel(row.expenseCategory),
    "Monto reclamado": row.claimedAmount,
    "Monto deducible": row.deductibleAmount,
    "Monto rechazado": row.rejectedAmount,
    Moneda: row.currency,
    "Tipo retención": row.withholdingType ?? "",
    "Retención %": row.withholdingRate ?? "",
    "Monto retenido": row.withholdingAmount ?? "",
    "Período fiscal": row.fiscalPeriod ?? "",
    "Estado fiscal": fiscalStatusLabel(row.fiscalStatus),
    Soporte: row.supportDocFileId ?? "",
    Referencia: row.reference ?? "",
    "Descripción banco": row.rawDescription ?? "",
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 12 },
    { wch: 22 },
    { wch: 26 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 28 },
    { wch: 18 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 10 },
    { wch: 16 },
    { wch: 12 },
    { wch: 16 },
    { wch: 12 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 36 },
  ];
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range(XLSX.utils.decode_range(sheet["!ref"] ?? "A1:T1")) };
  XLSX.utils.book_append_sheet(workbook, sheet, "Ledger deducible");
  const totalsSheet = XLSX.utils.json_to_sheet(
    ledger.totalsByCurrency.map((row) => ({
      Moneda: row.currency,
      "Monto reclamado": row.claimedAmount,
      "Monto deducible": row.deductibleAmount,
      "Monto rechazado": row.rejectedAmount,
    })),
  );
  totalsSheet["!cols"] = [{ wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(workbook, totalsSheet, "Totales");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
};

export const createDeductibleLedgerPdf = async (ledger: TreasuryDeductibleLedger) => {
  const document = new PDFDocument({ margin: 44, size: "A4", layout: "landscape" });
  const bufferPromise = collectPdfBuffer(document);
  const pageWidth = document.page.width - document.page.margins.left - document.page.margins.right;
  const left = document.page.margins.left;
  const bottom = document.page.height - document.page.margins.bottom;
  let cursorY = document.page.margins.top;
  const quality = getLedgerQuality(ledger);
  const periodLabel = displayPeriodLabel(ledger.activePeriodLabel);

  const drawBrand = () => {
    if (metadataLogoBuffer) {
      document.image(metadataLogoBuffer, left, cursorY, { fit: [60, 40] });
    } else {
      document.font("Helvetica-Bold").fillColor("#161a22").fontSize(14).text("METADATA", left, cursorY);
    }
    document.fillColor("#111827").font("Helvetica-Bold").fontSize(20).text("Libro de gastos deducibles", left + 76, cursorY + 2, { width: pageWidth - 76 });
    document
      .font("Helvetica")
      .fillColor("#667085")
      .fontSize(9)
      .text(`Período: ${periodLabel} · Generado ${new Date().toISOString().slice(0, 10)} · ${ledger.rows.length} filas`, left + 76, cursorY + 29);
    cursorY += 56;
  };

  drawBrand();

  const drawSegments = (
    segments: Array<{ text: string; bold?: boolean; color?: string }>,
    x: number,
    y: number,
    fontSize: number,
  ) => {
    let cursorX = x;
    for (const segment of segments) {
      document.font(segment.bold ? "Helvetica-Bold" : "Helvetica").fillColor(segment.color ?? "#1a2029").fontSize(fontSize);
      document.text(segment.text, cursorX, y, { lineBreak: false });
      cursorX += document.widthOfString(segment.text);
    }
  };

  const totalsHeight = Math.max(44, ledger.totalsByCurrency.length * 18 + 18);
  document.roundedRect(left, cursorY, pageWidth, totalsHeight, 10).fillAndStroke("#f7f8fa", "#d7dbe2");
  if (ledger.totalsByCurrency.length === 0) {
    document.fillColor("#1a2029").font("Helvetica").fontSize(9).text("No hay gastos deducibles en este período.", left + 16, cursorY + 16, {
      width: pageWidth - 32,
    });
  } else {
    ledger.totalsByCurrency.forEach((row, index) => {
      drawSegments(
        [
          { text: `${row.currency}: `, bold: true, color: "#111827" },
          { text: "Reclamado " },
          { text: formatMoney(row.claimedAmount, row.currency), bold: true },
          { text: " · Deducible " },
          { text: formatMoney(row.deductibleAmount, row.currency), bold: true },
          { text: " · Rechazado " },
          { text: formatMoney(row.rejectedAmount, row.currency), bold: true },
        ],
        left + 16,
        cursorY + 13 + index * 18,
        9,
      );
    });
  }
  cursorY += totalsHeight + 14;

  document.roundedRect(left, cursorY, pageWidth, 34, 10).fillAndStroke("#fff8ea", "#ead2a2");
  document
    .fillColor("#5b4521")
    .font("Helvetica-Bold")
    .fontSize(8.8)
    .text("Revisión fiscal", left + 16, cursorY + 11, { width: 96 });
  drawSegments(
    [
      { text: String(quality.pendingRows), bold: true, color: "#5b4521" },
      { text: " filas pendientes de revisión · ", color: "#5b4521" },
      { text: String(quality.missingNcf), bold: true, color: "#5b4521" },
      { text: " deducibles sin NCF · ", color: "#5b4521" },
      { text: String(quality.missingRnc), bold: true, color: "#5b4521" },
      { text: " deducibles sin RNC · ", color: "#5b4521" },
      { text: String(quality.missingDgiiType), bold: true, color: "#5b4521" },
      { text: " deducibles sin tipo DGII", color: "#5b4521" },
    ],
    left + 120,
    cursorY + 11,
    8.8,
  );
  cursorY += 48;

  const columns = [
    { label: "Fecha", width: 52 },
    { label: "Cuenta", width: 70 },
    { label: "Proveedor / RNC", width: 112 },
    { label: "NCF", width: 62 },
    { label: "Concepto", width: 118 },
    { label: "DGII / Cat.", width: 70 },
    { label: "Reclamado", width: 80 },
    { label: "Deducible", width: 80 },
    { label: "Ret.", width: 54 },
    { label: "Estado", width: 56 },
  ];

  const drawHeader = () => {
    let x = left;
    document.roundedRect(left, cursorY, pageWidth, 22, 6).fill("#eef1f5");
    document.fillColor("#475467").font("Helvetica-Bold").fontSize(7);
    for (const column of columns) {
      document.text(column.label.toUpperCase(), x + 4, cursorY + 6, { width: column.width - 8, height: 10, ellipsis: true });
      x += column.width;
    }
    cursorY += 26;
  };

  drawHeader();
  ledger.rows.forEach((row, rowIndex) => {
    if (cursorY + 32 > bottom) {
      document.addPage();
      cursorY = document.page.margins.top;
      drawHeader();
    }
    let x = left;
    if (rowIndex % 2 === 0) {
      document.roundedRect(left, cursorY - 2, pageWidth, 28, 4).fill("#fbfcfd");
    }
    const values = [
      row.txnDate,
      row.accountLabel,
      [row.counterparty, row.counterpartyRnc].filter(Boolean).join(" / "),
      row.supplierNcf || "",
      row.concept || row.rawDescription || "",
      row.dgiiExpenseType || formatCategoryLabel(row.expenseCategory),
      formatMoney(row.claimedAmount, row.currency),
      formatMoney(row.deductibleAmount, row.currency),
      row.withholdingAmount == null ? "" : formatMoney(row.withholdingAmount, row.currency),
      fiscalStatusLabel(row.fiscalStatus),
    ];
    document.fillColor("#1a2029").font("Helvetica").fontSize(7.6);
    values.forEach((value, index) => {
      document.text(value, x + 4, cursorY + 3, { width: columns[index].width - 8, height: 22, ellipsis: true });
      x += columns[index].width;
    });
    cursorY += 30;
  });

  document.end();
  return await bufferPromise;
};
