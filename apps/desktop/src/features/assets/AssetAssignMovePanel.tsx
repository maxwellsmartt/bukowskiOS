import { ArrowRightLeft, PackagePlus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { CatalogSnapshot, ProjectCardRow } from "@contracts";
import { useProjectDetail } from "@features/projects/useProjectsData";
import { SelectField } from "@shared/components/SelectField";
import { SurfaceCard } from "@shared/components/SurfaceCard";

export type AssetAssignMoveFormValue = {
  assetSelections?: Array<{ assetId: string; quantity: number }>;
  mode: "assign" | "move";
  projectId?: string;
  projectUnitId?: string;
  departmentId?: string;
  assignedToUserId?: string;
  targetLocationId?: string;
  expectedReturnAt?: string;
  notes?: string;
};

export type AssetAssignSelectionRow = {
  id: string;
  name: string;
  code: string;
  quantity: number;
  assignedQuantity: number;
  checkedOutQuantity: number;
  serialNumber?: string;
};

type AssetAssignMovePanelProps = {
  allowedModes?: Array<"assign" | "move">;
  defaultProjectId: string | null;
  departments: CatalogSnapshot["departments"];
  error: string | null;
  isSubmitting: boolean;
  lockedAssetSelections?: Array<{ assetId: string; quantity: number }>;
  locations: CatalogSnapshot["locations"];
  onClose: () => void;
  onSubmit: (value: AssetAssignMoveFormValue) => Promise<void>;
  projects: ProjectCardRow[];
  selectedAssets: AssetAssignSelectionRow[];
  selectedCount: number;
  subtitle?: string;
  title?: string;
  users: CatalogSnapshot["users"];
};

const normalizeOptional = (value: string) => {
  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : undefined;
};

export const AssetAssignMovePanel = ({
  allowedModes = ["assign", "move"],
  defaultProjectId,
  departments,
  error,
  isSubmitting,
  lockedAssetSelections,
  locations,
  onClose,
  onSubmit,
  projects,
  selectedAssets,
  selectedCount,
  subtitle,
  title,
  users,
}: AssetAssignMovePanelProps) => {
  const [mode, setMode] = useState<"assign" | "move">(allowedModes[0] ?? "assign");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [projectUnitId, setProjectUnitId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [targetLocationId, setTargetLocationId] = useState("");
  const [expectedReturnAt, setExpectedReturnAt] = useState("");
  const [notes, setNotes] = useState("");
  const [quantityByAssetId, setQuantityByAssetId] = useState<Record<string, number>>({});
  const { data: projectDetail } = useProjectDetail(mode === "assign" ? normalizeOptional(projectId) ?? null : null);

  useEffect(() => {
    if (!allowedModes.includes(mode)) {
      setMode(allowedModes[0] ?? "assign");
    }
  }, [allowedModes, mode]);

  useEffect(() => {
    setProjectUnitId("");
  }, [projectId, mode]);

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

  const selectedAssetDetails = useMemo(
    () =>
      selectedAssets.map((asset) => {
        const lockedQuantity = lockedAssetSelections?.find((selection) => selection.assetId === asset.id)?.quantity;
        const maxQuantity =
          asset.quantity > 0
            ? asset.quantity
            : asset.assignedQuantity > 0 && asset.checkedOutQuantity === 0
              ? asset.assignedQuantity
              : Math.max(1, asset.quantity);
        return {
          ...asset,
          sourceQuantity: maxQuantity,
          requestedQuantity:
            typeof lockedQuantity === "number"
              ? lockedQuantity
              : Math.min(maxQuantity, Math.max(1, quantityByAssetId[asset.id] ?? maxQuantity)),
        };
      }),
    [lockedAssetSelections, quantityByAssetId, selectedAssets],
  );
  const totalAssignQuantity = selectedAssetDetails.reduce((sum, asset) => sum + asset.requestedQuantity, 0);
  const hasVariableQuantityAssets = !lockedAssetSelections?.length && selectedAssetDetails.some((asset) => asset.sourceQuantity > 1);

  const handleQuantityChange = (assetId: string, availableQuantity: number, rawValue: string) => {
    const parsedValue = Number.parseInt(rawValue, 10);
    const nextValue = Number.isFinite(parsedValue) ? parsedValue : 1;

    setQuantityByAssetId((current) => ({
      ...current,
      [assetId]: Math.min(Math.max(nextValue, 1), Math.max(1, availableQuantity)),
    }));
  };

  const handleSubmit = async () => {
    await onSubmit({
      assetSelections:
        mode === "assign"
          ? selectedAssetDetails.map((asset) => ({
              assetId: asset.id,
              quantity: asset.requestedQuantity,
            }))
          : undefined,
      mode,
      projectId: mode === "assign" ? normalizeOptional(projectId) : undefined,
      projectUnitId: mode === "assign" ? normalizeOptional(projectUnitId) : undefined,
      departmentId: mode === "assign" ? normalizeOptional(departmentId) : undefined,
      assignedToUserId: mode === "assign" ? normalizeOptional(assignedToUserId) : undefined,
      targetLocationId: normalizeOptional(targetLocationId),
      expectedReturnAt: mode === "assign" ? normalizeOptional(expectedReturnAt) : undefined,
      notes: normalizeOptional(notes),
    });
  };

  const selectedLabel = selectedCount === 1 ? "1 asset selected" : `${selectedCount} assets selected`;

  return (
    <SurfaceCard
      aside={
        <button aria-label="Close assign and move panel" className="surface-card-action" onClick={onClose} type="button">
          <X size={14} />
        </button>
      }
      title={title ?? "Assign / move"}
      subtitle={subtitle ?? "Run one auditable operational command against the full selection. This writes timeline events and updates current state together."}
    >
      <div className="chip-row">
        <span className="action-panel-selection">{selectedLabel}</span>
        {mode === "assign" ? (
          <span className="action-panel-selection">
            {totalAssignQuantity} {totalAssignQuantity === 1 ? "item to assign" : "items to assign"}
          </span>
        ) : null}
      </div>

      {mode === "assign" ? (
        <>
          <div className="packing-builder-selection-list">
            {selectedAssetDetails.map((asset) => (
              <div className="packing-builder-selection-row" key={asset.id}>
                <div className="packing-builder-selection-copy">
                  <span className="packing-builder-selection-title">{asset.name}</span>
                  <span className="packing-builder-selection-meta">
                    {asset.code} · Assignable {asset.sourceQuantity}
                    {asset.assignedQuantity > 0 ? ` · Reserved ${asset.assignedQuantity}` : ""}
                    {asset.serialNumber && asset.serialNumber !== "—" ? ` · ${asset.serialNumber}` : ""}
                  </span>
                </div>
                {lockedAssetSelections?.length ? (
                  <span className="packing-builder-selection-fixed">Qty {asset.requestedQuantity}</span>
                ) : asset.sourceQuantity > 1 ? (
                  <label className="packing-builder-selection-quantity">
                    <span className="action-field-label">Qty</span>
                    <input
                      className="action-field-control"
                      max={asset.sourceQuantity}
                      min={1}
                      onChange={(event) => handleQuantityChange(asset.id, asset.sourceQuantity, event.target.value)}
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
              Bulk rows can assign a partial quantity here. This MVP keeps one active assignment context per bulk row.
            </div>
          ) : null}
        </>
      ) : null}

      {allowedModes.length > 1 ? (
        <div className="action-mode-toggle" role="tablist" aria-label="Asset action mode">
          {allowedModes.includes("assign") ? (
            <button
              className={`action-mode-button${mode === "assign" ? " active" : ""}`}
              onClick={() => setMode("assign")}
              type="button"
            >
              <PackagePlus size={14} />
              <span>Assign</span>
            </button>
          ) : null}
          {allowedModes.includes("move") ? (
            <button
              className={`action-mode-button${mode === "move" ? " active" : ""}`}
              onClick={() => setMode("move")}
              type="button"
            >
              <ArrowRightLeft size={14} />
              <span>Move</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="action-form-grid">
        {mode === "assign" ? (
          <>
            <label className="action-field">
              <span className="action-field-label">Project</span>
              <SelectField onChange={(event) => setProjectId(event.target.value)} value={projectId}>
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.code} · {project.name}
                  </option>
                ))}
              </SelectField>
            </label>

            <label className="action-field">
              <span className="action-field-label">Responsible</span>
              <SelectField onChange={(event) => setAssignedToUserId(event.target.value)} value={assignedToUserId}>
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
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
              <span className="action-field-label">Expected return</span>
              <input
                className="action-field-control"
                onChange={(event) => setExpectedReturnAt(event.target.value)}
                type="datetime-local"
                value={expectedReturnAt}
              />
            </label>
          </>
        ) : null}

        <label className="action-field">
          <span className="action-field-label">Target location</span>
          <SelectField onChange={(event) => setTargetLocationId(event.target.value)} value={targetLocationId}>
            <option value="">{mode === "assign" ? "Keep current location" : "Choose destination"}</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code} · {location.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field action-field-wide">
          <span className="action-field-label">Notes</span>
          <textarea
            className="action-field-control action-textarea"
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional operational note for the timeline."
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
        <button className="action-primary-button" disabled={isSubmitting} onClick={() => void handleSubmit()} type="button">
          {isSubmitting ? "Applying..." : mode === "assign" ? "Apply assignment" : "Move assets"}
        </button>
      </div>
    </SurfaceCard>
  );
};
