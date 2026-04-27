import { AlertTriangle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { CatalogSnapshot, ProjectCardRow } from "@contracts";
import { useProjectDetail } from "@features/projects/useProjectsData";
import { SelectField } from "@shared/components/SelectField";
import { SurfaceCard } from "@shared/components/SurfaceCard";

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
  { value: "damage", label: "Damage" },
  { value: "loss", label: "Loss" },
  { value: "malfunction", label: "Malfunction" },
  { value: "missing_part", label: "Missing part" },
  { value: "other", label: "Other" },
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
  title = "Report incident",
  users,
}: IncidentReportPanelProps) => {
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
    return selectedAsset ? `${selectedAsset.code} · ${selectedAsset.name}` : "No asset linked";
  }, [assetId, assetOptions]);

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
    <SurfaceCard
      aside={
        <button aria-label="Close incident panel" className="surface-card-action" onClick={onClose} type="button">
          <X size={14} />
        </button>
      }
      title={title}
    >
      {assetLocked || projectLocked ? (
        <div className="action-panel-summary">
          {assetLocked ? <span>{selectedAssetLabel}</span> : null}
          {projectLocked ? <span>Project selected</span> : null}
        </div>
      ) : null}

      <div className="action-form-grid">
        <label className="action-field">
          <span className="action-field-label">Asset</span>
          <SelectField disabled={assetLocked} onChange={(event) => setAssetId(event.target.value)} value={assetId}>
            <option value="">No asset</option>
            {assetOptions.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.code} · {asset.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">Project</span>
          <SelectField disabled={projectLocked} onChange={(event) => setProjectId(event.target.value)} value={projectId}>
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">Incident type</span>
          <SelectField onChange={(event) => setIncidentType(event.target.value)} value={incidentType}>
            {incidentTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">Severity</span>
          <SelectField onChange={(event) => setSeverity(event.target.value)} value={severity}>
            {severityOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field action-field-wide">
          <span className="action-field-label">Title</span>
          <input
            className="action-field-control"
            onChange={(event) => setIncidentTitle(event.target.value)}
            placeholder="Short title"
            value={incidentTitle}
          />
        </label>

        <label className="action-field action-field-wide">
          <span className="action-field-label">Description</span>
          <textarea
            className="action-field-control action-textarea"
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What happened?"
            rows={4}
            value={description}
          />
        </label>
      </div>

      <details className="detail-disclosure">
        <summary className="detail-disclosure-summary">More details</summary>
        <div className="detail-disclosure-content">
          <div className="action-form-grid">
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
              <span className="action-field-label">Responsible</span>
              <SelectField onChange={(event) => setResponsibleUserId(event.target.value)} value={responsibleUserId}>
                <option value="">Auto / unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </SelectField>
            </label>

            <label className="action-field">
              <span className="action-field-label">Cost estimate</span>
              <input
                className="action-field-control"
                inputMode="decimal"
                onChange={(event) => setCostEstimate(event.target.value)}
                placeholder="Optional"
                value={costEstimate}
              />
            </label>

            <label className="action-field action-field-wide">
              <span className="action-field-label">Notes</span>
              <input
                className="action-field-control"
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional note"
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

      <div className="action-panel-actions">
        <button className="ghost-control cancel-control" onClick={onClose} type="button">
          Cancel
        </button>
        <button className="action-primary-button" disabled={isSubmitting} onClick={() => void handleSubmit()} type="button">
          {isSubmitting ? "Saving..." : "Create incident"}
        </button>
      </div>
    </SurfaceCard>
  );
};
