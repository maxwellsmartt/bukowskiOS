import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

import type { DgiiReport } from "@contracts";

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

const cellText = (value: string | number | null | undefined) => (value == null ? "" : String(value));
const hasValue = (value: string | number | null | undefined) => cellText(value).trim().length > 0;
const formatNumber = (value: string | number | null | undefined) => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return cellText(value);
  return numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const displayPeriodLabel = (label: string) => {
  if (label.startsWith("FY ")) return `Año fiscal ${label.slice(3)}`;
  return label;
};

const titleCaseTotalLabel = (value: string) =>
  value
    .replace(/\bdeducible\b/g, "Deducible")
    .replace(/\bfacturado\b/g, "Facturado")
    .replace(/\btotal\b/g, "Total")
    .replace(/\banulados\b/g, "Anulados")
    .replace(/\bitbis\b/gi, "ITBIS");

const splitBoldNumbers = (value: string, color = "#1a2029") => {
  const parts = titleCaseTotalLabel(value).split(/(\d[\d,.]*(?:\s?(?:DOP|USD|EUR))?)/g).filter(Boolean);
  return parts.map((part) => ({
    text: part,
    bold: /^\d/.test(part),
    color,
  }));
};

const requiredColumnsByReport: Record<DgiiReport["kind"], Array<{ key: string; label: string }>> = {
  "606": [
    { key: "rnc", label: "RNC / Cédula" },
    { key: "ncf", label: "NCF" },
    { key: "dgiiType", label: "Tipo bienes/servicios" },
  ],
  "607": [
    { key: "ncf", label: "NCF" },
    { key: "date", label: "Fecha comprobante" },
    { key: "client", label: "Cliente" },
  ],
  "608": [
    { key: "ncf", label: "NCF anulado" },
    { key: "voidedAt", label: "Fecha anulación" },
  ],
};

const getDgiiQuality = (report: DgiiReport) => {
  const requiredColumns = requiredColumnsByReport[report.kind] ?? [];
  const missingByColumn = requiredColumns.map((column) => ({
    ...column,
    count: report.rows.filter((row) => !hasValue(row[column.key])).length,
  }));
  const rowsWithIssues = report.rows
    .map((row, index) => {
      const missing = requiredColumns.filter((column) => !hasValue(row[column.key])).map((column) => column.label);
      return {
        rowNumber: index + 2,
        missing,
        date: cellText(row.date ?? row.voidedAt ?? row.issueDate),
        name: cellText(row.supplier ?? row.client),
        ncf: cellText(row.ncf),
      };
    })
    .filter((row) => row.missing.length > 0);
  return {
    missingByColumn,
    rowsWithIssues,
    issueCount: rowsWithIssues.length,
  };
};

const csvCell = (value: string | number | null | undefined) => {
  const raw = cellText(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};

export const buildDgiiReportFileBaseName = (report: DgiiReport) =>
  `dgii-${report.kind}-${report.activePeriodLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "all"}`;

export const buildDgiiReportCsv = (report: DgiiReport) => {
  const lines = [
    report.columns.map((column) => csvCell(column.label)).join(","),
    ...report.rows.map((row) => report.columns.map((column) => csvCell(row[column.key])).join(",")),
  ];
  return `\uFEFF${lines.join("\n")}\n`;
};

export const buildDgiiReportXlsx = (report: DgiiReport) => {
  const workbook = XLSX.utils.book_new();
  const quality = getDgiiQuality(report);
  const summaryRows = [
    ["Reporte", report.title],
    ["Período", report.activePeriodLabel],
    ["Filas", report.rowCount],
    ["Filas con campos requeridos faltantes", quality.issueCount],
    [],
    ["Totales"],
    ...report.totals.map((total) => [total.label, total.value]),
    [],
    ["Campo requerido", "Faltantes"],
    ...quality.missingByColumn.map((column) => [column.label, column.count]),
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 38 }, { wch: 54 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumen");

  const rows = report.rows.map((row) => {
    const mapped: Record<string, string | number> = {};
    for (const column of report.columns) {
      const value = row[column.key];
      mapped[column.label] = value == null ? "" : value;
    }
    return mapped;
  });
  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: report.columns.map((column) => column.label),
  });
  sheet["!cols"] = report.columns.map((column) => ({ wch: column.numeric ? 16 : Math.min(Math.max(column.label.length + 8, 14), 28) }));
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range(XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1")) };
  XLSX.utils.book_append_sheet(workbook, sheet, report.kind);
  if (quality.rowsWithIssues.length > 0) {
    const validationSheet = XLSX.utils.json_to_sheet(
      quality.rowsWithIssues.map((row) => ({
        "Fila del reporte": row.rowNumber,
        Fecha: row.date,
        Nombre: row.name,
        NCF: row.ncf,
        "Campos faltantes": row.missing.join(", "),
      })),
    );
    validationSheet["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 34 }, { wch: 18 }, { wch: 48 }];
    validationSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    validationSheet["!autofilter"] = { ref: XLSX.utils.encode_range(XLSX.utils.decode_range(validationSheet["!ref"] ?? "A1:E1")) };
    XLSX.utils.book_append_sheet(workbook, validationSheet, "Validaciones");
  }
  if (report.totals.length > 0) {
    const totalsSheet = XLSX.utils.json_to_sheet(
      report.totals.map((total) => ({ "": total.label, Total: total.value })),
    );
    totalsSheet["!cols"] = [{ wch: 22 }, { wch: 48 }];
    XLSX.utils.book_append_sheet(workbook, totalsSheet, "Totales");
  }
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
};

export const createDgiiReportPdf = async (report: DgiiReport) => {
  const document = new PDFDocument({ margin: 44, size: "A4", layout: "landscape" });
  const bufferPromise = collectPdfBuffer(document);
  const pageWidth = document.page.width - document.page.margins.left - document.page.margins.right;
  const left = document.page.margins.left;
  const bottom = document.page.height - document.page.margins.bottom;
  let cursorY = document.page.margins.top;
  const quality = getDgiiQuality(report);
  const periodLabel = displayPeriodLabel(report.activePeriodLabel);

  const addPage = () => {
    document.addPage();
    cursorY = document.page.margins.top;
  };

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

  if (metadataLogoBuffer) {
    document.image(metadataLogoBuffer, left, cursorY, { fit: [60, 40] });
  } else {
    document.font("Helvetica-Bold").fillColor("#161a22").fontSize(14).text("METADATA", left, cursorY);
  }
  document.fillColor("#111827").font("Helvetica-Bold").fontSize(20).text(report.title, left + 76, cursorY + 2, { width: pageWidth - 76 });
  document
    .font("Helvetica")
    .fillColor("#667085")
    .fontSize(9)
    .text(`Período: ${periodLabel} · Generado ${new Date().toISOString().slice(0, 10)} · ${report.rowCount} filas`, left + 76, cursorY + 29);
  cursorY += 56;

  if (report.totals.length > 0) {
    const totalsHeight = Math.max(44, report.totals.length * 18 + 18);
    document.roundedRect(left, cursorY, pageWidth, totalsHeight, 10).fillAndStroke("#f7f8fa", "#d7dbe2");
    report.totals.forEach((total, index) => {
      drawSegments(
        [{ text: `${total.label}: `, bold: true, color: "#111827" }, ...splitBoldNumbers(total.value)],
        left + 16,
        cursorY + 13 + index * 18,
        9,
      );
    });
    cursorY += totalsHeight + 14;
  }

  const qualityTone = quality.issueCount > 0 ? ["#fff8ea", "#ead2a2", "#5b4521"] : ["#eef8f3", "#b7ddc8", "#24563a"];
  const qualityText =
    quality.issueCount > 0
      ? `${quality.issueCount} filas con campos requeridos faltantes · ${quality.missingByColumn
          .map((column) => `${column.label}: ${column.count}`)
          .join(" · ")}`
      : "Sin faltantes en los campos requeridos revisados.";
  document.roundedRect(left, cursorY, pageWidth, 34, 10).fillAndStroke(qualityTone[0], qualityTone[1]);
  document.fillColor(qualityTone[2]).font("Helvetica-Bold").fontSize(8.8).text("Validación", left + 16, cursorY + 11, { width: 76 });
  drawSegments(splitBoldNumbers(qualityText, qualityTone[2]), left + 100, cursorY + 11, 8.8);
  cursorY += 50;

  const numericColumns = report.columns.filter((column) => column.numeric).length;
  const textColumns = Math.max(report.columns.length - numericColumns, 1);
  const numericWidth = 76;
  const textWidth = (pageWidth - numericColumns * numericWidth) / textColumns;
  const columnWidths = report.columns.map((column) => (column.numeric ? numericWidth : Math.max(textWidth, 66)));

  const drawHeader = () => {
    let x = left;
    document.roundedRect(left, cursorY, pageWidth, 22, 6).fill("#eef1f5");
    document.fillColor("#475467").font("Helvetica-Bold").fontSize(7);
    report.columns.forEach((column, index) => {
      document.text(column.label.toUpperCase(), x + 4, cursorY + 5, { width: columnWidths[index] - 8, height: 12, ellipsis: true });
      x += columnWidths[index];
    });
    cursorY += 26;
  };

  drawHeader();
  if (report.rows.length === 0) {
    document.roundedRect(left, cursorY + 6, pageWidth, 78, 12).fillAndStroke("#fbfcfd", "#e5e7eb");
    document
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(13)
      .text("Sin registros para este período", left + 24, cursorY + 26, { width: pageWidth - 48, align: "center" });
    document
      .fillColor("#667085")
      .font("Helvetica")
      .fontSize(9)
      .text("El reporte se generó correctamente, pero no hay filas que mostrar con los filtros actuales.", left + 24, cursorY + 46, {
        width: pageWidth - 48,
        align: "center",
      });
    document.end();
    return await bufferPromise;
  }

  report.rows.forEach((row, rowIndex) => {
    if (cursorY + 22 > bottom) {
      addPage();
      drawHeader();
    }
    if (rowIndex % 2 === 0) {
      document.roundedRect(left, cursorY - 2, pageWidth, 18, 4).fill("#fbfcfd");
    }
    let x = left;
    document.fillColor("#1a2029").font("Helvetica").fontSize(7.5);
    report.columns.forEach((column, index) => {
      const value = column.numeric ? formatNumber(row[column.key]) : cellText(row[column.key]);
      document.text(value, x + 4, cursorY + 2, {
        align: column.numeric ? "right" : "left",
        width: columnWidths[index] - 8,
        height: 14,
        ellipsis: true,
      });
      x += columnWidths[index];
    });
    cursorY += 20;
  });

  document.end();
  return await bufferPromise;
};
