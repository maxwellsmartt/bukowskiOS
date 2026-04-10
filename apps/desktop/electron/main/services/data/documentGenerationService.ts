import PDFDocument from "pdfkit";

type PackingSlipPdfPayload = {
  slipNumber: string;
  projectName: string;
  responsibleName: string;
  dueDate: string;
  items: Array<{
    code: string;
    name: string;
    quantity: number;
  }>;
};

const collectPdfBuffer = (document: PDFKit.PDFDocument) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];

    document.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

export const createDocumentGenerationService = () => ({
  async createPackingSlipPdf(payload: PackingSlipPdfPayload) {
    const document = new PDFDocument({
      margin: 40,
      size: "A4",
    });
    const bufferPromise = collectPdfBuffer(document);

    document.fontSize(18).text(`Packing Slip ${payload.slipNumber}`);
    document.moveDown(0.6);
    document.fontSize(11).text(`Project: ${payload.projectName}`);
    document.text(`Responsible: ${payload.responsibleName}`);
    document.text(`Return due: ${payload.dueDate}`);
    document.moveDown();
    document.fontSize(12).text("Items");
    document.moveDown(0.4);

    payload.items.forEach((item) => {
      document.fontSize(10).text(`${item.code}  ·  ${item.name}  ·  Qty ${item.quantity}`);
    });

    document.end();

    return {
      fileName: `${payload.slipNumber}.pdf`,
      mimeType: "application/pdf" as const,
      buffer: await bufferPromise,
    };
  },
});

export type DocumentGenerationService = ReturnType<typeof createDocumentGenerationService>;
