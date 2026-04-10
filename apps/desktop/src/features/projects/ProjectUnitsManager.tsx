import { Check, Pencil, RotateCcw, Trash2, WrapText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CatalogSnapshot, ProjectDetailSnapshot } from "@contracts";
import { projectColorPalette } from "@contracts";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import {
  assignCrewToProjectUnit,
  createProjectUnit,
  deleteProjectUnit,
  unassignCrewFromProjectUnit,
  updateProjectUnit,
} from "./useProjectsData";

type ProjectUnitsManagerProps = {
  crewMembers: CatalogSnapshot["crewMembers"];
  focusedUnitId?: string | null;
  onChanged: () => Promise<void> | void;
  projectId: string;
  units: ProjectDetailSnapshot["units"];
};

type UnitDraft = {
  code: string;
  name: string;
  sortOrder: string;
  colorKey: string;
  startDate: string;
  endDate: string;
  notes: string;
};

type CrewAssignmentDraft = {
  crewMemberId: string;
  roleLabel: string;
  startDate: string;
  endDate: string;
  notes: string;
};

const emptyUnitDraft: UnitDraft = {
  code: "",
  name: "",
  sortOrder: "",
  colorKey: "",
  startDate: "",
  endDate: "",
  notes: "",
};

const emptyCrewDraft: CrewAssignmentDraft = {
  crewMemberId: "",
  roleLabel: "",
  startDate: "",
  endDate: "",
  notes: "",
};

const toDraft = (unit: ProjectDetailSnapshot["units"][number]): UnitDraft => ({
  code: unit.code,
  name: unit.name,
  sortOrder: String(unit.sortOrder),
  colorKey: unit.colorKey ?? "",
  startDate: unit.startDate ?? "",
  endDate: unit.endDate ?? "",
  notes: unit.notes,
});

const normalizeOptional = (value: string) => {
  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : undefined;
};

const statusToneMap = {
  active: "info",
  planned: "warning",
  wrapped: "success",
  cancelled: "critical",
} as const;

export const ProjectUnitsManager = ({ crewMembers, focusedUnitId = null, onChanged, projectId, units }: ProjectUnitsManagerProps) => {
  const unitListRef = useRef<HTMLDivElement | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [unitDraft, setUnitDraft] = useState<UnitDraft>(emptyUnitDraft);
  const [crewDrafts, setCrewDrafts] = useState<Record<string, CrewAssignmentDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const editingUnit = useMemo(
    () => units.find((unit) => unit.id === editingUnitId) ?? null,
    [editingUnitId, units],
  );

  useEffect(() => {
    if (!focusedUnitId || !unitListRef.current) {
      return;
    }

    const focusedUnit = unitListRef.current.querySelector<HTMLElement>(`[data-unit-id="${focusedUnitId}"]`);
    focusedUnit?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedUnitId]);

  const beginCreate = () => {
    setEditorMode("create");
    setEditingUnitId(null);
    setUnitDraft({
      ...emptyUnitDraft,
      sortOrder: String(units.length + 1),
    });
    setError(null);
  };

  const beginEdit = (unit: ProjectDetailSnapshot["units"][number]) => {
    setEditorMode("edit");
    setEditingUnitId(unit.id);
    setUnitDraft(toDraft(unit));
    setError(null);
  };

  const resetEditor = () => {
    setEditorMode(null);
    setEditingUnitId(null);
    setUnitDraft(emptyUnitDraft);
    setError(null);
  };

  const handleSave = async () => {
    try {
      setIsSubmitting(true);

      if (editorMode === "create") {
        await createProjectUnit({
          projectId,
          code: unitDraft.code,
          name: unitDraft.name,
          sortOrder: Number(unitDraft.sortOrder) || units.length + 1,
          colorKey: normalizeOptional(unitDraft.colorKey),
          startDate: normalizeOptional(unitDraft.startDate),
          endDate: normalizeOptional(unitDraft.endDate),
          notes: normalizeOptional(unitDraft.notes),
        });
      } else if (editorMode === "edit" && editingUnit) {
        await updateProjectUnit({
          projectId,
          unitId: editingUnit.id,
          code: unitDraft.code,
          name: unitDraft.name,
          sortOrder: Number(unitDraft.sortOrder) || editingUnit.sortOrder,
          colorKey: normalizeOptional(unitDraft.colorKey),
          startDate: normalizeOptional(unitDraft.startDate),
          endDate: normalizeOptional(unitDraft.endDate),
          notes: normalizeOptional(unitDraft.notes),
          statusAction: "none",
        });
      }

      await Promise.resolve(onChanged());
      resetEditor();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save project unit.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const runUnitAction = async (
    unit: ProjectDetailSnapshot["units"][number],
    action: "mark_wrapped" | "cancel" | "reactivate" | "delete",
  ) => {
    try {
      setIsSubmitting(true);

      if (action === "delete") {
        await deleteProjectUnit({ projectId, unitId: unit.id });
      } else {
        await updateProjectUnit({
          projectId,
          unitId: unit.id,
          code: unit.code,
          name: unit.name,
          sortOrder: unit.sortOrder,
          colorKey: unit.colorKey ?? undefined,
          startDate: unit.startDate ?? undefined,
          endDate: unit.endDate ?? undefined,
          notes: unit.notes || undefined,
          statusAction: action,
        });
      }

      await Promise.resolve(onChanged());

      if (editingUnitId === unit.id && action === "delete") {
        resetEditor();
      }

      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to update unit.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAssignCrew = async (unitId: string) => {
    const draft = crewDrafts[unitId] ?? emptyCrewDraft;

    try {
      setIsSubmitting(true);
      await assignCrewToProjectUnit({
        projectId,
        unitId,
        crewMemberId: draft.crewMemberId,
        roleLabel: normalizeOptional(draft.roleLabel),
        startDate: normalizeOptional(draft.startDate),
        endDate: normalizeOptional(draft.endDate),
        notes: normalizeOptional(draft.notes),
      });
      await Promise.resolve(onChanged());
      setCrewDrafts((current) => ({ ...current, [unitId]: emptyCrewDraft }));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to assign crew member to unit.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveCrew = async (unitId: string, assignmentId: string) => {
    try {
      setIsSubmitting(true);
      await unassignCrewFromProjectUnit({
        projectId,
        unitId,
        assignmentId,
      });
      await Promise.resolve(onChanged());
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to remove crew assignment.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SurfaceCard
      title="Units"
      subtitle="Parallel units let you model Main, Second or Splinter operations inside one project without losing scheduling clarity."
      aside={
        <button className="action-primary-button" onClick={beginCreate} type="button">
          <Check size={14} />
          <span>New unit</span>
        </button>
      }
    >
      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

      <div ref={unitListRef} className="project-unit-list">
        {units.map((unit) => {
          const crewDraft = crewDrafts[unit.id] ?? emptyCrewDraft;
          const statusTone = statusToneMap[unit.status as keyof typeof statusToneMap] ?? "neutral";

          return (
            <div
              key={unit.id}
              className={`project-unit-card${focusedUnitId === unit.id ? " project-unit-card-active" : ""}`}
              data-unit-id={unit.id}
            >
              <div className="project-unit-header">
                <div className="identity-cell">
                  <div className="project-unit-title-row">
                    <span className="shell-project-code-badge">{unit.code}</span>
                    <span className="identity-title">{unit.name}</span>
                    <StatusBadge tone={statusTone}>{unit.status}</StatusBadge>
                  </div>
                  <span className="identity-meta">
                    Order {unit.sortOrder} · {unit.startDate ?? "No start"} - {unit.endDate ?? "Open"}
                  </span>
                </div>

                <div className="shell-project-item-actions">
                  <button className="shell-project-action" onClick={() => beginEdit(unit)} type="button">
                    <Pencil size={12} />
                  </button>
                  <button
                    className="shell-project-action"
                    onClick={() => {
                      const confirmed = window.confirm("Mark this unit as wrapped and set its end date to today?");
                      if (confirmed) {
                        void runUnitAction(unit, "mark_wrapped");
                      }
                    }}
                    type="button"
                  >
                    <WrapText size={12} />
                  </button>
                  <button
                    className="shell-project-action"
                    onClick={() => void runUnitAction(unit, unit.status === "cancelled" ? "reactivate" : "cancel")}
                    type="button"
                  >
                    <RotateCcw size={12} />
                  </button>
                  <button
                    className="shell-project-action"
                    onClick={() => {
                      const confirmed = window.confirm(
                        `Delete unit "${unit.name}"? This only works if it has no linked operational records.`,
                      );

                      if (confirmed) {
                        void runUnitAction(unit, "delete");
                      }
                    }}
                    type="button"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {unit.notes ? <p className="surface-card-subtitle">{unit.notes}</p> : null}

              <div className="chip-row">
                <StatusBadge tone={unit.statusSource === "manual_override" ? "warning" : "neutral"}>
                  {unit.statusSource === "manual_override" ? "Manual override" : "Derived status"}
                </StatusBadge>
                <StatusBadge>{unit.crewAssignments.length} crew linked</StatusBadge>
              </div>

              {unit.crewAssignments.length ? (
                <div className="queue-list">
                  {unit.crewAssignments.map((assignment) => (
                    <div key={assignment.id} className="queue-item">
                      <div className="identity-cell">
                        <span className="identity-title">{assignment.fullName}</span>
                        <span className="identity-meta">
                          {assignment.roleLabel} · {assignment.startDate ?? "No start"} - {assignment.endDate ?? "Open"}
                        </span>
                      </div>

                      <button
                        className="shell-project-action"
                        onClick={() => void handleRemoveCrew(unit.id, assignment.id)}
                        type="button"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">No crew assigned to this unit yet.</div>
              )}

              <div className="action-form-grid project-unit-crew-form">
                <label className="action-field">
                  <span className="action-field-label">Crew</span>
                  <SelectField
                    onChange={(event) =>
                      setCrewDrafts((current) => ({
                        ...current,
                        [unit.id]: { ...crewDraft, crewMemberId: event.target.value },
                      }))
                    }
                    value={crewDraft.crewMemberId}
                  >
                    <option value="">Choose crew</option>
                    {crewMembers.map((crewMember) => (
                      <option key={crewMember.id} value={crewMember.id}>
                        {crewMember.fullName}
                      </option>
                    ))}
                  </SelectField>
                </label>

                <label className="action-field">
                  <span className="action-field-label">Role</span>
                  <input
                    className="action-field-control"
                    onChange={(event) =>
                      setCrewDrafts((current) => ({
                        ...current,
                        [unit.id]: { ...crewDraft, roleLabel: event.target.value },
                      }))
                    }
                    value={crewDraft.roleLabel}
                  />
                </label>

                <label className="action-field">
                  <span className="action-field-label">Start</span>
                  <input
                    className="action-field-control"
                    onChange={(event) =>
                      setCrewDrafts((current) => ({
                        ...current,
                        [unit.id]: { ...crewDraft, startDate: event.target.value },
                      }))
                    }
                    type="date"
                    value={crewDraft.startDate}
                  />
                </label>

                <label className="action-field">
                  <span className="action-field-label">End</span>
                  <input
                    className="action-field-control"
                    onChange={(event) =>
                      setCrewDrafts((current) => ({
                        ...current,
                        [unit.id]: { ...crewDraft, endDate: event.target.value },
                      }))
                    }
                    type="date"
                    value={crewDraft.endDate}
                  />
                </label>

                <label className="action-field action-field-wide">
                  <span className="action-field-label">Notes</span>
                  <input
                    className="action-field-control"
                    onChange={(event) =>
                      setCrewDrafts((current) => ({
                        ...current,
                        [unit.id]: { ...crewDraft, notes: event.target.value },
                      }))
                    }
                    value={crewDraft.notes}
                  />
                </label>
              </div>

              <div className="action-panel-actions action-panel-actions-start">
                <button
                  className="ghost-control"
                  disabled={!crewDraft.crewMemberId || isSubmitting}
                  onClick={() => void handleAssignCrew(unit.id)}
                  type="button"
                >
                  Link crew to unit
                </button>
              </div>
            </div>
          );
        })}

        {!units.length ? <div className="empty-state">No units defined yet. Create the first operational unit for this project.</div> : null}
      </div>

      {editorMode ? (
        <div className="project-unit-editor">
          <div className="surface-card-header">
            <div>
              <h3 className="surface-card-title">{editorMode === "create" ? "New unit" : "Edit unit"}</h3>
              <p className="surface-card-subtitle">
                Define order, schedule window and color so the timeline stays readable.
              </p>
            </div>
          </div>

          <div className="action-form-grid">
            <label className="action-field">
              <span className="action-field-label">Code</span>
              <input
                className="action-field-control"
                onChange={(event) => setUnitDraft((current) => ({ ...current, code: event.target.value.toUpperCase() }))}
                value={unitDraft.code}
              />
            </label>

            <label className="action-field">
              <span className="action-field-label">Name</span>
              <input
                className="action-field-control"
                onChange={(event) => setUnitDraft((current) => ({ ...current, name: event.target.value }))}
                value={unitDraft.name}
              />
            </label>

            <label className="action-field">
              <span className="action-field-label">Order</span>
              <input
                className="action-field-control"
                inputMode="numeric"
                onChange={(event) => setUnitDraft((current) => ({ ...current, sortOrder: event.target.value }))}
                value={unitDraft.sortOrder}
              />
            </label>

            <label className="action-field">
              <span className="action-field-label">Color</span>
              <SelectField
                onChange={(event) => setUnitDraft((current) => ({ ...current, colorKey: event.target.value }))}
                value={unitDraft.colorKey}
              >
                <option value="">Derive from project</option>
                {projectColorPalette.map((color) => (
                  <option key={color.key} value={color.key}>
                    {color.label}
                  </option>
                ))}
              </SelectField>
            </label>

            <label className="action-field">
              <span className="action-field-label">Start date</span>
              <input
                className="action-field-control"
                onChange={(event) => setUnitDraft((current) => ({ ...current, startDate: event.target.value }))}
                type="date"
                value={unitDraft.startDate}
              />
            </label>

            <label className="action-field">
              <span className="action-field-label">End date</span>
              <input
                className="action-field-control"
                onChange={(event) => setUnitDraft((current) => ({ ...current, endDate: event.target.value }))}
                type="date"
                value={unitDraft.endDate}
              />
            </label>

            <label className="action-field action-field-wide">
              <span className="action-field-label">Notes</span>
              <textarea
                className="action-field-control action-textarea"
                onChange={(event) => setUnitDraft((current) => ({ ...current, notes: event.target.value }))}
                rows={3}
                value={unitDraft.notes}
              />
            </label>
          </div>

          <div className="action-panel-actions">
            <button className="ghost-control" onClick={resetEditor} type="button">
              Cancel
            </button>
            <button className="action-primary-button" disabled={isSubmitting} onClick={() => void handleSave()} type="button">
              {isSubmitting ? "Saving..." : editorMode === "create" ? "Create unit" : "Save unit"}
            </button>
          </div>
        </div>
      ) : null}
    </SurfaceCard>
  );
};
