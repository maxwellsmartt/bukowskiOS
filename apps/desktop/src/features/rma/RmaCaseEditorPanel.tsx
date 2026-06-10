import { Mail, Save, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { RmaCaseAssetInput, RmaCaseDetailSnapshot, RmaCaseStatus, RmaManufacturerRow, RmaMaintenanceAssetRow } from "@contracts";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { UnsavedChangesDialog } from "@shared/components/UnsavedChangesDialog";

export type AvailableRmaAsset = {
  id: string;
  name: string;
  brand: string;
  model: string;
  serialNumber: string;
  location: string;
  latestIssue: string;
};

export type RmaCaseEditorDraft = {
  manufacturerId: string;
  supportEmail?: string;
  title: string;
  problemSummary: string;
  notes?: string;
  status: RmaCaseStatus;
  assetItems: RmaCaseAssetInput[];
};

export type RmaCaseEditorInitialDraft = Partial<Omit<RmaCaseEditorDraft, "assetItems">> & {
  assetItems?: RmaCaseAssetInput[];
};

type RmaCaseEditorPanelProps = {
  availableAssets: AvailableRmaAsset[];
  error: string | null;
  initialDraft?: RmaCaseEditorInitialDraft | null;
  initialValue?: RmaCaseDetailSnapshot | null;
  isSubmitting: boolean;
  manufacturers: RmaManufacturerRow[];
  mode: "create" | "edit";
  onClose: () => void;
  onOpenCatalog?: () => void;
  onSubmit: (value: RmaCaseEditorDraft) => Promise<void>;
};

type SelectedAssetState = {
  equipmentYear: string;
  issueSummary: string;
};

const normalizeOptional = (value: string) => {
  const nextValue = value.trim();
  return nextValue ? nextValue : undefined;
};

const statusOptions: RmaCaseStatus[] = [
  "Needs review",
  "Sent to repair",
  "Waiting parts",
  "Repaired",
  "No repair / retired",
  "Returned to inventory",
];

const resolveInitialAssetState = (snapshot?: RmaCaseDetailSnapshot | null) =>
  Object.fromEntries(
    (snapshot?.assets ?? []).map((asset) => [
      asset.assetId,
      {
        equipmentYear: asset.equipmentYear,
        issueSummary: asset.issueSummary,
      } satisfies SelectedAssetState,
    ]),
  ) as Record<string, SelectedAssetState>;

const resolveDraftAssetState = (draft?: RmaCaseEditorInitialDraft | null) =>
  Object.fromEntries(
    (draft?.assetItems ?? []).map((asset) => [
      asset.assetId,
      {
        equipmentYear: asset.equipmentYear ?? "",
        issueSummary: asset.issueSummary,
      } satisfies SelectedAssetState,
    ]),
  ) as Record<string, SelectedAssetState>;

export const RmaCaseEditorPanel = ({
  availableAssets,
  error,
  initialDraft,
  initialValue,
  isSubmitting,
  manufacturers,
  mode,
  onClose,
  onOpenCatalog,
  onSubmit,
}: RmaCaseEditorPanelProps) => {
  const { t } = useTranslation();
  const [manufacturerId, setManufacturerId] = useState(initialValue?.caseRecord?.manufacturerId ?? initialDraft?.manufacturerId ?? manufacturers[0]?.id ?? "");
  const [supportEmail, setSupportEmail] = useState(initialValue?.caseRecord?.supportEmail ?? initialDraft?.supportEmail ?? "");
  const [title, setTitle] = useState(initialValue?.caseRecord?.title ?? initialDraft?.title ?? "");
  const [problemSummary, setProblemSummary] = useState(initialValue?.caseRecord?.problemSummary ?? initialDraft?.problemSummary ?? "");
  const [notes, setNotes] = useState(initialValue?.caseRecord?.notes ?? initialDraft?.notes ?? "");
  const [status, setStatus] = useState<RmaCaseStatus>(initialValue?.caseRecord?.status ?? initialDraft?.status ?? "Needs review");
  const [selectedAssets, setSelectedAssets] = useState<Record<string, SelectedAssetState>>(() => ({
    ...resolveDraftAssetState(initialDraft),
    ...resolveInitialAssetState(initialValue),
  }));
  const [assetFilter, setAssetFilter] = useState("");

  // Selected assets always stay visible (even when they no longer match the
  // filter) so a narrowed list can't hide what is about to be submitted.
  const visibleAssets = useMemo(() => {
    const term = assetFilter.trim().toLowerCase();
    if (!term) return availableAssets;
    return availableAssets.filter(
      (asset) =>
        Boolean(selectedAssets[asset.id]) ||
        `${asset.name} ${asset.brand} ${asset.model} ${asset.serialNumber}`.toLowerCase().includes(term),
    );
  }, [assetFilter, availableAssets, selectedAssets]);

  const manufacturerEmail = useMemo(
    () => manufacturers.find((manufacturer) => manufacturer.id === manufacturerId)?.supportEmail ?? "",
    [manufacturerId, manufacturers],
  );

  const selectedAssetIds = Object.keys(selectedAssets);
  const selectedCountLabel = t("rma.editor.selectedCount", { count: selectedAssetIds.length });

  // Unsaved-changes guard for X / Cancel: dirty when any field or the asset
  // selection moved away from how the editor opened.
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const initialSnapshotRef = useRef({
    manufacturerId: initialValue?.caseRecord?.manufacturerId ?? initialDraft?.manufacturerId ?? manufacturers[0]?.id ?? "",
    supportEmail: initialValue?.caseRecord?.supportEmail ?? initialDraft?.supportEmail ?? "",
    title: initialValue?.caseRecord?.title ?? initialDraft?.title ?? "",
    problemSummary: initialValue?.caseRecord?.problemSummary ?? initialDraft?.problemSummary ?? "",
    notes: initialValue?.caseRecord?.notes ?? initialDraft?.notes ?? "",
    status: (initialValue?.caseRecord?.status ?? initialDraft?.status ?? "Needs review") as string,
    assetSignature: JSON.stringify({
      ...resolveDraftAssetState(initialDraft),
      ...resolveInitialAssetState(initialValue),
    }),
  });

  const isDirty = () => {
    const initial = initialSnapshotRef.current;
    return (
      manufacturerId !== initial.manufacturerId ||
      supportEmail.trim() !== initial.supportEmail.trim() ||
      title.trim() !== initial.title.trim() ||
      problemSummary.trim() !== initial.problemSummary.trim() ||
      notes.trim() !== initial.notes.trim() ||
      status !== initial.status ||
      JSON.stringify(selectedAssets) !== initial.assetSignature
    );
  };

  const requestClose = () => {
    if (isDirty()) {
      setUnsavedDialogOpen(true);
      return;
    }
    onClose();
  };

  const submitDraft = () =>
    onSubmit({
      manufacturerId,
      supportEmail: normalizeOptional(supportEmail),
      title: title.trim(),
      problemSummary: problemSummary.trim(),
      notes: normalizeOptional(notes),
      status,
      assetItems: selectedAssetIds.map((assetId) => ({
        assetId,
        equipmentYear: normalizeOptional(selectedAssets[assetId]?.equipmentYear),
        issueSummary: selectedAssets[assetId]?.issueSummary.trim() ?? "",
      })),
    });

  const handleToggleAsset = (asset: AvailableRmaAsset, checked: boolean) => {
    setSelectedAssets((current) => {
      if (!checked) {
        const { [asset.id]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [asset.id]: current[asset.id] ?? {
          equipmentYear: "",
          issueSummary: asset.latestIssue || problemSummary,
        },
      };
    });
  };

  return (
    <SurfaceCard
      className="rma-detail-card detail-rail-card"
      aside={
        <button aria-label={t("rma.editor.close")} className="icon-ghost-control" onClick={requestClose} type="button">
          <X size={14} />
        </button>
      }
      title={mode === "create" ? t("rma.editor.newTitle") : t("rma.editor.editTitle")}
    >
      <div className="action-panel-summary">
        <span>{selectedCountLabel}</span>
        {mode === "edit" && initialValue?.caseRecord ? (
          <StatusBadge>{t(`rma.statuses.${initialValue.caseRecord.status}`, { defaultValue: initialValue.caseRecord.status })}</StatusBadge>
        ) : null}
      </div>

      <div className="action-form-grid">
        <label className="action-field">
          <span className="action-field-label">{t("rma.editor.manufacturer")}</span>
          <SelectField
            onChange={(event) => {
              const nextId = event.target.value;
              setManufacturerId(nextId);
              const nextManufacturer = manufacturers.find((manufacturer) => manufacturer.id === nextId);
              setSupportEmail((current) => current || nextManufacturer?.supportEmail || "");
            }}
            value={manufacturerId}
          >
            <option value="">{t("rma.editor.chooseManufacturer")}</option>
            {manufacturers.map((manufacturer) => (
              <option key={manufacturer.id} value={manufacturer.id}>
                {manufacturer.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">{t("rma.editor.supportEmail")}</span>
          <input
            className="action-field-control"
            onChange={(event) => setSupportEmail(event.target.value)}
            placeholder={manufacturerEmail || t("rma.editor.supportEmailPlaceholder")}
            type="email"
            value={supportEmail}
          />
        </label>

        <label className="action-field action-field-wide">
          <span className="action-field-label">{t("rma.editor.caseTitle")}</span>
          <input
            className="action-field-control"
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("rma.editor.caseTitlePlaceholder")}
            value={title}
          />
        </label>

        <label className="action-field action-field-wide">
          <span className="action-field-label">{t("rma.editor.problemSummary")}</span>
          <textarea
            className="action-field-control action-textarea"
            onChange={(event) => setProblemSummary(event.target.value)}
            placeholder={t("rma.editor.problemSummaryPlaceholder")}
            rows={3}
            value={problemSummary}
          />
        </label>
      </div>

      <details className="detail-disclosure">
        <summary className="detail-disclosure-summary">{t("rma.editor.moreDetails")}</summary>
        <div className="detail-disclosure-content">
          <div className="action-form-grid">
            <label className="action-field action-field-wide">
              <span className="action-field-label">{t("rma.editor.notes")}</span>
              <textarea
                className="action-field-control action-textarea"
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t("rma.editor.notesPlaceholder")}
                rows={3}
                value={notes}
              />
            </label>

            {mode === "edit" ? (
              <label className="action-field">
                <span className="action-field-label">{t("rma.editor.status")}</span>
                <SelectField onChange={(event) => setStatus(event.target.value as RmaCaseStatus)} value={status}>
                  {statusOptions.map((option) => (
                    <option key={option} value={option}>
                      {t(`rma.statuses.${option}`, { defaultValue: option })}
                    </option>
                  ))}
                </SelectField>
              </label>
            ) : null}
          </div>
        </div>
      </details>

      <div className="surface-card-header rma-editor-assets-header">
        <div>
          <h3 className="surface-card-title">{t("rma.editor.assetsInMaintenance")}</h3>
        </div>
        {onOpenCatalog ? (
          <button className="ghost-control" onClick={onOpenCatalog} type="button">
            <Mail size={14} />
            <span>{t("rma.editor.manufacturers")}</span>
          </button>
        ) : null}
      </div>

      {availableAssets.length > 5 ? (
        <input
          className="action-field-control"
          onChange={(event) => setAssetFilter(event.target.value)}
          placeholder={t("shared.searchSelect.assetPlaceholder")}
          type="search"
          value={assetFilter}
        />
      ) : null}

      <div className="rma-asset-picker">
        {visibleAssets.map((asset) => {
          const selection = selectedAssets[asset.id];

          return (
            <div key={asset.id} className={`rma-asset-card${selection ? " selected" : ""}`}>
              <div className="rma-asset-card-header">
                <span className="rma-asset-check">
                  <input
                    checked={Boolean(selection)}
                    onChange={(event) => handleToggleAsset(asset, event.target.checked)}
                    type="checkbox"
                  />
                </span>
                <div className="rma-asset-copy">
                  <strong>{asset.name}</strong>
                  <span>
                    {[asset.brand, asset.model].filter(Boolean).join(" · ") || t("rma.fallbacks.modelPending")} · {asset.location}
                  </span>
                </div>
              </div>

              <div className="rma-asset-card-meta">
                <span>{t("rma.editor.serial", { value: asset.serialNumber || t("rma.fallbacks.pending") })}</span>
                <span>{asset.latestIssue || t("rma.statuses.Needs review")}</span>
              </div>

              {selection ? (
                <div className="rma-asset-card-fields">
                  <label className="action-field">
                    <span className="action-field-label">{t("rma.editor.equipmentYear")}</span>
                    <input
                      className="action-field-control"
                      inputMode="numeric"
                      onChange={(event) =>
                        setSelectedAssets((current) => ({
                          ...current,
                          [asset.id]: {
                            ...current[asset.id],
                            equipmentYear: event.target.value,
                          },
                        }))
                      }
                      placeholder={t("common.optional")}
                      value={selection.equipmentYear}
                    />
                  </label>

                  <label className="action-field action-field-wide">
                    <span className="action-field-label">{t("rma.editor.issueSummary")}</span>
                    <textarea
                      className="action-field-control action-textarea"
                      onChange={(event) =>
                        setSelectedAssets((current) => ({
                          ...current,
                          [asset.id]: {
                            ...current[asset.id],
                            issueSummary: event.target.value,
                          },
                        }))
                      }
                      rows={2}
                      value={selection.issueSummary}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

      <div className="action-panel-actions">
        <button className="ghost-control" onClick={requestClose} type="button">
          {t("common.cancel")}
        </button>

        <button
          className="action-primary-button"
          disabled={isSubmitting}
          onClick={() => void submitDraft()}
          type="button"
        >
          <Save size={14} />
          <span>{isSubmitting ? t("common.saving") : mode === "create" ? t("rma.editor.createCase") : t("rma.editor.saveCase")}</span>
        </button>
      </div>

      <UnsavedChangesDialog
        isOpen={unsavedDialogOpen}
        isSubmitting={isSubmitting}
        onApply={async () => {
          setUnsavedDialogOpen(false);
          await submitDraft();
        }}
        onDiscard={() => {
          setUnsavedDialogOpen(false);
          onClose();
        }}
        onStay={() => setUnsavedDialogOpen(false)}
      />
    </SurfaceCard>
  );
};

export const buildAvailableRmaAssets = (
  maintenanceAssets: RmaMaintenanceAssetRow[],
  detail: RmaCaseDetailSnapshot | null,
  linkedLocationLabel = "Already linked to case",
): AvailableRmaAsset[] => {
  const maintenanceMap = new Map(
    maintenanceAssets.map((asset) => [
      asset.id,
      {
        id: asset.id,
        name: asset.name,
        brand: asset.brand,
        model: asset.model,
        serialNumber: asset.serialNumber,
        location: asset.location,
        latestIssue: asset.latestIssue,
      } satisfies AvailableRmaAsset,
    ]),
  );

  detail?.assets.forEach((asset) => {
    if (!maintenanceMap.has(asset.assetId)) {
      maintenanceMap.set(asset.assetId, {
        id: asset.assetId,
        name: asset.assetName,
        brand: asset.brand,
        model: asset.model,
        serialNumber: asset.serialNumber,
        location: linkedLocationLabel,
        latestIssue: asset.issueSummary,
      });
    }
  });

  return Array.from(maintenanceMap.values()).sort((left, right) => left.name.localeCompare(right.name));
};
