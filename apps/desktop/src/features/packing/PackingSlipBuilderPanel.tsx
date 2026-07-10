import { PackageCheck, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AssetListRow, CatalogSnapshot, PackingSlipAssetSelection, ProjectCardRow } from "@contracts";
import { useProjectDetail } from "@features/projects/useProjectsData";
import { SelectField } from "@shared/components/SelectField";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { resolveAssetPackingAvailability, summarizeUnavailableAssets } from "@shared/lib/assetAvailability";

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
  defaultDepartmentId?: string | null;
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
  sourceKitId?: string | null;
  users: CatalogSnapshot["users"];
};

const normalizeOptional = (value: string) => {
  const nextValue = value.trim();
  return nextValue ? nextValue : undefined;
};

const toSuggestedReturnDateTime = (dateValue: string | null | undefined) => {
  if (!dateValue) {
    return "";
  }

  const parsedDate = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  parsedDate.setDate(parsedDate.getDate() + 1);
  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T09:00`;
};

export const PackingSlipBuilderPanel = ({
  defaultDepartmentId,
  defaultProjectId,
  departments,
  error,
  initialAssetSelections,
  isSubmitting,
  onClose,
  onSubmit,
  projects,
  selectedAssets,
  selectedCount,
  sourceKitId,
  users,
}: PackingSlipBuilderPanelProps) => {
  const { t } = useTranslation();
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [projectUnitId, setProjectUnitId] = useState("");
  const [departmentId, setDepartmentId] = useState(defaultDepartmentId ?? "");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [returnDueAt, setReturnDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [quantityByAssetId, setQuantityByAssetId] = useState<Record<string, number>>({});
  const userTouchedResponsibleRef = useRef(false);
  const userTouchedReturnRef = useRef(false);
  const { data: projectDetail } = useProjectDetail(normalizeOptional(projectId) ?? null);
  const initialQuantityByAssetId = useMemo(
    () => new Map((initialAssetSelections ?? []).map((selection) => [selection.assetId, selection.quantity] as const)),
    [initialAssetSelections],
  );
  const getPackingSourceQuantity = (asset: AssetListRow) =>
    normalizeOptional(projectId) && asset.projectId === normalizeOptional(projectId) && asset.assignedQuantity > 0
      ? asset.assignedQuantity
      : asset.quantity;

  useEffect(() => {
    setQuantityByAssetId((current) => {
      const nextState: Record<string, number> = {};

      selectedAssets.forEach((asset) => {
        const maxQuantity = Math.max(1, getPackingSourceQuantity(asset));
        nextState[asset.id] = Math.min(maxQuantity, Math.max(1, current[asset.id] ?? initialQuantityByAssetId.get(asset.id) ?? 1));
      });

      return nextState;
    });
  }, [initialQuantityByAssetId, projectId, selectedAssets]);

  useEffect(() => {
    setProjectUnitId((current) =>
      projectDetail.units.some((unit) => unit.id === current) ? current : "",
    );
  }, [projectDetail.units, projectId]);

  const selectedProjectUnit = useMemo(
    () => projectDetail.units.find((unit) => unit.id === projectUnitId) ?? null,
    [projectDetail.units, projectUnitId],
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
  const suggestedReturnDueAt = useMemo(
    () => toSuggestedReturnDateTime((selectedProjectUnit ?? projectDetail.project)?.endDate),
    [projectDetail.project, selectedProjectUnit],
  );

  useEffect(() => {
    setProjectUnitId("");
    setDepartmentId(defaultDepartmentId ?? "");
    setResponsibleUserId("");
    setReturnDueAt("");
    userTouchedResponsibleRef.current = false;
    userTouchedReturnRef.current = false;
  }, [defaultDepartmentId, projectId]);

  useEffect(() => {
    if (departmentId && departmentOptions.some((department) => department.id === departmentId)) {
      return;
    }

    setDepartmentId(defaultDepartmentId && departmentOptions.some((department) => department.id === defaultDepartmentId)
      ? defaultDepartmentId
      : departmentOptions.length === 1
        ? departmentOptions[0]!.id
        : "");
  }, [defaultDepartmentId, departmentId, departmentOptions]);

  useEffect(() => {
    if (userTouchedResponsibleRef.current || responsibleUserId || !suggestedResponsibleUserId) {
      return;
    }

    setResponsibleUserId(suggestedResponsibleUserId);
  }, [responsibleUserId, suggestedResponsibleUserId]);

  useEffect(() => {
    if (userTouchedReturnRef.current || !suggestedReturnDueAt || returnDueAt === suggestedReturnDueAt) {
      return;
    }

    setReturnDueAt(suggestedReturnDueAt);
  }, [returnDueAt, suggestedReturnDueAt]);

  const selectedLabel = t("packing.builder.assetSelected", { count: selectedCount });
  const selectedAssetDetails = useMemo(
    () =>
      selectedAssets.map((asset) => {
        const maxQuantity = Math.max(1, getPackingSourceQuantity(asset));
        return {
          ...asset,
          quantity: maxQuantity,
          requestedQuantity: Math.min(maxQuantity, Math.max(1, quantityByAssetId[asset.id] ?? maxQuantity)),
        };
      }),
    [projectId, quantityByAssetId, selectedAssets],
  );
  const totalIssueQuantity = selectedAssetDetails.reduce((sum, asset) => sum + asset.requestedQuantity, 0);
  const issueQuantityLabel = t("packing.builder.itemCount", { count: totalIssueQuantity });
  const hasVariableQuantityAssets = selectedAssetDetails.some((asset) => asset.quantity > 1);
  const kitLockedAssets = selectedAssetDetails.filter((asset) => asset.linkedKitCount > 0 && !sourceKitId);
  const unavailableAssets = selectedAssetDetails.filter(
    (asset) => !resolveAssetPackingAvailability(asset, normalizeOptional(projectId), sourceKitId).isAvailable,
  );
  const kitLockSummary = kitLockedAssets.map((asset) => `${asset.code} (${asset.linkedKitCodes.join(", ")})`).join(", ");
  const availableSummaryLabel = unavailableAssets.length
    ? t("packing.builder.blocked", { count: unavailableAssets.length })
    : kitLockedAssets.length
      ? t("packing.builder.kitAware", { count: kitLockedAssets.length })
      : t("packing.builder.readyToIssue");

  return (
    <SurfaceCard
      aside={
        <button aria-label={t("packing.builder.closeAria")} className="icon-ghost-control" onClick={onClose} type="button">
          <X size={14} />
        </button>
      }
      title={t("packing.builder.title")}
    >
      <div className="packing-builder-summary-grid">
        <div className="summary-row">
          <span className="summary-label">{t("packing.builder.selection")}</span>
          <span className="summary-value">{selectedLabel}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.builder.operationalQty")}</span>
          <span className="summary-value">{issueQuantityLabel}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.builder.variableQty")}</span>
          <span className="summary-value">{hasVariableQuantityAssets ? t("packing.builder.fromCart") : t("packing.builder.fixed")}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t("packing.builder.availability")}</span>
          <span className="summary-value">{availableSummaryLabel}</span>
        </div>
      </div>

      {hasVariableQuantityAssets ? (
        <div className="action-feedback action-feedback-warning">
          {t("packing.builder.bulkLocked")}
        </div>
      ) : null}

      {kitLockedAssets.length ? (
        <div className="action-feedback action-feedback-warning">
          {t("packing.builder.kitAwareWarning", { summary: kitLockSummary })}
        </div>
      ) : null}

      {unavailableAssets.length ? (
        <div className="action-feedback action-feedback-warning">
          {t("packing.builder.cannotIssue", { summary: summarizeUnavailableAssets(unavailableAssets, t) })}
        </div>
      ) : null}

      <div className="action-form-grid">
        <label className="action-field">
          <span className="action-field-label">{t("packing.builder.project")}</span>
          <SelectField onChange={(event) => setProjectId(event.target.value)} value={projectId}>
            <option value="">{t("packing.builder.chooseProject")}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">{t("packing.builder.department")}</span>
          <SelectField onChange={(event) => setDepartmentId(event.target.value)} value={departmentId}>
            <option value="">{t("packing.builder.noDepartment")}</option>
            {departmentOptions.map((department) => (
              <option key={department.id} value={department.id}>
                {department.code} · {department.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">{t("packing.builder.unit")}</span>
          <SelectField disabled={!projectId} onChange={(event) => setProjectUnitId(event.target.value)} value={projectUnitId}>
            <option value="">{projectId ? t("packing.builder.noSpecificUnit") : t("packing.builder.chooseProjectFirst")}</option>
            {projectDetail.units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code} · {unit.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">{t("packing.builder.returnDue")}</span>
          <input
            className="action-field-control"
            onChange={(event) => {
              userTouchedReturnRef.current = true;
              setReturnDueAt(event.target.value);
            }}
            type="datetime-local"
            value={returnDueAt}
          />
        </label>

        <label className="action-field">
          <span className="action-field-label">{t("packing.builder.responsible")}</span>
          <SelectField
            onChange={(event) => {
              userTouchedResponsibleRef.current = true;
              setResponsibleUserId(event.target.value);
            }}
            value={responsibleUserId}
          >
            <option value="">{t("packing.builder.autoOwner")}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field action-field-wide">
          <span className="action-field-label">{t("packing.builder.notes")}</span>
          <textarea
            className="action-field-control action-textarea"
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t("packing.builder.optionalNote")}
            rows={3}
            value={notes}
          />
        </label>
      </div>

      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

      <div className="action-panel-actions">
        <button className="ghost-control cancel-control" onClick={onClose} type="button">
          {t("common.cancel")}
        </button>
        <button
          className="action-primary-button"
          disabled={isSubmitting || unavailableAssets.length > 0}
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
          <span>{isSubmitting ? t("packing.builder.issuing") : t("packing.builder.issueSlip")}</span>
        </button>
      </div>
    </SurfaceCard>
  );
};
