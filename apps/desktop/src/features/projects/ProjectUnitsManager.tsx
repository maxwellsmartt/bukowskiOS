import { Check, Pencil, RotateCcw, Trash2, WrapText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CatalogSnapshot, ProjectDetailSnapshot } from "@contracts";
import { projectColorPalette } from "@contracts";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

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
  const [feedback, setFeedback] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingUnitAction, setPendingUnitAction] = useState<{
    unit: ProjectDetailSnapshot["units"][number];
    action: "mark_wrapped" | "delete";
  } | null>(null);

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
    setFeedback(null);
    setWarning(null);
  };

  const beginEdit = (unit: ProjectDetailSnapshot["units"][number]) => {
    setEditorMode("edit");
    setEditingUnitId(unit.id);
    setUnitDraft(toDraft(unit));
    setError(null);
    setFeedback(null);
    setWarning(null);
  };

  const resetEditor = () => {
    setEditorMode(null);
    setEditingUnitId(null);
    setUnitDraft(emptyUnitDraft);
    setError(null);
    setFeedback(null);
    setWarning(null);
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
      const nextFeedback = editorMode === "create" ? "Unit created." : "Unit updated.";
      resetEditor();
      setFeedback(nextFeedback);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "Unable to save project unit."));
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
      setFeedback(action === "delete" ? "Unit deleted." : "Unit updated.");
      setWarning(null);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "Unable to update unit."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAssignCrew = async (unitId: string) => {
    const draft = crewDrafts[unitId] ?? emptyCrewDraft;

    try {
      setIsSubmitting(true);
      const nextSnapshot = await assignCrewToProjectUnit({
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
      setFeedback("Crew linked to unit.");
      setWarning(nextSnapshot.units.find((unit) => unit.id === unitId)?.conflictSummary ?? null);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "Unable to assign crew member to unit."));
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
      setFeedback("Crew assignment removed.");
      setWarning(null);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "Unable to remove crew assignment."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
    <SurfaceCard
      title="Units"
      aside={
        <button className="action-primary-button" onClick={beginCreate} type="button">
          <Check size={14} />
          <span>New unit</span>
        </button>
      }
    >
      {feedback ? <div className="action-feedback action-feedback-success">{feedback}</div> : null}
      {warning ? <div className="action-feedback action-feedback-warning">{warning}</div> : null}
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
                  <span className="identity-meta">
                    {unit.crewAssignments.length} crew linked
                    {unit.statusSource === "manual_override" ? " · Manual status" : ""}
                    {unit.conflictCount ? ` · ${unit.conflictCount} conflicts` : ""}
                  </span>
                </div>

                <div className="shell-project-item-actions">
                  <button
                    aria-label={`Edit ${unit.name}`}
                    className="shell-project-action"
                    data-tooltip="Edit unit"
                    onClick={() => beginEdit(unit)}
                    type="button"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    aria-label={`Wrap ${unit.name}`}
                    className="shell-project-action"
                    data-tooltip="Mark wrapped"
                    onClick={() => setPendingUnitAction({ unit, action: "mark_wrapped" })}
                    type="button"
                  >
                    <WrapText size={12} />
                  </button>
                  <button
                    aria-label={unit.status === "cancelled" ? `Reactivate ${unit.name}` : `Cancel ${unit.name}`}
                    className="shell-project-action"
                    data-tooltip={unit.status === "cancelled" ? "Reactivate unit" : "Cancel unit"}
                    onClick={() => void runUnitAction(unit, unit.status === "cancelled" ? "reactivate" : "cancel")}
                    type="button"
                  >
                    <RotateCcw size={12} />
                  </button>
                  <button
                    aria-label={`Delete ${unit.name}`}
                    className="shell-project-action is-danger"
                    data-tooltip="Delete unit"
                    onClick={() => setPendingUnitAction({ unit, action: "delete" })}
                    type="button"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {unit.notes ? <p className="surface-card-subtitle">{unit.notes}</p> : null}

              {unit.conflictSummary ? <div className="action-feedback action-feedback-warning">{unit.conflictSummary}</div> : null}

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
              </div>

              <details className="detail-disclosure">
                <summary className="detail-disclosure-summary">More details</summary>
                <div className="detail-disclosure-content">
                  <div className="action-form-grid project-unit-crew-form">
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
                </div>
              </details>

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
          </div>

          <details className="detail-disclosure">
            <summary className="detail-disclosure-summary">More details</summary>
            <div className="detail-disclosure-content">
              <div className="action-form-grid">
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
                    <option value="">Use project color</option>
                    {projectColorPalette.map((color) => (
                      <option key={color.key} value={color.key}>
                        {color.label}
                      </option>
                    ))}
                  </SelectField>
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
            </div>
          </details>

          <div className="action-panel-actions">
            <button className="ghost-control cancel-control" onClick={resetEditor} type="button">
              Cancel
            </button>
            <button className="action-primary-button" disabled={isSubmitting} onClick={() => void handleSave()} type="button">
              {isSubmitting ? "Saving..." : editorMode === "create" ? "Create unit" : "Save unit"}
            </button>
          </div>
        </div>
      ) : null}
    </SurfaceCard>

    {pendingUnitAction ? (
      <ConfirmDialog
        isOpen
        tone={pendingUnitAction.action === "delete" ? "danger" : "default"}
        title={
          pendingUnitAction.action === "delete"
            ? `Delete unit "${pendingUnitAction.unit.name}"?`
            : `Mark "${pendingUnitAction.unit.name}" as wrapped?`
        }
        body={
          pendingUnitAction.action === "delete"
            ? "This only works if the unit has no linked operational records. Action cannot be undone."
            : "The unit's end date will be set to today."
        }
        confirmLabel={pendingUnitAction.action === "delete" ? "Delete unit" : "Mark wrapped"}
        cancelLabel="Cancel"
        isSubmitting={isSubmitting}
        onConfirm={async () => {
          const next = pendingUnitAction;
          setPendingUnitAction(null);
          await runUnitAction(next.unit, next.action);
        }}
        onCancel={() => setPendingUnitAction(null)}
      />
    ) : null}
    </>
  );
};
