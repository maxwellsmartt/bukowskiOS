import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { AppPrintResult } from "@contracts";

type GeneratedPdf = {
  fileName: string;
  mimeType: "application/pdf";
  buffer: Buffer;
};

type PrintGeneratedPdfInput = {
  fileName: string;
  title: string;
  createPdf: (targetFilePath: string) => Promise<GeneratedPdf>;
};

const sanitizePdfFileName = (fileName: string) => {
  const baseName = path
    .basename(fileName)
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!baseName.toLowerCase().endsWith(".pdf")) {
    return `${baseName || "document"}.pdf`;
  }

  return baseName || "document.pdf";
};

const createTempPdfPath = async (fileName: string) => {
  const printRoot = await fs.mkdtemp(path.join(app.getPath("temp"), "bukowskios-print-"));
  return {
    printRoot,
    filePath: path.join(printRoot, sanitizePdfFileName(fileName)),
  };
};

const assertPdfBuffer = (pdf: GeneratedPdf) => {
  if (pdf.mimeType !== "application/pdf") {
    throw new Error("Document generator did not return a PDF.");
  }

  if (!Buffer.isBuffer(pdf.buffer) || pdf.buffer.length < 5 || pdf.buffer.subarray(0, 5).toString("utf8") !== "%PDF-") {
    throw new Error("Document generator returned an invalid PDF.");
  }
};

const printPdfFile = async (filePath: string, title: string): Promise<AppPrintResult> => {
  const printWindow = new BrowserWindow({
    show: false,
    title,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  try {
    await printWindow.loadURL(pathToFileURL(filePath).toString());

    return await new Promise<AppPrintResult>((resolve, reject) => {
      printWindow.webContents.print(
        {
          printBackground: true,
          silent: false,
        },
        (success, failureReason) => {
          if (success) {
            resolve({
              printed: true,
              fileName: path.basename(filePath),
              summary: `${title} enviado a impresión.`,
            });
            return;
          }

          const reason = failureReason || "Print job did not complete.";
          if (/cancel/i.test(reason)) {
            resolve({
              printed: false,
              fileName: path.basename(filePath),
              summary: "Impresión cancelada.",
            });
            return;
          }

          reject(new Error(reason));
        },
      );
    });
  } finally {
    printWindow.destroy();
  }
};

export const printGeneratedPdf = async ({
  fileName,
  title,
  createPdf,
}: PrintGeneratedPdfInput): Promise<AppPrintResult> => {
  const temp = await createTempPdfPath(fileName);

  try {
    const pdf = await createPdf(temp.filePath);
    assertPdfBuffer(pdf);
    await fs.writeFile(temp.filePath, pdf.buffer);
    return await printPdfFile(temp.filePath, title);
  } finally {
    await fs.rm(temp.printRoot, { force: true, recursive: true });
  }
};
