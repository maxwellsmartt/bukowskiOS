import { PackageCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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
  onClose,
  onSubmit,
  projects,
  selectedAssets,
  selectedCount,
  users,
}: PackingSlipBuilderPanelProps) => {
  const { t } = useTranslation();
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

  const selectedLabel = t("packing.builder.assetSelected", { count: selectedCount });
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
  const issueQuantityLabel = t("packing.builder.itemCount", { count: totalIssueQuantity });
  const hasVariableQuantityAssets = selectedAssetDetails.some((asset) => asset.quantity > 1);
  const kitLockedAssets = selectedAssetDetails.filter((asset) => asset.linkedKitCount > 0);
  const unavailableAssets = selectedAssetDetails.filter((asset) => asset.linkedKitCount <= 0 && !resolveAssetAvailability(asset).isAvailable);
  const kitLockSummary = kitLockedAssets.map((asset) => `${asset.code} (${asset.linkedKitCodes.join(", ")})`).join(", ");
  const availableSummaryLabel = unavailableAssets.length
    ? t("packing.builder.blocked", { count: unavailableAssets.length })
    : kitLockedAssets.length
      ? t("packing.builder.kitLocked", { count: kitLockedAssets.length })
      : t("packing.builder.readyToIssue");

  return (
    <SurfaceCard
      aside={
        <button aria-label={t("packing.builder.closeAria")} className="surface-card-action" onClick={onClose} type="button">
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

      <div className="packing-builder-context-summary">
        <strong>{t("packing.builder.cartContextTitle")}</strong>
        <span>{t("packing.builder.cartContextBody")}</span>
      </div>

      {hasVariableQuantityAssets ? (
        <div className="action-feedback action-feedback-warning">
          {t("packing.builder.bulkLocked")}
        </div>
      ) : null}

      {kitLockedAssets.length ? (
        <div className="action-feedback action-feedback-warning">
          {t("packing.builder.kitLockedWarning", { summary: kitLockSummary })}
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
          <span className="action-field-label">{t("packing.builder.responsible")}</span>
          <SelectField onChange={(event) => setResponsibleUserId(event.target.value)} value={responsibleUserId}>
            <option value="">{t("packing.builder.autoOwner")}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName}
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
            onChange={(event) => setReturnDueAt(event.target.value)}
            type="datetime-local"
            value={returnDueAt}
          />
        </label>
      </div>

      <details className="detail-disclosure">
        <summary className="detail-disclosure-summary">{t("packing.builder.moreDetails")}</summary>
        <div className="detail-disclosure-content">
          <div className="action-form-grid">
            <label className="action-field">
              <span className="action-field-label">{t("packing.builder.department")}</span>
              <SelectField onChange={(event) => setDepartmentId(event.target.value)} value={departmentId}>
                <option value="">{t("packing.builder.noDepartment")}</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.code} · {department.name}
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
        </div>
      </details>

      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

      <div className="action-panel-actions">
        <button className="ghost-control cancel-control" onClick={onClose} type="button">
          {t("common.cancel")}
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
          <span>{isSubmitting ? t("packing.builder.issuing") : t("packing.builder.issueSlip")}</span>
        </button>
      </div>
    </SurfaceCard>
  );
};
