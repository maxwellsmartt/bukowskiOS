import { Mail, Save, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { RmaCaseAssetInput, RmaCaseDetailSnapshot, RmaCaseStatus, RmaManufacturerRow, RmaMaintenanceAssetRow } from "@contracts";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

type AvailableRmaAsset = {
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

type RmaCaseEditorPanelProps = {
  availableAssets: AvailableRmaAsset[];
  error: string | null;
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

const statusOptions: RmaCaseStatus[] = ["Draft", "Ready", "Sent", "Closed"];

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

export const RmaCaseEditorPanel = ({
  availableAssets,
  error,
  initialValue,
  isSubmitting,
  manufacturers,
  mode,
  onClose,
  onOpenCatalog,
  onSubmit,
}: RmaCaseEditorPanelProps) => {
  const [manufacturerId, setManufacturerId] = useState(initialValue?.caseRecord?.manufacturerId ?? manufacturers[0]?.id ?? "");
  const [supportEmail, setSupportEmail] = useState(initialValue?.caseRecord?.supportEmail ?? "");
  const [title, setTitle] = useState(initialValue?.caseRecord?.title ?? "");
  const [problemSummary, setProblemSummary] = useState(initialValue?.caseRecord?.problemSummary ?? "");
  const [notes, setNotes] = useState(initialValue?.caseRecord?.notes ?? "");
  const [status, setStatus] = useState<RmaCaseStatus>(initialValue?.caseRecord?.status ?? "Draft");
  const [selectedAssets, setSelectedAssets] = useState<Record<string, SelectedAssetState>>(() => resolveInitialAssetState(initialValue));

  const manufacturerEmail = useMemo(
    () => manufacturers.find((manufacturer) => manufacturer.id === manufacturerId)?.supportEmail ?? "",
    [manufacturerId, manufacturers],
  );

  const selectedAssetIds = Object.keys(selectedAssets);
  const selectedCountLabel = selectedAssetIds.length === 1 ? "1 asset selected" : `${selectedAssetIds.length} assets selected`;

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
      aside={
        <button aria-label="Close repair case editor" className="surface-card-action" onClick={onClose} type="button">
          <X size={14} />
        </button>
      }
      title={mode === "create" ? "New repair case" : "Edit repair case"}
    >
      <div className="action-panel-summary">
        <span>{selectedCountLabel}</span>
        {mode === "edit" && initialValue?.caseRecord ? <StatusBadge>{initialValue.caseRecord.status}</StatusBadge> : null}
      </div>

      <div className="action-form-grid">
        <label className="action-field">
          <span className="action-field-label">Manufacturer</span>
          <SelectField
            onChange={(event) => {
              const nextId = event.target.value;
              setManufacturerId(nextId);
              const nextManufacturer = manufacturers.find((manufacturer) => manufacturer.id === nextId);
              setSupportEmail((current) => current || nextManufacturer?.supportEmail || "");
            }}
            value={manufacturerId}
          >
            <option value="">Choose manufacturer</option>
            {manufacturers.map((manufacturer) => (
              <option key={manufacturer.id} value={manufacturer.id}>
                {manufacturer.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">Support email</span>
          <input
            className="action-field-control"
            onChange={(event) => setSupportEmail(event.target.value)}
            placeholder={manufacturerEmail || "support@manufacturer.com"}
            type="email"
            value={supportEmail}
          />
        </label>

        <label className="action-field action-field-wide">
          <span className="action-field-label">Case title</span>
          <input
            className="action-field-control"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ex: Bench review for damaged wireless kit"
            value={title}
          />
        </label>

        <label className="action-field action-field-wide">
          <span className="action-field-label">Problem summary</span>
          <textarea
            className="action-field-control action-textarea"
            onChange={(event) => setProblemSummary(event.target.value)}
            placeholder="Describe what support should review."
            rows={3}
            value={problemSummary}
          />
        </label>
      </div>

      <details className="detail-disclosure">
        <summary className="detail-disclosure-summary">More details</summary>
        <div className="detail-disclosure-content">
          <div className="action-form-grid">
            <label className="action-field action-field-wide">
              <span className="action-field-label">Notes</span>
              <textarea
                className="action-field-control action-textarea"
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Shipping, warranty or follow-up notes"
                rows={3}
                value={notes}
              />
            </label>

            {mode === "edit" ? (
              <label className="action-field">
                <span className="action-field-label">Status</span>
                <SelectField onChange={(event) => setStatus(event.target.value as RmaCaseStatus)} value={status}>
                  {statusOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
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
          <h3 className="surface-card-title">Assets in maintenance</h3>
        </div>
        {onOpenCatalog ? (
          <button className="ghost-control" onClick={onOpenCatalog} type="button">
            <Mail size={14} />
            <span>Manufacturers</span>
          </button>
        ) : null}
      </div>

      <div className="rma-asset-picker">
        {availableAssets.map((asset) => {
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
                    {[asset.brand, asset.model].filter(Boolean).join(" · ") || "Model pending"} · {asset.location}
                  </span>
                </div>
              </div>

              <div className="rma-asset-card-meta">
                <span>Serial: {asset.serialNumber || "Pending"}</span>
                <span>{asset.latestIssue || "Needs review."}</span>
              </div>

              {selection ? (
                <div className="rma-asset-card-fields">
                  <label className="action-field">
                    <span className="action-field-label">Equipment year</span>
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
                      placeholder="Optional"
                      value={selection.equipmentYear}
                    />
                  </label>

                  <label className="action-field action-field-wide">
                    <span className="action-field-label">Issue summary</span>
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
        <button className="ghost-control" onClick={onClose} type="button">
          Cancel
        </button>

        <button
          className="action-primary-button"
          disabled={isSubmitting}
          onClick={() =>
            void onSubmit({
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
            })
          }
          type="button"
        >
          <Save size={14} />
          <span>{isSubmitting ? "Saving..." : mode === "create" ? "Create case" : "Save case"}</span>
        </button>
      </div>
    </SurfaceCard>
  );
};

export const buildAvailableRmaAssets = (
  maintenanceAssets: RmaMaintenanceAssetRow[],
  detail: RmaCaseDetailSnapshot | null,
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
        location: "Already linked to case",
        latestIssue: asset.issueSummary,
      });
    }
  });

  return Array.from(maintenanceMap.values()).sort((left, right) => left.name.localeCompare(right.name));
};
