import { AlertTriangle } from "lucide-react";

type ConfirmDialogProps = {
  title: string;
  body: string;
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
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  isOpen,
  isSubmitting = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
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
            <p>{body}</p>
          </div>
        </div>

        <div className="confirm-dialog-actions">
          <button className="ghost-control cancel-control" disabled={isSubmitting} onClick={onCancel} type="button">
            {cancelLabel}
          </button>
          <button
            className={tone === "danger" ? "action-danger-button" : "action-primary-button"}
            disabled={isSubmitting}
            onClick={() => void onConfirm()}
            type="button"
          >
            {isSubmitting ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
