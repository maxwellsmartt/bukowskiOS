import { PackageCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AssetListRow, CatalogSnapshot, PackingSlipAssetSelection, ProjectCardRow } from "@contracts";
import { useProjectDetail } from "@features/projects/useProjectsData";
import { SelectField } from "@shared/components/SelectField";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { resolveAssetAvailability, summarizeUnavailableAssets } from "@shared/lib/assetAvailability";

export type PackingSlipBuilderDraft = {
  assetSelections: PackingSlipAssetSelection[];
  projectId: string;
  projectUnitId?: string;
  departmentId?: string;
  responsibleUserId?: string;
  returnDueAt?: string;
  notes?: string;
};

type PackingSlipBuilderPanelProps = {
  defaultProjectId: string | null;
  departments: CatalogSnapshot["departments"];
  error: string | null;
  initialAssetSelections?: PackingSlipAssetSelection[];
  isSubmitting: boolean;
  onAssetSelectionsChange?: (selections: PackingSlipAssetSelection[]) => void;
  onClose: () => void;
  onSubmit: (value: PackingSlipBuilderDraft) => Promise<void>;
  projects: ProjectCardRow[];
  selectedAssets: AssetListRow[];
  selectedCount: number;
  users: CatalogSnapshot["users"];
};

const normalizeOptional = (value: string) => {
  const nextValue = value.trim();
  return nextValue ? nextValue : undefined;
};

export const PackingSlipBuilderPanel = ({
  defaultProjectId,
  departments,
  error,
  initialAssetSelections,
  isSubmitting,
  onAssetSelectionsChange,
  onClose,
  onSubmit,
  projects,
  selectedAssets,
  selectedCount,
  users,
}: PackingSlipBuilderPanelProps) => {
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [projectUnitId, setProjectUnitId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [returnDueAt, setReturnDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [quantityByAssetId, setQuantityByAssetId] = useState<Record<string, number>>({});
  const { data: projectDetail } = useProjectDetail(normalizeOptional(projectId) ?? null);
  const initialQuantityByAssetId = useMemo(
    () => new Map((initialAssetSelections ?? []).map((selection) => [selection.assetId, selection.quantity] as const)),
    [initialAssetSelections],
  );

  useEffect(() => {
    setQuantityByAssetId((current) => {
      const nextState: Record<string, number> = {};

      selectedAssets.forEach((asset) => {
        const maxQuantity = Math.max(1, asset.quantity);
        nextState[asset.id] = Math.min(maxQuantity, Math.max(1, current[asset.id] ?? initialQuantityByAssetId.get(asset.id) ?? 1));
      });

      return nextState;
    });
  }, [initialQuantityByAssetId, selectedAssets]);

  useEffect(() => {
    setProjectUnitId((current) =>
      projectDetail.units.some((unit) => unit.id === current) ? current : "",
    );
  }, [projectDetail.units, projectId]);

  const selectedLabel = selectedCount === 1 ? "1 asset selected" : `${selectedCount} assets selected`;
  const selectedAssetDetails = useMemo(
    () =>
      selectedAssets.map((asset) => {
        const maxQuantity = Math.max(1, asset.quantity);
        return {
          ...asset,
          requestedQuantity: Math.min(maxQuantity, Math.max(1, quantityByAssetId[asset.id] ?? maxQuantity)),
        };
      }),
    [quantityByAssetId, selectedAssets],
  );
  const totalIssueQuantity = selectedAssetDetails.reduce((sum, asset) => sum + asset.requestedQuantity, 0);
  const issueQuantityLabel = totalIssueQuantity === 1 ? "1 item" : `${totalIssueQuantity} items`;
  const hasVariableQuantityAssets = selectedAssetDetails.some((asset) => asset.quantity > 1);
  const kitLockedAssets = selectedAssetDetails.filter((asset) => asset.linkedKitCount > 0);
  const unavailableAssets = selectedAssetDetails.filter((asset) => asset.linkedKitCount <= 0 && !resolveAssetAvailability(asset).isAvailable);
  const kitLockSummary = kitLockedAssets.map((asset) => `${asset.code} (${asset.linkedKitCodes.join(", ")})`).join(", ");
  const previewRows = selectedAssetDetails.slice(0, 5);
  const hiddenPreviewCount = Math.max(0, selectedAssetDetails.length - previewRows.length);

  const handleQuantityChange = (assetId: string, availableQuantity: number, rawValue: string) => {
    const parsedValue = Number.parseInt(rawValue, 10);
    const nextValue = Number.isFinite(parsedValue) ? parsedValue : 1;
    const nextQuantity = Math.min(Math.max(nextValue, 1), Math.max(1, availableQuantity));

    setQuantityByAssetId((current) => ({
      ...current,
      [assetId]: nextQuantity,
    }));
    onAssetSelectionsChange?.(
      selectedAssetDetails.map((asset) => ({
        assetId: asset.id,
        quantity: asset.id === assetId ? nextQuantity : asset.requestedQuantity,
      })),
    );
  };

  return (
    <SurfaceCard
      aside={
        <button aria-label="Close packing slip builder" className="surface-card-action" onClick={onClose} type="button">
          <X size={14} />
        </button>
      }
      title="Create packing slip"
    >
      <div className="packing-builder-summary-grid">
        <div className="summary-row">
          <span className="summary-label">Selection</span>
          <span className="summary-value">{selectedLabel}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Operational qty</span>
          <span className="summary-value">{issueQuantityLabel}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Variable qty</span>
          <span className="summary-value">{hasVariableQuantityAssets ? "Review quantities" : "Fixed"}</span>
        </div>
      </div>

      <div className="packing-builder-selection-list">
        {previewRows.map((asset) => (
          <div className="packing-builder-selection-row" key={asset.id}>
            <div className="packing-builder-selection-copy">
              <span className="packing-builder-selection-title">{asset.name}</span>
              <span className="packing-builder-selection-meta">
                {asset.code} · {resolveAssetAvailability(asset).label} · {resolveAssetAvailability(asset).reason}
                {asset.serialNumber && asset.serialNumber !== "—" ? ` · ${asset.serialNumber}` : ""}
              </span>
            </div>
            {asset.quantity > 1 ? (
              <label className="packing-builder-selection-quantity">
                <span className="action-field-label">Qty</span>
                <input
                  className="action-field-control"
                  max={asset.quantity}
                  min={1}
                  onChange={(event) => handleQuantityChange(asset.id, asset.quantity, event.target.value)}
                  type="number"
                  value={asset.requestedQuantity}
                />
              </label>
            ) : (
              <span className="packing-builder-selection-fixed">Qty 1</span>
            )}
          </div>
        ))}
        {hiddenPreviewCount ? (
          <div className="packing-builder-selection-more">
            {hiddenPreviewCount} more asset{hiddenPreviewCount === 1 ? "" : "s"} included in this slip.
          </div>
        ) : null}
      </div>

      {hasVariableQuantityAssets ? (
        <div className="action-feedback action-feedback-warning">
          Adjust quantity for bulk assets before creating the slip.
        </div>
      ) : null}

      {kitLockedAssets.length ? (
        <div className="action-feedback action-feedback-warning">
          These assets are part of active kits and cannot be issued individually: {kitLockSummary}.
        </div>
      ) : null}

      {unavailableAssets.length ? (
        <div className="action-feedback action-feedback-warning">
          Cannot issue: {summarizeUnavailableAssets(unavailableAssets)}.
        </div>
      ) : null}

      <div className="action-form-grid">
        <label className="action-field">
          <span className="action-field-label">Project</span>
          <SelectField onChange={(event) => setProjectId(event.target.value)} value={projectId}>
            <option value="">Choose project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">Responsible</span>
          <SelectField onChange={(event) => setResponsibleUserId(event.target.value)} value={responsibleUserId}>
            <option value="">Auto / current owner</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">Unit</span>
          <SelectField disabled={!projectId} onChange={(event) => setProjectUnitId(event.target.value)} value={projectUnitId}>
            <option value="">{projectId ? "No specific unit" : "Choose project first"}</option>
            {projectDetail.units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code} · {unit.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">Return due</span>
          <input
            className="action-field-control"
            onChange={(event) => setReturnDueAt(event.target.value)}
            type="datetime-local"
            value={returnDueAt}
          />
        </label>
      </div>

      <details className="detail-disclosure">
        <summary className="detail-disclosure-summary">More details</summary>
        <div className="detail-disclosure-content">
          <div className="action-form-grid">
            <label className="action-field">
              <span className="action-field-label">Department</span>
              <SelectField onChange={(event) => setDepartmentId(event.target.value)} value={departmentId}>
                <option value="">No department</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.code} · {department.name}
                  </option>
                ))}
              </SelectField>
            </label>

            <label className="action-field action-field-wide">
              <span className="action-field-label">Notes</span>
              <textarea
                className="action-field-control action-textarea"
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional note"
                rows={3}
                value={notes}
              />
            </label>
          </div>
        </div>
      </details>

      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

      <div className="action-panel-actions">
        <button className="ghost-control cancel-control" onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className="action-primary-button"
          disabled={isSubmitting || kitLockedAssets.length > 0 || unavailableAssets.length > 0}
          onClick={() =>
            void onSubmit({
              assetSelections: selectedAssetDetails.map((asset) => ({
                assetId: asset.id,
                quantity: asset.requestedQuantity,
              })),
              projectId: projectId.trim(),
              projectUnitId: normalizeOptional(projectUnitId),
              departmentId: normalizeOptional(departmentId),
              responsibleUserId: normalizeOptional(responsibleUserId),
              returnDueAt: normalizeOptional(returnDueAt),
              notes: normalizeOptional(notes),
            })
          }
          type="button"
        >
          <PackageCheck size={14} />
          <span>{isSubmitting ? "Issuing..." : "Issue packing slip"}</span>
        </button>
      </div>
    </SurfaceCard>
  );
};
