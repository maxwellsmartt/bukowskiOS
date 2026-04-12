type PrintScannableLabelInput = {
  title: string;
  subtitle?: string;
  codeValue: string;
  qrDataUrl: string;
  barcodeDataUrl: string;
};

const buildPrintMarkup = ({ title, subtitle, codeValue, qrDataUrl, barcodeDataUrl }: PrintScannableLabelInput) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #ffffff;
        color: #111111;
      }
      .label-sheet {
        width: 100%;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      .label-card {
        width: 360px;
        border: 1px solid #d7d9de;
        border-radius: 20px;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .eyebrow {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #5b6270;
      }
      .title {
        font-size: 24px;
        font-weight: 700;
        line-height: 1.15;
      }
      .subtitle {
        font-size: 14px;
        color: #4d5563;
      }
      .code {
        font-size: 13px;
        font-weight: 600;
        color: #1f2530;
      }
      .art {
        display: grid;
        gap: 12px;
      }
      .qr {
        width: 180px;
        height: 180px;
        object-fit: contain;
      }
      .barcode {
        width: 100%;
        height: auto;
        object-fit: contain;
      }
    </style>
  </head>
  <body>
    <div class="label-sheet">
      <div class="label-card">
        <div class="eyebrow">BukowskiOS label</div>
        <div class="title">${title}</div>
        ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ""}
        <div class="code">${codeValue}</div>
        <div class="art">
          <img class="qr" src="${qrDataUrl}" alt="QR code" />
          <img class="barcode" src="${barcodeDataUrl}" alt="Barcode" />
        </div>
      </div>
    </div>
    <script>
      window.addEventListener("load", () => {
        setTimeout(() => {
          window.print();
        }, 80);
      });
    </script>
  </body>
</html>`;

export const printScannableLabel = (input: PrintScannableLabelInput) => {
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=480,height=680");
  if (!printWindow) {
    throw new Error("The browser blocked the print preview window.");
  }

  printWindow.document.open();
  printWindow.document.write(buildPrintMarkup(input));
  printWindow.document.close();
};
