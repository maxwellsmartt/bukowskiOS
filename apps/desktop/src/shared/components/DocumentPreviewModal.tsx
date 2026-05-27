import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

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

  if (!open) return null;

  const isPdf = (mimeType ?? "").includes("pdf");

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
            <iframe className="document-preview-frame" src={dataUrl} title={title} />
          ) : (
            <img className="document-preview-image" src={dataUrl} alt={title} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
