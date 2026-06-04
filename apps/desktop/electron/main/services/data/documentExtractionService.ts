import fs from "node:fs";
import { createRequire } from "node:module";

import Papa from "papaparse";

import { assertPathWithinRoot } from "../../security/pathSafety";
import { parseBoundedXlsxGrid } from "../../../../src/shared/lib/xlsxSafety";

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
  return parseBoundedXlsxGrid(new Uint8Array(buffer), "attached XLSX");
};

const normalizeExtractedPdfText = (value: string): string =>
  value
    .replace(/\u0000/g, "-")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/([A-Za-z0-9])\s*-\s*([A-Za-z0-9])/g, "$1-$2")
    .trim();

type CanvasPolyfillModule = {
  DOMMatrix?: typeof globalThis.DOMMatrix;
  ImageData?: typeof globalThis.ImageData;
  Path2D?: typeof globalThis.Path2D;
};

type PdfJsWorkerGlobal = typeof globalThis & {
  pdfjsWorker?: { WorkerMessageHandler?: unknown };
};

const ensurePdfJsNodePolyfills = () => {
  if (globalThis.DOMMatrix && globalThis.ImageData && globalThis.Path2D) return;

  try {
    const require = createRequire(import.meta.url);
    const canvas = require("@napi-rs/canvas") as CanvasPolyfillModule;
    if (!globalThis.DOMMatrix && canvas.DOMMatrix) globalThis.DOMMatrix = canvas.DOMMatrix;
    if (!globalThis.ImageData && canvas.ImageData) globalThis.ImageData = canvas.ImageData;
    if (!globalThis.Path2D && canvas.Path2D) globalThis.Path2D = canvas.Path2D;
  } catch {
    // pdfjs-dist can still extract text from many PDFs without canvas APIs. If
    // it needs one of these globals, the caller receives the original pdfjs
    // error with context instead of failing at app startup.
  }
};

let pdfWorkerSetupPromise: Promise<void> | null = null;

const ensurePdfJsWorker = async () => {
  const globalWithWorker = globalThis as PdfJsWorkerGlobal;
  if (globalWithWorker.pdfjsWorker?.WorkerMessageHandler) return;

  pdfWorkerSetupPromise ??= import("pdfjs-dist/legacy/build/pdf.worker.mjs").then((workerModule) => {
    globalWithWorker.pdfjsWorker = {
      WorkerMessageHandler: (workerModule as { WorkerMessageHandler?: unknown }).WorkerMessageHandler,
    };
  });

  await pdfWorkerSetupPromise;
};

const extractPdfText = async (buffer: Buffer): Promise<string> => {
  ensurePdfJsNodePolyfills();
  await ensurePdfJsWorker();
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
  return normalizeExtractedPdfText(pages.join("\n"));
};

const rowsToText = (rows: string[][], limit = 400) =>
  rows
    .slice(0, limit)
    .map((row) => row.join(" | "))
    .join("\n");

export const extractDocumentFromBuffer = async (
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ExtractedDocument> => {
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

export const extractDocument = async (
  storagePath: string,
  mimeType: string,
  fileName: string,
  allowedRoot: string,
): Promise<ExtractedDocument> =>
  extractDocumentFromBuffer(fs.readFileSync(assertPathWithinRoot(storagePath, allowedRoot)), mimeType, fileName);

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/;

/** Extract from a base64 data URL (how chat attachments arrive at the gateway). */
export const extractDocumentFromDataUrl = async (
  dataUrl: string,
  mimeType: string,
  fileName: string,
): Promise<ExtractedDocument> => {
  const match = dataUrl.match(DATA_URL_RE);
  const buffer = match ? Buffer.from(match[2] ?? "", "base64") : Buffer.from("");
  return extractDocumentFromBuffer(buffer, match?.[1] || mimeType, fileName);
};
