import { AlertTriangle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useModalCloseGuard } from "@shared/components/ModalShell";

export type CollaboratorPaymentDraft = {
  amount: string;
  date: string;
  method: string;
  reference: string;
  notes: string;
};

type CollaboratorPaymentPanelProps = {
  initialDraft: CollaboratorPaymentDraft;
  selectionSummary: string;
  error: string | null;
  isSubmitting: boolean;
  canSubmit: boolean;
  onClose: () => void;
  onSubmit: (draft: CollaboratorPaymentDraft) => Promise<void>;
};

const dirtyFields: Array<keyof CollaboratorPaymentDraft> = ["amount", "date", "method", "reference", "notes"];

export const CollaboratorPaymentPanel = ({
  initialDraft,
  selectionSummary,
  error,
  isSubmitting,
  canSubmit,
  onClose,
  onSubmit,
}: CollaboratorPaymentPanelProps) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialDraft);

  const closeGuard = useModalCloseGuard();
  const initialRef = useRef(initialDraft);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const submitRef = useRef<() => Promise<void>>(async () => undefined);
  submitRef.current = () => onSubmit(draftRef.current);

  useEffect(() => {
    if (!closeGuard) {
      return undefined;
    }
    closeGuard.registerGuard({
      isDirty: () => dirtyFields.some((key) => draftRef.current[key].trim() !== initialRef.current[key].trim()),
      apply: () => submitRef.current(),
    });
    return () => closeGuard.registerGuard(null);
  }, [closeGuard]);

  const requestClose = closeGuard?.requestClose ?? onClose;

  return (
    <div className="incident-report-dialog">
      <div className="document-preview-header">
        <span className="document-preview-title">{t("finance.collaboratorFees.payment.title")}</span>
        <button aria-label={t("common.cancel")} className="icon-ghost-control" onClick={requestClose} type="button">
          <X size={16} />
        </button>
      </div>
      <div className="modal-form-body">
        <div className="action-feedback action-feedback-info">{selectionSummary}</div>
        <div className="action-form-grid">
          <label className="action-field">
            <span className="action-field-label">{t("finance.collaboratorFees.payment.amount")}</span>
            <input
              className="action-field-control"
              inputMode="decimal"
              onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))}
              value={draft.amount}
            />
          </label>
          <label className="action-field">
            <span className="action-field-label">{t("finance.collaboratorFees.payment.date")}</span>
            <input
              className="action-field-control"
              onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))}
              type="date"
              value={draft.date}
            />
          </label>
          <label className="action-field">
            <span className="action-field-label">{t("finance.collaboratorFees.payment.method")}</span>
            <input
              className="action-field-control"
              onChange={(event) => setDraft((current) => ({ ...current, method: event.target.value }))}
              value={draft.method}
            />
          </label>
          <label className="action-field">
            <span className="action-field-label">{t("finance.collaboratorFees.payment.reference")}</span>
            <input
              className="action-field-control"
              onChange={(event) => setDraft((current) => ({ ...current, reference: event.target.value }))}
              value={draft.reference}
            />
          </label>
          <label className="action-field action-field-wide">
            <span className="action-field-label">{t("finance.collaboratorFees.payment.notes")}</span>
            <textarea
              className="action-field-control action-textarea"
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
              rows={3}
              value={draft.notes}
            />
          </label>
        </div>

        {error ? (
          <div className="action-feedback action-feedback-error">
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        ) : null}
      </div>

      <div className="document-preview-header packing-insurance-export-footer">
        <button className="ghost-control" onClick={requestClose} type="button">
          {t("common.cancel")}
        </button>
        <button className="action-primary-button" disabled={isSubmitting || !canSubmit} onClick={() => void onSubmit(draft)} type="button">
          {t("finance.collaboratorFees.payment.submit")}
        </button>
      </div>
    </div>
  );
};
