import fs from "node:fs";

import Papa from "papaparse";
import * as XLSX from "xlsx";

// Extracts machine-readable content from an attached document so agents can
// reason over it (free docs) or import it (bank statements). CSV/XLSX use the
// already-bundled papaparse/xlsx; PDF text is pulled with pdfjs-dist (loaded
// lazily so it only costs when a PDF is actually processed).

export type ExtractedDocumentKind = "csv" | "xlsx" | "pdf" | "text" | "unknown";

export type ExtractedDocument = {
  kind: ExtractedDocumentKind;
  /** Flat text preview suitable for an LLM (bounded length). */
  text: string;
  /** For tabular sources: parsed rows (CSV = single sheet; XLSX = first sheet). */
  rows: string[][];
  rowCount: number;
  truncated: boolean;
};

const MAX_TEXT = 24_000;

const resolveKind = (mimeType: string, fileName: string): ExtractedDocumentKind => {
  const lowerName = fileName.toLowerCase();
  const lowerMime = (mimeType || "").toLowerCase();
  if (lowerMime.includes("csv") || lowerName.endsWith(".csv")) return "csv";
  if (lowerMime.includes("spreadsheet") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) return "xlsx";
  if (lowerMime.includes("pdf") || lowerName.endsWith(".pdf")) return "pdf";
  if (lowerMime.startsWith("text/") || lowerName.endsWith(".txt")) return "text";
  return "unknown";
};

const clampText = (value: string): { text: string; truncated: boolean } => {
  if (value.length <= MAX_TEXT) return { text: value, truncated: false };
  return { text: `${value.slice(0, MAX_TEXT)}\n…[truncated]`, truncated: true };
};

const parseCsvRows = (text: string): string[][] => {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  return (result.data as unknown as string[][]).map((row) => row.map((cell) => String(cell ?? "")));
};

const parseXlsxRows = (buffer: Buffer): string[][] => {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false }) as unknown[][];
  return grid.map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
};

const extractPdfText = async (buffer: Buffer): Promise<string> => {
  // Lazy ESM import of the legacy node build so the worker is optional.
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
    getDocument: (options: { data: Uint8Array; useSystemFonts?: boolean; isEvalSupported?: boolean }) => {
      promise: Promise<{
        numPages: number;
        getPage: (index: number) => Promise<{
          getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
        }>;
      }>;
    };
  };
  const data = new Uint8Array(buffer);
  const document = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str ?? "").join(" "));
  }
  return pages.join("\n");
};

const rowsToText = (rows: string[][], limit = 400) =>
  rows
    .slice(0, limit)
    .map((row) => row.join(" | "))
    .join("\n");

export const extractDocument = async (
  storagePath: string,
  mimeType: string,
  fileName: string,
): Promise<ExtractedDocument> => {
  const buffer = fs.readFileSync(storagePath);
  const kind = resolveKind(mimeType, fileName);

  if (kind === "csv" || kind === "text") {
    const rows = kind === "csv" ? parseCsvRows(buffer.toString("utf8")) : [];
    const raw = kind === "csv" ? rowsToText(rows) : buffer.toString("utf8");
    const { text, truncated } = clampText(raw);
    return { kind, text, rows, rowCount: rows.length, truncated };
  }

  if (kind === "xlsx") {
    const rows = parseXlsxRows(buffer);
    const { text, truncated } = clampText(rowsToText(rows));
    return { kind, text, rows, rowCount: rows.length, truncated };
  }

  if (kind === "pdf") {
    const raw = await extractPdfText(buffer);
    const { text, truncated } = clampText(raw);
    return { kind, text, rows: [], rowCount: 0, truncated };
  }

  return { kind: "unknown", text: "", rows: [], rowCount: 0, truncated: false };
};
