import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import PDFDocument from "pdfkit";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { extractDocument } from "../../electron/main/services/data/documentExtractionService";

const tmpFile = (suffix: string) =>
  path.join(os.tmpdir(), `doc-extract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${suffix}`);

describe("document extraction service", () => {
  it("parses CSV rows", async () => {
    const file = tmpFile(".csv");
    fs.writeFileSync(file, "Fecha,Concepto,Monto\n2026-05-01,TSS,1000\n2026-05-02,DGII,250\n", "utf8");
    const result = await extractDocument(file, "text/csv", "movs.csv");
    expect(result.kind).toBe("csv");
    expect(result.rowCount).toBe(3);
    expect(result.rows[1]).toEqual(["2026-05-01", "TSS", "1000"]);
    expect(result.text).toContain("TSS");
    fs.unlinkSync(file);
  });

  it("parses XLSX first-sheet rows", async () => {
    const file = tmpFile(".xlsx");
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
    );
    expect(result.kind).toBe("xlsx");
    expect(result.rowCount).toBe(2);
    expect(result.text).toContain("Retiros");
    fs.unlinkSync(file);
  });

  it("extracts text from a PDF", async () => {
    const file = tmpFile(".pdf");
    await new Promise<void>((resolve, reject) => {
      const document = new PDFDocument();
      const stream = fs.createWriteStream(file);
      stream.on("finish", () => resolve());
      stream.on("error", reject);
      document.pipe(stream);
      document.text("FACTURA NCF B0100000123 Monto 1500.00");
      document.end();
    });
    const result = await extractDocument(file, "application/pdf", "factura.pdf");
    expect(result.kind).toBe("pdf");
    expect(result.text).toContain("B0100000123");
    fs.unlinkSync(file);
  });
});
