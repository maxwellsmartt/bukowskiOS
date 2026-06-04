import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import PDFDocument from "pdfkit";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { extractDocument } from "../../electron/main/services/data/documentExtractionService";
import { MAX_XLSX_BYTES } from "../shared/lib/xlsxSafety";

const tmpFile = (suffix: string) =>
  path.join(os.tmpdir(), `doc-extract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${suffix}`);
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "doc-extract-"));

describe("document extraction service", () => {
  it("parses CSV rows", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "movs.csv");
    fs.writeFileSync(file, "Fecha,Concepto,Monto\n2026-05-01,TSS,1000\n2026-05-02,DGII,250\n", "utf8");
    const result = await extractDocument(file, "text/csv", "movs.csv", dir);
    expect(result.kind).toBe("csv");
    expect(result.rowCount).toBe(3);
    expect(result.rows[1]).toEqual(["2026-05-01", "TSS", "1000"]);
    expect(result.text).toContain("TSS");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("parses XLSX first-sheet rows", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "bsc.xlsx");
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Fecha", "Retiros", "Depositos"],
      ["2026-05-01", 500, 0],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Hoja1");
    XLSX.writeFile(workbook, file);
    const result = await extractDocument(
      file,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "bsc.xlsx",
      dir,
    );
    expect(result.kind).toBe("xlsx");
    expect(result.rowCount).toBe(2);
    expect(result.text).toContain("Retiros");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("extracts text from a PDF", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "factura.pdf");
    await new Promise<void>((resolve, reject) => {
      const document = new PDFDocument();
      const stream = fs.createWriteStream(file);
      stream.on("finish", () => resolve());
      stream.on("error", reject);
      document.pipe(stream);
      document.text("FACTURA NCF B0100000123 Monto 1500.00");
      document.end();
    });
    const result = await extractDocument(file, "application/pdf", "factura.pdf", dir);
    expect(result.kind).toBe("pdf");
    expect(result.text).toContain("B0100000123");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects files outside the allowed root", async () => {
    const allowedRoot = tmpDir();
    const file = tmpFile(".csv");
    fs.writeFileSync(file, "Fecha,Concepto,Monto\n2026-05-01,TSS,1000\n", "utf8");
    await expect(extractDocument(file, "text/csv", "movs.csv", allowedRoot)).rejects.toThrow(
      "Refused to access a file outside its workspace storage.",
    );
    fs.rmSync(allowedRoot, { recursive: true, force: true });
    fs.unlinkSync(file);
  });

  it("rejects oversized XLSX attachments before parsing them", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "huge.xlsx");
    fs.writeFileSync(file, Buffer.alloc(MAX_XLSX_BYTES + 1, 0x31));

    await expect(
      extractDocument(
        file,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "huge.xlsx",
        dir,
      ),
    ).rejects.toThrow("Spreadsheet import rejected: attached XLSX exceeds");

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
