import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

type UnsavedChangesDialogProps = {
  isOpen: boolean;
  isSubmitting?: boolean;
  /** Keep editing: just dismiss this dialog. */
  onStay: () => void;
  /** Throw the edits away and close the form. */
  onDiscard: () => void;
  /** Submit the form (same path as its primary action). Omit to hide. */
  onApply?: () => void | Promise<void>;
};

/**
 * Guard shown when a form modal/editor is closed with pending edits: stay,
 * discard, or apply through the form's own submit. Shares the confirm-dialog
 * chrome so it reads like every other confirmation in the app.
 */
export const UnsavedChangesDialog = ({ isOpen, isSubmitting = false, onStay, onDiscard, onApply }: UnsavedChangesDialogProps) => {
  const { t } = useTranslation();

  if (!isOpen) {
    return null;
  }

  return (
    // Rendered inside the host modal's backdrop: stop propagation so button
    // clicks don't bubble into the backdrop's own close handler.
    <div aria-modal="true" className="confirm-dialog-backdrop" onClick={(event) => event.stopPropagation()} role="dialog">
      <div className="confirm-dialog">
        <div className="confirm-dialog-header">
          <span className="confirm-dialog-icon confirm-dialog-icon-default">
            <AlertTriangle size={16} />
          </span>
          <div className="confirm-dialog-copy">
            <strong>{t("shared.unsavedChanges.title")}</strong>
            <p>{t("shared.unsavedChanges.body")}</p>
          </div>
        </div>

        <div className="confirm-dialog-actions">
          <button className="ghost-control" disabled={isSubmitting} onClick={onStay} type="button">
            {t("shared.unsavedChanges.stay")}
          </button>
          <button className="ghost-control cancel-control" disabled={isSubmitting} onClick={onDiscard} type="button">
            {t("shared.unsavedChanges.discard")}
          </button>
          {onApply ? (
            <button className="action-primary-button" disabled={isSubmitting} onClick={() => void onApply()} type="button">
              {isSubmitting ? t("shared.confirmDialog.working") : t("shared.unsavedChanges.apply")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
