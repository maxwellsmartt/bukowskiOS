import { ArrowRightLeft, PackagePlus, X } from "lucide-react";
import { useState } from "react";

import type { CatalogSnapshot, ProjectCardRow } from "@contracts";
import { SelectField } from "@shared/components/SelectField";
import { SurfaceCard } from "@shared/components/SurfaceCard";

export type AssetAssignMoveFormValue = {
  mode: "assign" | "move";
  projectId?: string;
  departmentId?: string;
  assignedToUserId?: string;
  targetLocationId?: string;
  expectedReturnAt?: string;
  notes?: string;
};

type AssetAssignMovePanelProps = {
  defaultProjectId: string | null;
  departments: CatalogSnapshot["departments"];
  error: string | null;
  isSubmitting: boolean;
  locations: CatalogSnapshot["locations"];
  onClose: () => void;
  onSubmit: (value: AssetAssignMoveFormValue) => Promise<void>;
  projects: ProjectCardRow[];
  selectedCount: number;
  users: CatalogSnapshot["users"];
};

const normalizeOptional = (value: string) => {
  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : undefined;
};

export const AssetAssignMovePanel = ({
  defaultProjectId,
  departments,
  error,
  isSubmitting,
  locations,
  onClose,
  onSubmit,
  projects,
  selectedCount,
  users,
}: AssetAssignMovePanelProps) => {
  const [mode, setMode] = useState<"assign" | "move">("assign");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [departmentId, setDepartmentId] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [targetLocationId, setTargetLocationId] = useState("");
  const [expectedReturnAt, setExpectedReturnAt] = useState("");
  const [notes, setNotes] = useState("");

  const handleSubmit = async () => {
    await onSubmit({
      mode,
      projectId: mode === "assign" ? normalizeOptional(projectId) : undefined,
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
      title="Assign / move"
      subtitle="Run a real operational command against the selected assets. This writes timeline events and updates current state."
    >
      <div className="chip-row">
        <span className="action-panel-selection">{selectedLabel}</span>
      </div>

      <div className="action-mode-toggle" role="tablist" aria-label="Asset action mode">
        <button
          className={`action-mode-button${mode === "assign" ? " active" : ""}`}
          onClick={() => setMode("assign")}
          type="button"
        >
          <PackagePlus size={14} />
          <span>Assign</span>
        </button>
        <button
          className={`action-mode-button${mode === "move" ? " active" : ""}`}
          onClick={() => setMode("move")}
          type="button"
        >
          <ArrowRightLeft size={14} />
          <span>Move</span>
        </button>
      </div>

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
