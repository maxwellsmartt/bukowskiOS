import { AlertTriangle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CatalogSnapshot, ProjectCardRow } from "@contracts";
import { useModalCloseGuard } from "@shared/components/ModalShell";
import { SearchSelect } from "@shared/components/SearchSelect";
import { SelectField } from "@shared/components/SelectField";

export type CollaboratorFeeDraft = {
  feeId?: string;
  crewMemberId: string;
  projectId: string;
  projectUnitId: string;
  departmentId: string;
  sourceAssignmentId: string;
  feeType: string;
  description: string;
  agreedAmount: string;
  currency: string;
  expectedPaymentDate: string;
  notes: string;
};

type CollaboratorFeeEditorPanelProps = {
  initialDraft: CollaboratorFeeDraft;
  crewMembers: CatalogSnapshot["crewMembers"];
  projects: ProjectCardRow[];
  currencyOptions: string[];
  error: string | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (draft: CollaboratorFeeDraft) => Promise<void>;
};

const dirtyFields: Array<keyof CollaboratorFeeDraft> = [
  "crewMemberId",
  "projectId",
  "feeType",
  "agreedAmount",
  "currency",
  "expectedPaymentDate",
  "description",
  "notes",
];

export const CollaboratorFeeEditorPanel = ({
  initialDraft,
  crewMembers,
  projects,
  currencyOptions,
  error,
  isSubmitting,
  onClose,
  onSubmit,
}: CollaboratorFeeEditorPanelProps) => {
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
      isDirty: () => dirtyFields.some((key) => (draftRef.current[key] ?? "").trim() !== (initialRef.current[key] ?? "").trim()),
      apply: () => submitRef.current(),
    });
    return () => closeGuard.registerGuard(null);
  }, [closeGuard]);

  const requestClose = closeGuard?.requestClose ?? onClose;
  const isEditing = Boolean(draft.feeId);

  return (
    <div className="incident-report-dialog">
      <div className="document-preview-header">
        <span className="document-preview-title">
          {isEditing ? t("finance.collaboratorFees.editor.editTitle") : t("finance.collaboratorFees.editor.newTitle")}
        </span>
        <button aria-label={t("common.cancel")} className="icon-ghost-control" onClick={requestClose} type="button">
          <X size={16} />
        </button>
      </div>
      <div className="modal-form-body">
        <div className="action-form-grid">
          <label className="action-field">
            <span className="action-field-label">{t("finance.collaboratorFees.editor.crew")}</span>
            <SearchSelect
              ariaLabel={t("finance.collaboratorFees.editor.crew")}
              onChange={(value) => setDraft((current) => ({ ...current, crewMemberId: value }))}
              options={crewMembers.map((crew) => ({ value: crew.id, label: crew.fullName }))}
              placeholder={t("finance.collaboratorFees.editor.chooseCrew")}
              searchPlaceholder={t("finance.collaboratorFees.editor.chooseCrew")}
              value={draft.crewMemberId}
            />
          </label>

          <label className="action-field">
            <span className="action-field-label">{t("finance.collaboratorFees.editor.project")}</span>
            <SearchSelect
              ariaLabel={t("finance.collaboratorFees.editor.project")}
              emptyOptionLabel={t("finance.collaboratorFees.editor.noProject")}
              onChange={(value) => setDraft((current) => ({ ...current, projectId: value }))}
              options={projects.map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` }))}
              placeholder={t("finance.collaboratorFees.editor.noProject")}
              searchPlaceholder={t("shared.searchSelect.projectPlaceholder")}
              value={draft.projectId}
            />
          </label>

          <label className="action-field">
            <span className="action-field-label">{t("finance.collaboratorFees.editor.type")}</span>
            <input
              className="action-field-control"
              onChange={(event) => setDraft((current) => ({ ...current, feeType: event.target.value }))}
              placeholder={t("finance.collaboratorFees.editor.typePlaceholder")}
              value={draft.feeType}
            />
          </label>

          <label className="action-field">
            <span className="action-field-label">{t("finance.collaboratorFees.editor.amount")}</span>
            <input
              className="action-field-control"
              inputMode="decimal"
              onChange={(event) => setDraft((current) => ({ ...current, agreedAmount: event.target.value }))}
              value={draft.agreedAmount}
            />
          </label>

          <label className="action-field">
            <span className="action-field-label">{t("finance.collaboratorFees.editor.currency")}</span>
            <SelectField onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value }))} value={draft.currency}>
              {currencyOptions.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </SelectField>
          </label>

          <label className="action-field">
            <span className="action-field-label">{t("finance.collaboratorFees.editor.expectedDate")}</span>
            <input
              className="action-field-control"
              onChange={(event) => setDraft((current) => ({ ...current, expectedPaymentDate: event.target.value }))}
              type="date"
              value={draft.expectedPaymentDate}
            />
          </label>

          <label className="action-field action-field-wide">
            <span className="action-field-label">{t("finance.collaboratorFees.editor.description")}</span>
            <input
              className="action-field-control"
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              value={draft.description}
            />
          </label>

          <label className="action-field action-field-wide">
            <span className="action-field-label">{t("finance.collaboratorFees.editor.notes")}</span>
            <textarea
              className="action-field-control action-textarea"
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
              rows={3}
              value={draft.notes}
            />
          </label>
        </div>

        {draft.sourceAssignmentId ? (
          <div className="action-feedback action-feedback-info">{t("finance.collaboratorFees.editor.prefillNote")}</div>
        ) : null}

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
        <button className="action-primary-button" disabled={isSubmitting} onClick={() => void onSubmit(draft)} type="button">
          {isSubmitting ? t("common.saving") : t("finance.collaboratorFees.editor.save")}
        </button>
      </div>
    </div>
  );
};
