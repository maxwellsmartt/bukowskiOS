import { PackageCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AssetListRow, CatalogSnapshot, PackingSlipAssetSelection, ProjectCardRow } from "@contracts";
import { useProjectDetail } from "@features/projects/useProjectsData";
import { SelectField } from "@shared/components/SelectField";
import { SurfaceCard } from "@shared/components/SurfaceCard";

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
  isSubmitting: boolean;
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
  isSubmitting,
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

  useEffect(() => {
    setQuantityByAssetId((current) => {
      const nextState: Record<string, number> = {};

      selectedAssets.forEach((asset) => {
        const maxQuantity = Math.max(1, asset.quantity);
        nextState[asset.id] = Math.min(maxQuantity, Math.max(1, current[asset.id] ?? maxQuantity));
      });

      return nextState;
    });
  }, [selectedAssets]);

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
  const hasVariableQuantityAssets = selectedAssetDetails.some((asset) => asset.quantity > 1);

  const handleQuantityChange = (assetId: string, availableQuantity: number, rawValue: string) => {
    const parsedValue = Number.parseInt(rawValue, 10);
    const nextValue = Number.isFinite(parsedValue) ? parsedValue : 1;

    setQuantityByAssetId((current) => ({
      ...current,
      [assetId]: Math.min(Math.max(nextValue, 1), Math.max(1, availableQuantity)),
    }));
  };

  return (
    <SurfaceCard
      aside={
        <button aria-label="Close packing slip builder" className="surface-card-action" onClick={onClose} type="button">
          <X size={14} />
        </button>
      }
      title="Create packing slip"
      subtitle="Issue a real outgoing document from the current asset selection. This writes slip items, checkout events and current state updates."
    >
      <div className="chip-row">
        <span className="action-panel-selection">{selectedLabel}</span>
        <span className="action-panel-selection">
          {totalIssueQuantity} {totalIssueQuantity === 1 ? "item to issue" : "items to issue"}
        </span>
      </div>

      <div className="packing-builder-selection-list">
        {selectedAssetDetails.map((asset) => (
          <div className="packing-builder-selection-row" key={asset.id}>
            <div className="packing-builder-selection-copy">
              <span className="packing-builder-selection-title">{asset.name}</span>
              <span className="packing-builder-selection-meta">
                {asset.code} · Available {asset.quantity}
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
      </div>

      {hasVariableQuantityAssets ? (
        <div className="action-feedback action-feedback-warning">
          Bulk rows can issue a partial quantity here. Serialized or unitary assets still issue one item at a time.
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

        <label className="action-field">
          <span className="action-field-label">Return due</span>
          <input
            className="action-field-control"
            onChange={(event) => setReturnDueAt(event.target.value)}
            type="datetime-local"
            value={returnDueAt}
          />
        </label>

        <label className="action-field action-field-wide">
          <span className="action-field-label">Notes</span>
          <textarea
            className="action-field-control action-textarea"
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional dispatch note for the slip and asset timeline."
            rows={3}
            value={notes}
          />
        </label>
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
