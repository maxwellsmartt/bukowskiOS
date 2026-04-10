import { PackageCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { CatalogSnapshot, ProjectCardRow } from "@contracts";
import { useProjectDetail } from "@features/projects/useProjectsData";
import { SelectField } from "@shared/components/SelectField";
import { SurfaceCard } from "@shared/components/SurfaceCard";

export type PackingSlipBuilderDraft = {
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
  selectedCount,
  users,
}: PackingSlipBuilderPanelProps) => {
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [projectUnitId, setProjectUnitId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [returnDueAt, setReturnDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const { data: projectDetail } = useProjectDetail(normalizeOptional(projectId) ?? null);

  useEffect(() => {
    setProjectUnitId((current) =>
      projectDetail.units.some((unit) => unit.id === current) ? current : "",
    );
  }, [projectDetail.units, projectId]);

  const selectedLabel = selectedCount === 1 ? "1 asset selected" : `${selectedCount} assets selected`;

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
      </div>

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
