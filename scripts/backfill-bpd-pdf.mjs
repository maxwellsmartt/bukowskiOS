#!/usr/bin/env node
// Backfill helper — convert Banco Popular monthly PDF statements (the only
// source for Oct→Jan, since the bank's CSV export only goes back ~3 months)
// into Banco Popular-format CSVs that the in-app Treasury importer parses
// natively. This reuses the tested CSV pipeline (dedupe + auto-classify)
// instead of adding a fragile PDF parser to the runtime.
//
// Requires `pdftotext` (poppler):  brew install poppler
//
// Usage:
//   node scripts/backfill-bpd-pdf.mjs ["~/Downloads/finance docs"] [outDir]
//
// It groups PDFs by currency (filenames containing "_USD_" → USD, else DOP),
// extracts each transaction (date, reference, signed amount, balance,
// best-effort description), sorts chronologically, and writes:
//   BPD_RD_backfill.csv  /  BPD_US_backfill.csv
// Import each through Treasury → the matching account.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const expandHome = (p) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);

const inputDir = expandHome(process.argv[2] || path.join(os.homedir(), "Downloads", "finance docs"));
const outDir = expandHome(process.argv[3] || inputDir);

if (!fs.existsSync(inputDir)) {
  console.error(`Input directory not found: ${inputDir}`);
  process.exit(1);
}

// A money token like $45,966.70 or $45,966.70-  (trailing minus = debit).
const MONEY = /\$[\d,]+\.\d{2}-?/g;
const DATE = /^\s*(\d{2}\/\d{2}\/\d{4})\b/;

const parseMoney = (token) => {
  const negative = token.endsWith("-");
  const value = Number.parseFloat(token.replace(/[$,\-]/g, ""));
  return { value: Number.isFinite(value) ? value : 0, negative };
};

const isHeaderNoise = (line) =>
  /Fecha\s+(posteo|efectiva)|Nro\.|Descripci|Balance|Banco Popular|METADATA CINE|P[áa]gina|Estado de|Saldo (Anterior|Disponible)|Total/i.test(
    line,
  );

const parsePdf = (file) => {
  const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  const lines = text.split(/\r?\n/);
  const rows = [];
  let pendingAbove = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) {
      pendingAbove = [];
      continue;
    }
    const dateMatch = DATE.exec(line);
    const monies = line.match(MONEY);
    const isAnchor = dateMatch && monies && monies.length >= 2;

    if (!isAnchor) {
      // Continuation / description fragment. Skip repeated header rows.
      if (!isHeaderNoise(line)) pendingAbove.push(line.trim());
      continue;
    }

    const txnDate = dateMatch[1];
    const balanceToken = monies[monies.length - 1];
    const amountToken = monies[monies.length - 2];
    const { value: amount, negative } = parseMoney(amountToken);
    const { value: balance } = parseMoney(balanceToken);

    // Reference = first longish digit run after the (two) dates.
    const afterDates = line.replace(DATE, "").replace(/^\s*\d{2}\/\d{2}\/\d{4}\b/, "");
    const refMatch = afterDates.match(/\b(\d{3,})\b/);
    const reference = refMatch ? refMatch[1] : "";

    // On-anchor description text = strip dates, the ref, and the trailing money.
    let onLine = afterDates;
    const moneyIdx = onLine.search(MONEY);
    if (moneyIdx >= 0) onLine = onLine.slice(0, moneyIdx);
    if (reference) onLine = onLine.replace(reference, " ");
    onLine = onLine.replace(/\s{2,}/g, " ").trim();

    const description = [...pendingAbove, onLine].filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
    pendingAbove = [];

    rows.push({
      txnDate,
      reference,
      serial: reference,
      amount,
      direction: negative ? "debit" : "credit",
      balance,
      description,
    });
  }
  return rows;
};

const csvField = (value) => {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const toIsoSort = (ddmmyyyy) => {
  const [d, m, y] = ddmmyyyy.split("/");
  return `${y}-${m}-${d}`;
};

const writeBpdCsv = (rows, accountHint, outFile) => {
  const header = [
    "METADATA CINE SRL",
    "Consulta de Transacciones (backfill PDF)",
    "",
    `Banco Popular Dominicano`,
    `Cuenta: ${accountHint}`,
    "",
    "Fecha Posteo,Descripción Corta,Monto Transacción,Balance ,No. Referencia,No. Serial,Descripción",
  ];
  const body = rows.map((r) =>
    [
      r.txnDate,
      r.direction === "credit" ? "Crédito" : "Débito",
      r.amount.toFixed(2),
      r.balance.toFixed(2),
      r.reference,
      r.serial,
      csvField(r.description),
    ].join(","),
  );
  fs.writeFileSync(outFile, [...header, ...body].join("\n") + "\n", "utf8");
};

const pdfs = fs
  .readdirSync(inputDir)
  // Match BPD / BDP (a real filename typo) / POPULAR / ESTADOS_CINE.
  .filter((name) => /\.pdf$/i.test(name) && /B[PD]D|POPULAR|ESTADOS_CINE/i.test(name));

if (pdfs.length === 0) {
  console.error(`No Banco Popular PDFs found in ${inputDir}`);
  process.exit(1);
}

const groups = { DOP: [], USD: [] };
for (const name of pdfs) {
  const currency = /_USD_/i.test(name) ? "USD" : "DOP";
  console.log(`Parsing ${name} → ${currency}`);
  const rows = parsePdf(path.join(inputDir, name));
  groups[currency].push(...rows);
  console.log(`  ${rows.length} movements`);
}

for (const [currency, rows] of Object.entries(groups)) {
  if (rows.length === 0) continue;
  rows.sort((a, b) => toIsoSort(a.txnDate).localeCompare(toIsoSort(b.txnDate)));
  const accountHint = currency === "USD" ? "000000000000819426362" : "000000000000788565075";
  const label = currency === "USD" ? "US" : "RD";
  const outFile = path.join(outDir, `BPD_${label}_backfill.csv`);
  writeBpdCsv(rows, accountHint, outFile);
  const credits = rows.filter((r) => r.direction === "credit").length;
  const debits = rows.length - credits;
  console.log(
    `\n${currency}: ${rows.length} rows (${credits} credits / ${debits} debits) → ${outFile}`,
  );
  console.log(
    `  range ${rows[0].txnDate} → ${rows[rows.length - 1].txnDate}, last balance ${rows[rows.length - 1].balance.toFixed(2)}`,
  );
}

console.log("\nDone. Import each CSV through Treasury → its matching account.");
