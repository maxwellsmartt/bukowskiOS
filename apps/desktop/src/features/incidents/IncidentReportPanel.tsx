import { AlertTriangle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CatalogSnapshot, ProjectCardRow } from "@contracts";
import { useProjectDetail } from "@features/projects/useProjectsData";
import { SearchSelect } from "@shared/components/SearchSelect";
import { SelectField } from "@shared/components/SelectField";

export type IncidentAssetOption = {
  id: string;
  code: string;
  name: string;
};

export type IncidentReportDraft = {
  assetId?: string;
  projectId?: string;
  projectUnitId?: string;
  departmentId?: string;
  responsibleUserId?: string;
  incidentType: string;
  severity: string;
  title: string;
  description: string;
  costEstimate?: number;
  notes?: string;
};

type IncidentReportPanelProps = {
  assetLocked?: boolean;
  assetOptions: IncidentAssetOption[];
  departments: CatalogSnapshot["departments"];
  error: string | null;
  initialValue?: Partial<IncidentReportDraft>;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (value: IncidentReportDraft) => Promise<void>;
  projectLocked?: boolean;
  projects: ProjectCardRow[];
  title?: string;
  users: CatalogSnapshot["users"];
};

const incidentTypeOptions = [
  { value: "damage", labelKey: "incidents.types.damage", fallback: "Damage" },
  { value: "loss", labelKey: "incidents.types.loss", fallback: "Loss" },
  { value: "malfunction", labelKey: "incidents.types.malfunction", fallback: "Malfunction" },
  { value: "missing_part", labelKey: "incidents.types.missing_part", fallback: "Missing part" },
  { value: "other", labelKey: "incidents.types.other", fallback: "Other" },
] as const;

const severityOptions = ["Low", "Medium", "High"] as const;

const normalizeOptional = (value: string) => {
  const nextValue = value.trim();
  return nextValue ? nextValue : undefined;
};

export const IncidentReportPanel = ({
  assetLocked = false,
  assetOptions,
  departments,
  error,
  initialValue,
  isSubmitting,
  onClose,
  onSubmit,
  projectLocked = false,
  projects,
  title,
  users,
}: IncidentReportPanelProps) => {
  const { t } = useTranslation();
  const [assetId, setAssetId] = useState(initialValue?.assetId ?? "");
  const [projectId, setProjectId] = useState(initialValue?.projectId ?? "");
  const [projectUnitId, setProjectUnitId] = useState(initialValue?.projectUnitId ?? "");
  const [departmentId, setDepartmentId] = useState(initialValue?.departmentId ?? "");
  const [responsibleUserId, setResponsibleUserId] = useState(initialValue?.responsibleUserId ?? "");
  const [incidentType, setIncidentType] = useState(initialValue?.incidentType ?? "damage");
  const [severity, setSeverity] = useState(initialValue?.severity ?? "Medium");
  const [incidentTitle, setIncidentTitle] = useState(initialValue?.title ?? "");
  const [description, setDescription] = useState(initialValue?.description ?? "");
  const [costEstimate, setCostEstimate] = useState(
    typeof initialValue?.costEstimate === "number" ? String(initialValue.costEstimate) : "",
  );
  const [notes, setNotes] = useState(initialValue?.notes ?? "");
  const { data: projectDetail } = useProjectDetail(normalizeOptional(projectId) ?? null);

  useEffect(() => {
    setProjectUnitId((current) =>
      projectDetail.units.some((unit) => unit.id === current) ? current : "",
    );
  }, [projectDetail.units, projectId]);

  const selectedAssetLabel = useMemo(() => {
    const selectedAsset = assetOptions.find((option) => option.id === assetId);
    return selectedAsset ? `${selectedAsset.code} · ${selectedAsset.name}` : t("incidents.report.noAssetLinked");
  }, [assetId, assetOptions, t]);

  const handleSubmit = async () => {
    await onSubmit({
      assetId: normalizeOptional(assetId),
      projectId: normalizeOptional(projectId),
      projectUnitId: normalizeOptional(projectUnitId),
      departmentId: normalizeOptional(departmentId),
      responsibleUserId: normalizeOptional(responsibleUserId),
      incidentType,
      severity,
      title: incidentTitle,
      description,
      costEstimate: normalizeOptional(costEstimate) ? Number(costEstimate) : undefined,
      notes: normalizeOptional(notes),
    });
  };

  return (
    <div className="incident-report-dialog">
      <div className="document-preview-header">
        <span className="document-preview-title">{title ?? t("incidents.report.title")}</span>
        <button aria-label={t("incidents.report.close")} className="icon-ghost-control" onClick={onClose} type="button">
          <X size={16} />
        </button>
      </div>
      <div className="modal-form-body">
      {assetLocked || projectLocked ? (
        <div className="action-panel-summary">
          {assetLocked ? <span>{selectedAssetLabel}</span> : null}
          {projectLocked ? <span>{t("incidents.report.projectSelected")}</span> : null}
        </div>
      ) : null}

      <div className="action-form-grid">
        <label className="action-field">
          <span className="action-field-label">{t("incidents.report.asset")}</span>
          <SearchSelect
            ariaLabel={t("incidents.report.asset")}
            disabled={assetLocked}
            emptyOptionLabel={t("incidents.report.noAsset")}
            onChange={setAssetId}
            options={assetOptions.map((asset) => ({
              value: asset.id,
              label: `${asset.code} · ${asset.name}`,
            }))}
            placeholder={t("incidents.report.noAsset")}
            searchPlaceholder={t("shared.searchSelect.assetPlaceholder")}
            value={assetId}
          />
        </label>

        <label className="action-field">
          <span className="action-field-label">{t("incidents.report.project")}</span>
          <SearchSelect
            ariaLabel={t("incidents.report.project")}
            disabled={projectLocked}
            emptyOptionLabel={t("incidents.report.noProject")}
            onChange={setProjectId}
            options={projects.map((project) => ({
              value: project.id,
              label: `${project.code} · ${project.name}`,
            }))}
            placeholder={t("incidents.report.noProject")}
            searchPlaceholder={t("shared.searchSelect.projectPlaceholder")}
            value={projectId}
          />
        </label>

        <label className="action-field">
          <span className="action-field-label">{t("incidents.report.incidentType")}</span>
          <SelectField onChange={(event) => setIncidentType(event.target.value)} value={incidentType}>
            {incidentTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey, { defaultValue: option.fallback })}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">{t("incidents.report.severity")}</span>
          <SelectField onChange={(event) => setSeverity(event.target.value)} value={severity}>
            {severityOptions.map((option) => (
              <option key={option} value={option}>
                {t(`incidents.severity.${option}`, { defaultValue: option })}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field action-field-wide">
          <span className="action-field-label">{t("incidents.report.incidentTitle")}</span>
          <input
            className="action-field-control"
            onChange={(event) => setIncidentTitle(event.target.value)}
            placeholder={t("incidents.report.titlePlaceholder")}
            value={incidentTitle}
          />
        </label>

        <label className="action-field action-field-wide">
          <span className="action-field-label">{t("incidents.report.description")}</span>
          <textarea
            className="action-field-control action-textarea"
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("incidents.report.descriptionPlaceholder")}
            rows={4}
            value={description}
          />
        </label>
      </div>

      <details className="detail-disclosure">
        <summary className="detail-disclosure-summary">{t("incidents.report.moreDetails")}</summary>
        <div className="detail-disclosure-content">
          <div className="action-form-grid">
            <label className="action-field">
              <span className="action-field-label">{t("incidents.report.unit")}</span>
              <SelectField disabled={!projectId} onChange={(event) => setProjectUnitId(event.target.value)} value={projectUnitId}>
                <option value="">{projectId ? t("incidents.report.noSpecificUnit") : t("incidents.report.chooseProjectFirst")}</option>
                {projectDetail.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code} · {unit.name}
                  </option>
                ))}
              </SelectField>
            </label>

            <label className="action-field">
              <span className="action-field-label">{t("incidents.report.department")}</span>
              <SelectField onChange={(event) => setDepartmentId(event.target.value)} value={departmentId}>
                <option value="">{t("incidents.report.noDepartment")}</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.code} · {department.name}
                  </option>
                ))}
              </SelectField>
            </label>

            <label className="action-field">
              <span className="action-field-label">{t("incidents.report.responsible")}</span>
              <SelectField onChange={(event) => setResponsibleUserId(event.target.value)} value={responsibleUserId}>
                <option value="">{t("incidents.report.autoUnassigned")}</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </SelectField>
            </label>

            <label className="action-field">
              <span className="action-field-label">{t("incidents.report.costEstimate")}</span>
              <input
                className="action-field-control"
                inputMode="decimal"
                onChange={(event) => setCostEstimate(event.target.value)}
                placeholder={t("common.optional")}
                value={costEstimate}
              />
            </label>

            <label className="action-field action-field-wide">
              <span className="action-field-label">{t("incidents.report.notes")}</span>
              <input
                className="action-field-control"
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t("incidents.report.optionalNote")}
                value={notes}
              />
            </label>
          </div>
        </div>
      </details>

      {error ? (
        <div className="action-feedback action-feedback-error">
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      ) : null}
      </div>

      <div className="document-preview-header packing-insurance-export-footer">
        <button className="ghost-control" onClick={onClose} type="button">
          {t("common.cancel")}
        </button>
        <button className="action-primary-button" disabled={isSubmitting} onClick={() => void handleSubmit()} type="button">
          {isSubmitting ? t("common.saving") : t("incidents.report.create")}
        </button>
      </div>
    </div>
  );
};
