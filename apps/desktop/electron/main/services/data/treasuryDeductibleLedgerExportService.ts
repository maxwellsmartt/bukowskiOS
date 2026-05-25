import PDFDocument from "pdfkit";
import * as XLSX from "xlsx";

import type { TreasuryDeductibleLedger } from "@contracts";

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

const csvCell = (value: string | number | null | undefined) => {
  const raw = value == null ? "" : String(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};

export const buildDeductibleLedgerFileBaseName = (ledger: TreasuryDeductibleLedger) =>
  `treasury-deductible-ledger-${ledger.activePeriodLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "all"}`;

export const buildDeductibleLedgerCsv = (ledger: TreasuryDeductibleLedger) => {
  const headers = [
    "Date",
    "Account",
    "Counterparty",
    "RNC",
    "Concept",
    "Category",
    "Claimed amount",
    "Deductible amount",
    "Rejected amount",
    "Currency",
    "Fiscal status",
    "Support doc",
    "Reference",
    "Raw description",
  ];
  const lines = [
    headers.map(csvCell).join(","),
    ...ledger.rows.map((row) =>
      [
        row.txnDate,
        row.accountLabel,
        row.counterparty,
        row.counterpartyRnc,
        row.concept,
        row.expenseCategory,
        row.claimedAmount,
        row.deductibleAmount,
        row.rejectedAmount,
        row.currency,
        row.fiscalStatus,
        row.supportDocFileId,
        row.reference,
        row.rawDescription,
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  return `${lines.join("\n")}\n`;
};

export const buildDeductibleLedgerXlsx = (ledger: TreasuryDeductibleLedger) => {
  const workbook = XLSX.utils.book_new();
  const rows = ledger.rows.map((row) => ({
    Date: row.txnDate,
    Account: row.accountLabel,
    Counterparty: row.counterparty ?? "",
    RNC: row.counterpartyRnc ?? "",
    Concept: row.concept ?? "",
    Category: row.expenseCategory ?? "",
    "Claimed amount": row.claimedAmount,
    "Deductible amount": row.deductibleAmount,
    "Rejected amount": row.rejectedAmount,
    Currency: row.currency,
    "Fiscal status": row.fiscalStatus,
    "Support doc": row.supportDocFileId ?? "",
    Reference: row.reference ?? "",
    "Raw description": row.rawDescription ?? "",
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Deductible Ledger");
  const totalsSheet = XLSX.utils.json_to_sheet(
    ledger.totalsByCurrency.map((row) => ({
      Currency: row.currency,
      "Claimed amount": row.claimedAmount,
      "Deductible amount": row.deductibleAmount,
      "Rejected amount": row.rejectedAmount,
    })),
  );
  XLSX.utils.book_append_sheet(workbook, totalsSheet, "Totals");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
};

export const createDeductibleLedgerPdf = async (ledger: TreasuryDeductibleLedger) => {
  const document = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });
  const bufferPromise = collectPdfBuffer(document);
  const pageWidth = document.page.width - document.page.margins.left - document.page.margins.right;
  const left = document.page.margins.left;
  const bottom = document.page.height - document.page.margins.bottom;
  let cursorY = document.page.margins.top;

  const ensureSpace = (height: number) => {
    if (cursorY + height <= bottom) return;
    document.addPage();
    cursorY = document.page.margins.top;
  };

  document.fillColor("#161a22").fontSize(18).text("Libro de gastos deducibles", left, cursorY, { width: pageWidth });
  cursorY += 24;
  document.fillColor("#6c7585").fontSize(10).text(`${ledger.activePeriodLabel} - Generated ${new Date().toISOString().slice(0, 10)}`, left, cursorY);
  cursorY += 22;

  const totalText = ledger.totalsByCurrency
    .map(
      (row) =>
        `${row.currency}: claimed ${formatMoney(row.claimedAmount, row.currency)} | deductible ${formatMoney(row.deductibleAmount, row.currency)} | rejected ${formatMoney(row.rejectedAmount, row.currency)}`,
    )
    .join("\n");
  document.roundedRect(left, cursorY, pageWidth, 44, 8).fillAndStroke("#f7f8fa", "#d7dbe2");
  document.fillColor("#1a2029").fontSize(9).text(totalText || "No deductible expense rows in this period.", left + 12, cursorY + 10, {
    width: pageWidth - 24,
  });
  cursorY += 58;

  const columns = [
    { label: "Date", width: 58 },
    { label: "Account", width: 94 },
    { label: "Counterparty / RNC", width: 128 },
    { label: "Concept", width: 148 },
    { label: "Category", width: 92 },
    { label: "Claimed", width: 78 },
    { label: "Deductible", width: 78 },
    { label: "Status", width: 58 },
  ];

  const drawHeader = () => {
    ensureSpace(26);
    let x = left;
    document.fillColor("#6c7585").fontSize(7);
    for (const column of columns) {
      document.text(column.label.toUpperCase(), x, cursorY, { width: column.width });
      x += column.width;
    }
    cursorY += 14;
    document.moveTo(left, cursorY).lineTo(left + pageWidth, cursorY).strokeColor("#d7dbe2").lineWidth(1).stroke();
    cursorY += 8;
  };

  drawHeader();
  for (const row of ledger.rows) {
    ensureSpace(34);
    let x = left;
    const values = [
      row.txnDate,
      row.accountLabel,
      [row.counterparty, row.counterpartyRnc].filter(Boolean).join(" / "),
      row.concept || row.rawDescription || "",
      row.expenseCategory || "",
      formatMoney(row.claimedAmount, row.currency),
      formatMoney(row.deductibleAmount, row.currency),
      row.fiscalStatus,
    ];
    document.fillColor("#1a2029").fontSize(8);
    values.forEach((value, index) => {
      document.text(value, x, cursorY, { width: columns[index].width - 6, height: 24, ellipsis: true });
      x += columns[index].width;
    });
    cursorY += 30;
  }

  document.end();
  return await bufferPromise;
};
