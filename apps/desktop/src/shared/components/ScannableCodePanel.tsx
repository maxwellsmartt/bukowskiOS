import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type ScannableCodePanelProps = {
  title: string;
  subtitle: string;
  codeValue: string;
  qrLabel?: string;
  barcodeLabel?: string;
  onPrint?: (assets: { qrDataUrl: string; barcodeDataUrl: string }) => void;
};

export const ScannableCodePanel = ({
  title,
  subtitle,
  codeValue,
  qrLabel = "QR",
  barcodeLabel,
  onPrint,
}: ScannableCodePanelProps) => {
  const { t } = useTranslation();
  const resolvedBarcodeLabel = barcodeLabel ?? t("shared.scannable.barcode");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [barcodeDataUrl, setBarcodeDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const buildPreview = async () => {
      if (!codeValue.trim()) {
        setQrDataUrl(null);
        setBarcodeDataUrl(null);
        setError(t("shared.scannable.noCode"));
        return;
      }

      try {
        setError(null);
        const [{ default: QRCode }, { default: bwipjs }] = await Promise.all([import("qrcode"), import("bwip-js")]);

        const nextQrDataUrl = await QRCode.toDataURL(codeValue, {
          margin: 1,
          width: 220,
          color: {
            dark: "#f4f5f7",
            light: "#111315",
          },
        });

        const canvas = document.createElement("canvas");
        bwipjs.toCanvas(canvas, {
          bcid: "code128",
          text: codeValue,
          scale: 3,
          height: 12,
          includetext: false,
          backgroundcolor: "111315",
          barcolor: "f4f5f7",
        });

        if (!cancelled) {
          setQrDataUrl(nextQrDataUrl);
          setBarcodeDataUrl(canvas.toDataURL("image/png"));
        }
      } catch {
        if (!cancelled) {
          setQrDataUrl(null);
          setBarcodeDataUrl(null);
          setError(t("shared.scannable.renderFailed"));
        }
      }
    };

    void buildPreview();

    return () => {
      cancelled = true;
    };
  }, [codeValue, t]);

  const isReadyToPrint = Boolean(qrDataUrl && barcodeDataUrl && onPrint);

  return (
    <div className="scannable-panel">
      <div className="scannable-panel-header">
        <div className="identity-cell">
          <span className="identity-title">{title}</span>
          <span className="identity-meta">{subtitle}</span>
        </div>
        {isReadyToPrint ? (
          <button
            className="ghost-control"
            onClick={() => onPrint?.({ qrDataUrl: qrDataUrl!, barcodeDataUrl: barcodeDataUrl! })}
            type="button"
          >
            {t("shared.scannable.printLabel")}
          </button>
        ) : null}
      </div>

      <div className="scannable-code-value">{codeValue || t("shared.scannable.pendingCode")}</div>

      {error ? <div className="empty-state">{error}</div> : null}

      {!error && qrDataUrl && barcodeDataUrl ? (
        <div className="scannable-preview-grid">
          <div className="scannable-preview-card">
            <span className="summary-label">{qrLabel}</span>
            <img alt={`${title} QR`} className="scannable-preview-image" src={qrDataUrl} />
          </div>
          <div className="scannable-preview-card">
            <span className="summary-label">{resolvedBarcodeLabel}</span>
            <img alt={`${title} barcode`} className="scannable-preview-barcode" src={barcodeDataUrl} />
          </div>
        </div>
      ) : null}
    </div>
  );
};
