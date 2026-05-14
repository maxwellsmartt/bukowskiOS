import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

type ConfirmDialogProps = {
  title: string;
  body: ReactNode;
  details?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  isOpen: boolean;
  isSubmitting?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export const ConfirmDialog = ({
  title,
  body,
  details,
  confirmLabel,
  cancelLabel,
  tone = "default",
  isOpen,
  isSubmitting = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  const { t } = useTranslation();

  if (!isOpen) {
    return null;
  }

  return (
    <div aria-modal="true" className="confirm-dialog-backdrop" role="dialog">
      <div className="confirm-dialog">
        <div className="confirm-dialog-header">
          <span className={`confirm-dialog-icon confirm-dialog-icon-${tone}`}>
            <AlertTriangle size={16} />
          </span>
          <div className="confirm-dialog-copy">
            <strong>{title}</strong>
            {typeof body === "string" ? <p>{body}</p> : body}
          </div>
        </div>

        {details ? <div className="confirm-dialog-details">{details}</div> : null}

        <div className="confirm-dialog-actions">
          <button className="ghost-control cancel-control" disabled={isSubmitting} onClick={onCancel} type="button">
            {cancelLabel ?? t("common.cancel")}
          </button>
          <button
            className={tone === "danger" ? "action-danger-button" : "action-primary-button"}
            disabled={isSubmitting}
            onClick={() => void onConfirm()}
            type="button"
          >
            {isSubmitting ? t("shared.confirmDialog.working") : confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};
