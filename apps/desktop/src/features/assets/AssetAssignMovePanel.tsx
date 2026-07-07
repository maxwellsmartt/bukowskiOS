import { ArrowRightLeft, PackagePlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CatalogSnapshot, ProjectCardRow } from "@contracts";
import { useProjectDetail } from "@features/projects/useProjectsData";
import { SelectField } from "@shared/components/SelectField";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { resolveAssetAvailability, summarizeUnavailableAssets, translateAssetAvailabilityLabel, translateAssetAvailabilityReason } from "@shared/lib/assetAvailability";

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
  totalQuantity?: number;
  assignedQuantity: number;
  checkedOutQuantity: number;
  status: string;
  project?: string;
  linkedKitCount?: number;
  linkedKitCodes?: string[];
  serialNumber?: string;
};

type AssetAssignMovePanelProps = {
  allowedModes?: Array<"assign" | "move">;
  defaultProjectId: string | null;
  departments: CatalogSnapshot["departments"];
  error: string | null;
  initialAssetSelections?: Array<{ assetId: string; quantity: number }>;
  isSubmitting: boolean;
  lockedAssetSelections?: Array<{ assetId: string; quantity: number }>;
  locations: CatalogSnapshot["locations"];
  onAssetSelectionsChange?: (selections: Array<{ assetId: string; quantity: number }>) => void;
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

const resolveAssignableAssetQuantity = (asset: AssetAssignSelectionRow) => {
  if (asset.quantity > 0) {
    return asset.quantity;
  }

  if ((asset.linkedKitCount ?? 0) > 0 && asset.checkedOutQuantity <= 0 && (asset.totalQuantity ?? 0) > 0) {
    return asset.assignedQuantity > 0 ? asset.assignedQuantity : (asset.totalQuantity ?? 0);
  }

  if (asset.assignedQuantity > 0 && asset.checkedOutQuantity === 0) {
    return asset.assignedQuantity;
  }

  return Math.max(1, asset.quantity);
};

const toSuggestedReturnDateTime = (date: string | null | undefined) => {
  if (!date) {
    return "";
  }

  const parsedDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  parsedDate.setDate(parsedDate.getDate() + 1);
  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T09:00`;
};

export const AssetAssignMovePanel = ({
  allowedModes = ["assign", "move"],
  defaultProjectId,
  departments,
  error,
  initialAssetSelections,
  isSubmitting,
  lockedAssetSelections,
  locations,
  onAssetSelectionsChange,
  onClose,
  onSubmit,
  projects,
  selectedAssets,
  selectedCount,
  subtitle,
  title,
  users,
}: AssetAssignMovePanelProps) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"assign" | "move">(allowedModes[0] ?? "assign");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [projectUnitId, setProjectUnitId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [targetLocationId, setTargetLocationId] = useState("");
  const [expectedReturnAt, setExpectedReturnAt] = useState("");
  const [notes, setNotes] = useState("");
  const [quantityByAssetId, setQuantityByAssetId] = useState<Record<string, number>>({});
  const userTouchedResponsibleRef = useRef(false);
  const userTouchedExpectedReturnRef = useRef(false);
  const { data: projectDetail } = useProjectDetail(mode === "assign" ? normalizeOptional(projectId) ?? null : null);
  const initialQuantityByAssetId = useMemo(
    () => new Map((initialAssetSelections ?? []).map((selection) => [selection.assetId, selection.quantity] as const)),
    [initialAssetSelections],
  );
  const selectedProjectUnit = useMemo(
    () => projectDetail.units.find((unit) => unit.id === projectUnitId) ?? null,
    [projectDetail.units, projectUnitId],
  );
  const suggestedExpectedReturnAt = useMemo(
    () => toSuggestedReturnDateTime((selectedProjectUnit ?? projectDetail.project)?.endDate),
    [projectDetail.project, selectedProjectUnit],
  );
  const departmentOptions = useMemo(() => {
    const departmentIds = new Set<string>();

    const sourceUnits = selectedProjectUnit ? [selectedProjectUnit] : projectDetail.units;
    sourceUnits.forEach((unit) => {
      unit.unitDepartments.forEach((department) => {
        if (department.departmentId) {
          departmentIds.add(department.departmentId);
        }
      });
    });

    return departmentIds.size ? departments.filter((department) => departmentIds.has(department.id)) : departments;
  }, [departments, projectDetail.units, selectedProjectUnit]);
  const suggestedResponsibleUserId = useMemo(() => {
    if (!departmentId) {
      return "";
    }

    const unitsToSearch = selectedProjectUnit ? [selectedProjectUnit, ...projectDetail.units.filter((unit) => unit.id !== selectedProjectUnit.id)] : projectDetail.units;
    for (const unit of unitsToSearch) {
      const assignment = unit.crewAssignments.find(
        (crewAssignment) => crewAssignment.departmentId === departmentId && Boolean(crewAssignment.linkedUserId),
      );

      if (assignment?.linkedUserId && users.some((user) => user.id === assignment.linkedUserId)) {
        return assignment.linkedUserId;
      }
    }

    return "";
  }, [departmentId, projectDetail.units, selectedProjectUnit, users]);

  useEffect(() => {
    if (!allowedModes.includes(mode)) {
      setMode(allowedModes[0] ?? "assign");
    }
  }, [allowedModes, mode]);

  useEffect(() => {
    setProjectUnitId("");
    setDepartmentId("");
    setAssignedToUserId("");
    setExpectedReturnAt("");
    userTouchedResponsibleRef.current = false;
    userTouchedExpectedReturnRef.current = false;
  }, [projectId, mode]);

  useEffect(() => {
    if (departmentId && departmentOptions.some((department) => department.id === departmentId)) {
      return;
    }

    setDepartmentId(departmentOptions.length === 1 ? departmentOptions[0]!.id : "");
  }, [departmentId, departmentOptions]);

  useEffect(() => {
    if (userTouchedResponsibleRef.current || assignedToUserId || !suggestedResponsibleUserId) {
      return;
    }

    setAssignedToUserId(suggestedResponsibleUserId);
  }, [assignedToUserId, suggestedResponsibleUserId]);

  useEffect(() => {
    if (userTouchedExpectedReturnRef.current || !suggestedExpectedReturnAt || expectedReturnAt === suggestedExpectedReturnAt) {
      return;
    }

    setExpectedReturnAt(suggestedExpectedReturnAt);
  }, [expectedReturnAt, suggestedExpectedReturnAt]);

  useEffect(() => {
    setQuantityByAssetId((current) => {
      const nextState: Record<string, number> = {};

      selectedAssets.forEach((asset) => {
        const maxQuantity = resolveAssignableAssetQuantity(asset);
        nextState[asset.id] = Math.min(maxQuantity, Math.max(1, current[asset.id] ?? initialQuantityByAssetId.get(asset.id) ?? 1));
      });

      return nextState;
    });
  }, [initialQuantityByAssetId, selectedAssets]);

  const selectedAssetDetails = useMemo(
    () =>
      selectedAssets.map((asset) => {
        const lockedQuantity = lockedAssetSelections?.find((selection) => selection.assetId === asset.id)?.quantity;
        const maxQuantity = resolveAssignableAssetQuantity(asset);
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
  const unavailableAssignAssets = selectedAssetDetails.filter((asset) => !asset.linkedKitCount && !resolveAssetAvailability(asset).isAvailable);

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

  const selectedLabel = t("assets.assignMove.selected", { count: selectedCount });
  const quantityLabel = t("assets.assignMove.itemsToAssign", { count: totalAssignQuantity });
  const handleDepartmentChange = (nextDepartmentId: string) => {
    setDepartmentId(nextDepartmentId);
    if (!userTouchedResponsibleRef.current) {
      setAssignedToUserId("");
    }
  };
  const handleResponsibleChange = (nextUserId: string) => {
    userTouchedResponsibleRef.current = true;
    setAssignedToUserId(nextUserId);
  };
  const handleExpectedReturnChange = (nextExpectedReturnAt: string) => {
    userTouchedExpectedReturnRef.current = true;
    setExpectedReturnAt(nextExpectedReturnAt);
  };

  return (
    <SurfaceCard
      className="asset-assign-move-panel"
      aside={
        <button aria-label={t("assets.assignMove.close")} className="icon-ghost-control" onClick={onClose} type="button">
          <X size={14} />
        </button>
      }
      title={title ?? t("assets.assignMove.title")}
      subtitle={subtitle}
    >
      <div className="action-panel-summary">
        <span>{selectedLabel}</span>
        {mode === "assign" ? (
          <span>{quantityLabel}</span>
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
                    {(() => {
                      const availability = resolveAssetAvailability(asset);
                      return `${asset.code} · ${translateAssetAvailabilityLabel(availability, t)} · ${translateAssetAvailabilityReason(availability, t)}`;
                    })()}
                    {asset.assignedQuantity > 0 ? ` · ${t("assets.assignMove.reserved", { count: asset.assignedQuantity })}` : ""}
                    {asset.serialNumber && asset.serialNumber !== "—" ? ` · ${asset.serialNumber}` : ""}
                  </span>
                </div>
                {lockedAssetSelections?.length ? (
                  <span className="packing-builder-selection-fixed">{t("assets.assignMove.qtyValue", { count: asset.requestedQuantity })}</span>
                ) : asset.sourceQuantity > 1 ? (
                  <label className="packing-builder-selection-quantity">
                    <span className="action-field-label">{t("assets.cart.qty")}</span>
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
                  <span className="packing-builder-selection-fixed">{t("assets.assignMove.qtyValue", { count: 1 })}</span>
                )}
              </div>
            ))}
          </div>

          {hasVariableQuantityAssets ? (
            <div className="action-feedback action-feedback-warning">
              {t("assets.assignMove.adjustQuantity")}
            </div>
          ) : null}
          {unavailableAssignAssets.length ? (
            <div className="action-feedback action-feedback-warning">
              {t("assets.assignMove.cannotAssign", { summary: summarizeUnavailableAssets(unavailableAssignAssets, t) })}
            </div>
          ) : null}
        </>
      ) : null}

      {allowedModes.length > 1 ? (
        <div className="action-mode-toggle" role="tablist" aria-label={t("assets.assignMove.modeAria")}>
          {allowedModes.includes("assign") ? (
            <button
              className={`action-mode-button${mode === "assign" ? " active" : ""}`}
              onClick={() => setMode("assign")}
              type="button"
            >
              <PackagePlus size={14} />
              <span>{t("assets.assignMove.assign")}</span>
            </button>
          ) : null}
          {allowedModes.includes("move") ? (
            <button
              className={`action-mode-button${mode === "move" ? " active" : ""}`}
              onClick={() => setMode("move")}
              type="button"
            >
              <ArrowRightLeft size={14} />
              <span>{t("assets.assignMove.move")}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="action-form-grid">
        {mode === "assign" ? (
          <>
            <label className="action-field">
              <span className="action-field-label">{t("assets.assignMove.project")}</span>
              <SelectField onChange={(event) => setProjectId(event.target.value)} value={projectId}>
                <option value="">{t("assets.assignMove.noProject")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.code} · {project.name}
                  </option>
                ))}
              </SelectField>
            </label>

            <label className="action-field">
              <span className="action-field-label">{t("assets.assignMove.department")}</span>
              <SelectField onChange={(event) => handleDepartmentChange(event.target.value)} value={departmentId}>
                <option value="">{t("assets.assignMove.noDepartment")}</option>
                {departmentOptions.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.code} · {department.name}
                  </option>
                ))}
              </SelectField>
            </label>

            <label className="action-field">
              <span className="action-field-label">{t("assets.assignMove.unit")}</span>
              <SelectField disabled={!projectId} onChange={(event) => setProjectUnitId(event.target.value)} value={projectUnitId}>
                <option value="">{projectId ? t("assets.assignMove.noSpecificUnit") : t("assets.assignMove.chooseProjectFirst")}</option>
                {projectDetail.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code} · {unit.name}
                  </option>
                ))}
              </SelectField>
            </label>
          </>
        ) : null}

        <label className="action-field">
          <span className="action-field-label">{t("assets.assignMove.targetLocation")}</span>
          <SelectField onChange={(event) => setTargetLocationId(event.target.value)} value={targetLocationId}>
            <option value="">{mode === "assign" ? t("assets.assignMove.keepCurrentLocation") : t("assets.assignMove.chooseDestination")}</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code} · {location.name}
              </option>
            ))}
          </SelectField>
        </label>

        {mode === "assign" ? (
          <>
            <label className="action-field">
              <span className="action-field-label">{t("assets.assignMove.responsible")}</span>
              <SelectField onChange={(event) => handleResponsibleChange(event.target.value)} value={assignedToUserId}>
                <option value="">{t("assets.assignMove.unassigned")}</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </SelectField>
            </label>

            <label className="action-field">
              <span className="action-field-label">{t("assets.assignMove.expectedReturn")}</span>
              <input
                className="action-field-control"
                onChange={(event) => handleExpectedReturnChange(event.target.value)}
                type="datetime-local"
                value={expectedReturnAt}
              />
            </label>
          </>
        ) : null}

        <label className="action-field action-field-wide">
          <span className="action-field-label">{t("assets.assignMove.notes")}</span>
          <textarea
            className="action-field-control action-textarea"
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t("assets.assignMove.optionalNote")}
            rows={3}
            value={notes}
          />
        </label>
      </div>

      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

      <div className="action-panel-actions asset-assign-move-actions">
        <button className="ghost-control cancel-control" onClick={onClose} type="button">
          {t("common.cancel")}
        </button>
        <button
          className="action-primary-button"
          disabled={isSubmitting || (mode === "assign" && unavailableAssignAssets.length > 0)}
          onClick={() => void handleSubmit()}
          type="button"
        >
          {isSubmitting ? t("assets.assignMove.applying") : mode === "assign" ? t("assets.assignMove.applyAssignment") : t("assets.assignMove.moveAssets")}
        </button>
      </div>
    </SurfaceCard>
  );
};
