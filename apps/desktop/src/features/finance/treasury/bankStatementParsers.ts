import Papa from "papaparse";

import type { BankName, ParsedBankTransaction } from "@contracts";
import { parseBoundedXlsxGrid } from "@shared/lib/xlsxSafety";

/**
 * Bank statement parsers — one preset per real-world format Carlos exports.
 *
 *   1) Banco Popular (BPD) — CSV. Single positive `Monto Transacción`; the
 *      direction lives in `Descripción Corta` ("Crédito…" vs "Débito…").
 *   2) Banco Santa Cruz (BSC) — XLSX. Separate `Retiros` / `Depósitos`
 *      columns (one is 0).
 *
 * Each preset extracts the account number from the statement preamble so the
 * UI can match the file to the right bank account, and normalizes dates to
 * ISO (yyyy-mm-dd).
 */

export type ParsedStatement = {
  bankName: BankName;
  accountNumber: string | null;
  currencyHint: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  rows: ParsedBankTransaction[];
};

const parseNumber = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (value == null) return 0;
  const cleaned = String(value).replace(/[^0-9.,-]/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimalLength = cleaned.length - lastComma - 1;
    normalized = decimalLength > 0 && decimalLength <= 2 ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  } else if ((cleaned.match(/\./g) ?? []).length > 1) {
    const last = cleaned.lastIndexOf(".");
    const decimalLength = cleaned.length - last - 1;
    normalized =
      decimalLength > 0 && decimalLength <= 2
        ? `${cleaned.slice(0, last).replace(/\./g, "")}.${cleaned.slice(last + 1)}`
        : cleaned.replace(/\./g, "");
  } else if (lastDot >= 0 && cleaned.length - lastDot - 1 === 3) {
    normalized = cleaned.replace(/\./g, "");
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** DD/MM/YYYY → yyyy-mm-dd. Falls back to the raw string if it can't parse. */
const toIsoDate = (value: string): string => {
  const trimmed = (value ?? "").trim();
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(trimmed);
  if (slash) {
    const [, dd, mm, yyyyRaw] = slash;
    const yyyy = yyyyRaw.length === 2 ? `20${yyyyRaw}` : yyyyRaw;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return trimmed;
};

const dateRange = (rows: ParsedBankTransaction[]): { start: string | null; end: string | null } => {
  const dates = rows.map((row) => row.txnDate).filter(Boolean).sort();
  return { start: dates[0] ?? null, end: dates[dates.length - 1] ?? null };
};

const currencyFromText = (text: string): string | null => {
  if (/USD|US\$|\bUS\b/i.test(text)) return "USD";
  if (/EUR|€/i.test(text)) return "EUR";
  if (/RD\$|DOP|RD /i.test(text)) return "DOP";
  return null;
};

/* ----------------------------------------------------------------------- */
/* Banco Popular — CSV                                                      */
/* ----------------------------------------------------------------------- */

export const parseBancoPopularCsv = (text: string): ParsedStatement => {
  const lines = text.split(/\r?\n/);
  let accountNumber: string | null = null;
  let currencyHint: string | null = null;
  let headerIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const accountMatch = /Cuenta:\s*0*([0-9]+)/i.exec(line);
    if (accountMatch) accountNumber = accountMatch[1];
    if (!currencyHint) currencyHint = currencyFromText(line);
    if (/Fecha\s+Posteo/i.test(line) && /Monto/i.test(line)) {
      headerIndex = i;
      break;
    }
  }

  const rows: ParsedBankTransaction[] = [];
  if (headerIndex >= 0) {
    const body = lines.slice(headerIndex).join("\n");
    const result = Papa.parse<Record<string, string>>(body, {
      header: true,
      skipEmptyLines: true,
    });
    for (const record of result.data) {
      const keys = Object.keys(record);
      const get = (needle: string) => {
        const key = keys.find((k) => k.toLowerCase().includes(needle));
        return key ? (record[key] ?? "").trim() : "";
      };
      // The short description ("Descripción Corta") carries the direction;
      // the long "Descripción" carries the counterparty. Resolve them
      // separately so we don't duplicate the short one.
      const lc = (k: string) => k.toLowerCase();
      const shortKey = keys.find((k) => lc(k).includes("corta"));
      const longKey = keys.find((k) => lc(k).includes("descrip") && !lc(k).includes("corta"));
      const shortDesc = shortKey ? (record[shortKey] ?? "").trim() : "";
      const longDesc = longKey ? (record[longKey] ?? "").trim() : "";
      const dateRaw = get("fecha");
      const amountRaw = get("monto");
      if (!dateRaw || !amountRaw) continue;
      // Skip repeated header / footer rows (some BPD exports repeat the column
      // header mid-file): only keep records whose date field is an actual date.
      const isRealDate = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(dateRaw) || /^\d{4}-\d{2}-\d{2}/.test(dateRaw);
      if (!isRealDate) continue;

      const isCredit = /^(cr|cré|cre)/i.test(shortDesc);
      const amount = Math.abs(parseNumber(amountRaw));
      if (amount === 0 && !shortDesc) continue;

      rows.push({
        txnDate: toIsoDate(dateRaw),
        valueDate: null,
        rawDescription: [shortDesc, longDesc].filter(Boolean).join(" — "),
        reference: get("referencia") || null,
        serial: get("serial") || null,
        amount,
        direction: isCredit ? "credit" : "debit",
        runningBalance: get("balance") ? parseNumber(get("balance")) : null,
      });
    }
  }

  const range = dateRange(rows);
  return {
    bankName: "popular",
    accountNumber,
    currencyHint,
    periodStart: range.start,
    periodEnd: range.end,
    rows,
  };
};

/* ----------------------------------------------------------------------- */
/* Banco Santa Cruz — XLSX                                                  */
/* ----------------------------------------------------------------------- */

export const parseBancoSantaCruzXlsx = (data: ArrayBuffer | Uint8Array): ParsedStatement => {
  const grid = parseBoundedXlsxGrid(data, "bank statement XLSX");

  let accountNumber: string | null = null;
  let currencyHint: string | null = null;
  let headerRow = -1;
  let cols: { date: number; desc: number; ref: number; check: number; out: number; in: number } | null =
    null;

  for (let i = 0; i < grid.length; i += 1) {
    const cells = grid[i].map((c) => (c == null ? "" : String(c)));
    const joined = cells.join(" ");
    const accountMatch = /\/\s*0*([0-9]{6,})\s*\//.exec(joined);
    if (accountMatch && !accountNumber) accountNumber = accountMatch[1];
    if (!currencyHint) currencyHint = currencyFromText(joined);

    const lower = cells.map((c) => c.toLowerCase());
    const dateIdx = lower.findIndex((c) => c.includes("fecha de posteo") || c === "fecha de posteo");
    const outIdx = lower.findIndex((c) => c.includes("retiro"));
    const inIdx = lower.findIndex((c) => c.includes("dep"));
    if (dateIdx >= 0 && outIdx >= 0 && inIdx >= 0) {
      headerRow = i;
      cols = {
        date: dateIdx,
        desc: lower.findIndex((c) => c.includes("descrip")),
        ref: lower.findIndex((c) => c.includes("referencia")),
        check: lower.findIndex((c) => c.includes("cheque")),
        out: outIdx,
        in: inIdx,
      };
      break;
    }
  }

  const rows: ParsedBankTransaction[] = [];
  if (cols && headerRow >= 0) {
    for (let i = headerRow + 1; i < grid.length; i += 1) {
      const cells = grid[i];
      const dateRaw = cells[cols.date] == null ? "" : String(cells[cols.date]).trim();
      if (!dateRaw || !/\d/.test(dateRaw)) continue;
      const withdrawals = parseNumber(cells[cols.out]);
      const deposits = parseNumber(cells[cols.in]);
      const isCredit = deposits > 0 && deposits >= withdrawals;
      const amount = Math.abs(isCredit ? deposits : withdrawals);
      if (amount === 0) continue;
      rows.push({
        txnDate: toIsoDate(dateRaw),
        valueDate: null,
        rawDescription: cols.desc >= 0 ? String(cells[cols.desc] ?? "").trim() : null,
        reference: cols.ref >= 0 ? String(cells[cols.ref] ?? "").trim() || null : null,
        serial: cols.check >= 0 ? String(cells[cols.check] ?? "").trim() || null : null,
        amount,
        direction: isCredit ? "credit" : "debit",
        runningBalance: null,
      });
    }
  }

  const range = dateRange(rows);
  return {
    bankName: "santa_cruz",
    accountNumber,
    currencyHint,
    periodStart: range.start,
    periodEnd: range.end,
    rows,
  };
};

/** Dispatch by filename / bank hint. */
export const parseStatementFile = async (
  file: File,
  bankName: BankName,
): Promise<ParsedStatement> => {
  const isXlsx = /\.xlsx?$/i.test(file.name) || bankName === "santa_cruz";
  if (isXlsx && !/\.csv$/i.test(file.name)) {
    const buffer = await file.arrayBuffer();
    return parseBancoSantaCruzXlsx(buffer);
  }
  const text = await file.text();
  return parseBancoPopularCsv(text);
};
