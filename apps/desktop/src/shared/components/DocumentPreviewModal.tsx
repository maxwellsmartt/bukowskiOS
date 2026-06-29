import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

type DocumentPreviewModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Data URL of the document (image or PDF). Null while loading. */
  dataUrl: string | null;
  mimeType: string | null;
  isLoading?: boolean;
  error?: string | null;
  loadingLabel?: string;
};

const dataUrlToBytes = (dataUrl: string): Uint8Array | null => {
  const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/u.exec(dataUrl);
  if (!match) return null;
  const base64 = match[2] ?? "";
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const PdfCanvasPreview = ({ dataUrl, title }: { dataUrl: string; title: string }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const container = containerRef.current;
    const bytes = dataUrlToBytes(dataUrl);
    if (!container || !bytes) {
      setStatus("error");
      return undefined;
    }

    let cancelled = false;
    let destroyLoadingTask: (() => void) | null = null;
    container.replaceChildren();
    setStatus("loading");

    void import("pdfjs-dist/build/pdf.mjs")
      .then(async (pdfjs) => {
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const loadingTask = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
        destroyLoadingTask = () => {
          void loadingTask.destroy();
        };
        const pdfDocument = await loadingTask.promise;
        const availableWidth = Math.max(320, container.clientWidth - 8);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdfDocument.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(2, Math.max(0.85, availableWidth / baseViewport.width));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("Canvas context unavailable.");

          canvas.className = "document-preview-pdf-page";
          canvas.width = Math.floor(viewport.width * pixelRatio);
          canvas.height = Math.floor(viewport.height * pixelRatio);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
          container.appendChild(canvas);

          await page.render({ canvas, canvasContext: context, viewport }).promise;
        }

        if (!cancelled) setStatus("ready");
        await pdfDocument.destroy();
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      destroyLoadingTask?.();
      container.replaceChildren();
    };
  }, [dataUrl]);

  return (
    <div className="document-preview-pdf-shell" aria-label={title}>
      {status === "loading" ? <div className="document-preview-status">Preparando vista previa…</div> : null}
      {status === "error" ? (
        <div className="document-preview-status document-preview-status--error">
          No se pudo renderizar la vista previa del PDF.
        </div>
      ) : null}
      <div ref={containerRef} className={`document-preview-pdf-pages${status === "ready" ? " is-ready" : ""}`} />
    </div>
  );
};

/**
 * Centered, animated document preview. Renders images inline and PDFs in an
 * embedded frame. Escapes any parent overflow via a portal to `document.body`
 * and closes on backdrop click or Escape.
 */
export const DocumentPreviewModal = ({
  open,
  onClose,
  title,
  dataUrl,
  mimeType,
  isLoading = false,
  error = null,
  loadingLabel = "Cargando…",
}: DocumentPreviewModalProps) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const isPdf = (mimeType ?? "").includes("pdf");

  if (!open) return null;

  return createPortal(
    <div className="document-preview-backdrop" onClick={onClose} role="presentation">
      <div
        className="document-preview-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="document-preview-header">
          <span className="document-preview-title" title={title}>
            {title}
          </span>
          <button className="icon-ghost-control" onClick={onClose} type="button" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="document-preview-body">
          {isLoading ? (
            <div className="document-preview-status">{loadingLabel}</div>
          ) : error ? (
            <div className="document-preview-status document-preview-status--error">{error}</div>
          ) : !dataUrl ? (
            <div className="document-preview-status">{loadingLabel}</div>
          ) : isPdf ? (
            <PdfCanvasPreview dataUrl={dataUrl} title={title} />
          ) : (
            <img className="document-preview-image" src={dataUrl} alt={title} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
