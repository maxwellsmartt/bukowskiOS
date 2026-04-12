import PDFDocument from "pdfkit";
import QRCode from "qrcode";

type PackingSlipPdfPayload = {
  slipNumber: string;
  projectName: string;
  departmentName: string;
  responsibleName: string;
  preparedByName: string;
  issueDate: string;
  dueDate: string;
  status: string;
  notes: string;
  primaryCodeValue: string;
  summary: {
    itemCount: number;
    returnedCount: number;
    pendingCount: number;
  };
  items: Array<{
    code: string;
    name: string;
    quantity: number;
    conditionOut: string;
    conditionIn: string;
    location: string;
    responsible: string;
    status: string;
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
    const qrBuffer = await QRCode.toBuffer(payload.primaryCodeValue, {
      margin: 1,
      width: 240,
      color: {
        dark: "#141619",
        light: "#ffffff",
      },
    });

    const document = new PDFDocument({
      margin: 40,
      size: "A4",
    });
    const bufferPromise = collectPdfBuffer(document);

    const pageWidth = document.page.width - document.page.margins.left - document.page.margins.right;
    const cardWidth = pageWidth;
    const cardLeft = document.page.margins.left;
    const top = document.page.margins.top;
    const surfaceBorder = "#d7dbe2";
    const surfaceMuted = "#6c7585";
    const surfaceText = "#1a2029";
    const surfaceBackground = "#f7f8fa";
    const accentBackground = "#141619";
    const columnGap = 16;

    document
      .roundedRect(cardLeft, top, cardWidth, 120, 18)
      .fillAndStroke(accentBackground, "#22262c");

    document.fillColor("#7d8595").fontSize(10).text("Packing slip", cardLeft + 24, top + 18, {
      width: 220,
      characterSpacing: 1.2,
    });
    document.fillColor("#f4f5f7").fontSize(24).text(payload.slipNumber, cardLeft + 24, top + 34, {
      width: 320,
    });
    document.fillColor("#c2c7d0").fontSize(11).text(payload.projectName, cardLeft + 24, top + 68, {
      width: 320,
    });
    document.fillColor("#8f98a8").fontSize(10).text(`Status · ${payload.status}`, cardLeft + 24, top + 92, {
      width: 180,
    });

    document.image(qrBuffer, cardLeft + cardWidth - 108, top + 18, {
      width: 84,
      height: 84,
    });

    let cursorY = top + 144;

    const drawMetaRow = (label: string, value: string, x: number, y: number, width: number) => {
      document.fillColor(surfaceMuted).fontSize(9).text(label.toUpperCase(), x, y, {
        width,
        characterSpacing: 0.9,
      });
      document.fillColor(surfaceText).fontSize(11).text(value || "—", x, y + 14, {
        width,
      });
    };

    const leftColumnWidth = 280;
    const rightColumnWidth = cardWidth - leftColumnWidth - columnGap;

    drawMetaRow("Project", payload.projectName, cardLeft, cursorY, leftColumnWidth);
    drawMetaRow("Department", payload.departmentName, cardLeft + leftColumnWidth + columnGap, cursorY, rightColumnWidth);

    cursorY += 46;
    drawMetaRow("Responsible", payload.responsibleName, cardLeft, cursorY, leftColumnWidth);
    drawMetaRow("Prepared by", payload.preparedByName, cardLeft + leftColumnWidth + columnGap, cursorY, rightColumnWidth);

    cursorY += 46;
    drawMetaRow("Issued", payload.issueDate, cardLeft, cursorY, 130);
    drawMetaRow("Due", payload.dueDate, cardLeft + 146, cursorY, 130);
    drawMetaRow("Status", payload.status, cardLeft + 292, cursorY, 110);
    drawMetaRow("Items", String(payload.summary.itemCount), cardLeft + 418, cursorY, 50);
    drawMetaRow("Pending", String(payload.summary.pendingCount), cardLeft + 484, cursorY, 72);

    cursorY += 54;

    const countCardWidth = Math.floor((cardWidth - columnGap * 2) / 3);
    const drawCountCard = (label: string, value: string, x: number) => {
      document
        .roundedRect(x, cursorY, countCardWidth, 58, 14)
        .fillAndStroke(surfaceBackground, surfaceBorder);
      document.fillColor(surfaceMuted).fontSize(9).text(label.toUpperCase(), x + 16, cursorY + 12, {
        width: countCardWidth - 32,
        characterSpacing: 0.9,
      });
      document.fillColor(surfaceText).fontSize(18).text(value, x + 16, cursorY + 26, {
        width: countCardWidth - 32,
      });
    };

    drawCountCard("Total items", String(payload.summary.itemCount), cardLeft);
    drawCountCard("Returned", String(payload.summary.returnedCount), cardLeft + countCardWidth + columnGap);
    drawCountCard("Pending", String(payload.summary.pendingCount), cardLeft + (countCardWidth + columnGap) * 2);

    cursorY += 76;

    if (payload.notes.trim()) {
      document
        .roundedRect(cardLeft, cursorY, cardWidth, 64, 14)
        .fillAndStroke(surfaceBackground, surfaceBorder);
      document.fillColor(surfaceMuted).fontSize(9).text("NOTES", cardLeft + 16, cursorY + 10, {
        width: cardWidth - 32,
        characterSpacing: 0.9,
      });
      document.fillColor(surfaceText).fontSize(10).text(payload.notes, cardLeft + 16, cursorY + 26, {
        width: cardWidth - 32,
        height: 28,
      });
      cursorY += 82;
    }

    document.fillColor("#111318").fontSize(13).text("Issued items", cardLeft, cursorY);
    cursorY += 22;

    const columns = [
      { key: "asset", label: "Asset", width: 254 },
      { key: "qty", label: "Qty", width: 42 },
      { key: "conditionOut", label: "Out", width: 58 },
      { key: "conditionIn", label: "In", width: 58 },
      { key: "location", label: "Location", width: 148 },
    ] as const;

    const drawTableHeader = (y: number) => {
      document.roundedRect(cardLeft, y, cardWidth, 26, 10).fill(accentBackground);
      let x = cardLeft + 10;
      columns.forEach((column) => {
        document.fillColor("#aab2bf").fontSize(9).text(column.label.toUpperCase(), x, y + 8, {
          width: column.width - 10,
          characterSpacing: 0.8,
        });
        x += column.width;
      });
    };

    drawTableHeader(cursorY);
    cursorY += 34;

    payload.items.forEach((item, index) => {
      if (cursorY > document.page.height - 120) {
        document.addPage();
        cursorY = document.page.margins.top;
        drawTableHeader(cursorY);
        cursorY += 34;
      }

      if (index % 2 === 0) {
        document.roundedRect(cardLeft, cursorY - 6, cardWidth, 40, 10).fill(surfaceBackground);
      }

      let x = cardLeft + 10;
      const assetSummary = `${item.code} · ${item.name}`;
      const rowValues = [
        assetSummary,
        String(item.quantity),
        item.conditionOut || "—",
        item.conditionIn || "—",
        item.location || "—",
      ];

      rowValues.forEach((value, valueIndex) => {
        document.fillColor("#20262e").fontSize(10).text(value, x, cursorY + 4, {
          width: columns[valueIndex]!.width - 12,
          ellipsis: true,
        });
        x += columns[valueIndex]!.width;
      });

      cursorY += 40;
    });

    cursorY += 14;

    if (cursorY > document.page.height - 140) {
      document.addPage();
      cursorY = document.page.margins.top;
    }

    const signatureWidth = Math.floor((cardWidth - columnGap) / 2);
    const signatureTop = cursorY + 18;

    document.fillColor(surfaceMuted).fontSize(9).text("PREPARED BY", cardLeft, cursorY, {
      width: signatureWidth,
      characterSpacing: 0.9,
    });
    document.fillColor(surfaceMuted).fontSize(9).text("RECEIVED BY", cardLeft + signatureWidth + columnGap, cursorY, {
      width: signatureWidth,
      characterSpacing: 0.9,
    });

    document.moveTo(cardLeft, signatureTop + 26).lineTo(cardLeft + signatureWidth - 18, signatureTop + 26).strokeColor(surfaceBorder).lineWidth(1).stroke();
    document
      .moveTo(cardLeft + signatureWidth + columnGap, signatureTop + 26)
      .lineTo(cardLeft + cardWidth, signatureTop + 26)
      .strokeColor(surfaceBorder)
      .lineWidth(1)
      .stroke();

    document.fillColor(surfaceMuted).fontSize(9).text(payload.preparedByName || "Operations", cardLeft, signatureTop + 32, {
      width: signatureWidth,
    });
    document.fillColor(surfaceMuted).fontSize(9).text("Name / signature", cardLeft + signatureWidth + columnGap, signatureTop + 32, {
      width: signatureWidth,
    });

    document
      .fontSize(9)
      .fillColor("#8f98a8")
      .text(`Generated by BukowskiOS internal alpha · ${payload.primaryCodeValue}`, cardLeft, document.page.height - 52, {
        width: cardWidth,
        align: "left",
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
