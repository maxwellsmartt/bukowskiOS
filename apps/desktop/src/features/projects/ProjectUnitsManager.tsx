import { Check, Pencil, Plus, RotateCcw, Trash2, UsersRound, WrapText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CatalogSnapshot, ProjectColorKey, ProjectDetailSnapshot } from "@contracts";
import { useNotifications } from "@app/providers/NotificationsProvider";
import { useToast } from "@app/providers/ToastProvider";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { ModalShell } from "@shared/components/ModalShell";
import { ProjectColorSelect } from "@shared/components/ProjectColorSelect";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import {
  addDepartmentToProjectUnit,
  assignCrewToProjectUnit,
  createProjectUnit,
  deleteProjectUnit,
  removeDepartmentFromProjectUnit,
  unassignCrewFromProjectUnit,
  updateProjectUnit,
} from "./useProjectsData";

type ProjectUnitsManagerProps = {
  crewMembers: CatalogSnapshot["crewMembers"];
  departments: CatalogSnapshot["departments"];
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
  localId: string;
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

const createCrewDraft = (unit?: ProjectDetailSnapshot["units"][number]): CrewAssignmentDraft => ({
  localId: `crew-draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  crewMemberId: "",
  roleLabel: "",
  startDate: unit?.startDate ?? "",
  endDate: unit?.endDate ?? "",
  notes: "",
});

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

export const ProjectUnitsManager = ({ crewMembers, departments, focusedUnitId = null, onChanged, projectId, units }: ProjectUnitsManagerProps) => {
  const { t } = useTranslation();
  const unitListRef = useRef<HTMLDivElement | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [unitDraft, setUnitDraft] = useState<UnitDraft>(emptyUnitDraft);
  const [departmentDialogOpen, setDepartmentDialogOpen] = useState(false);
  const [departmentDraft, setDepartmentDraft] = useState({ unitId: "", departmentId: "" });
  const [crewDialogTarget, setCrewDialogTarget] = useState<{
    unit: ProjectDetailSnapshot["units"][number];
    department: ProjectDetailSnapshot["units"][number]["unitDepartments"][number];
  } | null>(null);
  const [crewAssignmentDrafts, setCrewAssignmentDrafts] = useState<CrewAssignmentDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const toast = useToast();
  const { createNotification } = useNotifications();
  const [pendingUnitAction, setPendingUnitAction] = useState<{
    unit: ProjectDetailSnapshot["units"][number];
    action: "mark_wrapped" | "delete";
  } | null>(null);
  const [pendingDepartmentAction, setPendingDepartmentAction] = useState<{
    unit: ProjectDetailSnapshot["units"][number];
    department: ProjectDetailSnapshot["units"][number]["unitDepartments"][number];
  } | null>(null);

  const editingUnit = useMemo(
    () => units.find((unit) => unit.id === editingUnitId) ?? null,
    [editingUnitId, units],
  );

  const selectedDepartmentUnit = useMemo(
    () => units.find((unit) => unit.id === departmentDraft.unitId) ?? units[0] ?? null,
    [departmentDraft.unitId, units],
  );

  const availableDepartmentsForSelectedUnit = useMemo(() => {
    if (!selectedDepartmentUnit) {
      return [];
    }

    const linkedDepartmentIds = new Set(
      selectedDepartmentUnit.unitDepartments
        .map((department) => department.departmentId)
        .filter((departmentId): departmentId is string => Boolean(departmentId)),
    );

    return departments
      .filter((department) => !linkedDepartmentIds.has(department.id))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [departments, selectedDepartmentUnit]);

  const openDepartmentDialog = () => {
    const fallbackUnit = units[0] ?? null;
    const linkedDepartmentIds = new Set(
      fallbackUnit?.unitDepartments
        .map((department) => department.departmentId)
        .filter((departmentId): departmentId is string => Boolean(departmentId)) ?? [],
    );
    const fallbackDepartment = departments.find((department) => !linkedDepartmentIds.has(department.id)) ?? null;

    setDepartmentDraft({
      unitId: fallbackUnit?.id ?? "",
      departmentId: fallbackDepartment?.id ?? "",
    });
    setError(null);
    setDepartmentDialogOpen(true);
  };

  const openCrewDialog = (
    unit: ProjectDetailSnapshot["units"][number],
    department: ProjectDetailSnapshot["units"][number]["unitDepartments"][number],
  ) => {
    setCrewDialogTarget({ unit, department });
    setCrewAssignmentDrafts([createCrewDraft(unit)]);
    setError(null);
  };

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

    setWarning(null);
  };

  const beginEdit = (unit: ProjectDetailSnapshot["units"][number]) => {
    setEditorMode("edit");
    setEditingUnitId(unit.id);
    setUnitDraft(toDraft(unit));
    setError(null);

    setWarning(null);
  };

  const resetEditor = () => {
    setEditorMode(null);
    setEditingUnitId(null);
    setUnitDraft(emptyUnitDraft);
    setError(null);

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
      const nextFeedback = editorMode === "create" ? t("projects.units.toasts.createdBody") : t("projects.units.toasts.updatedBody");
      const notificationAction = editorMode === "create" ? "created" : "updated";
      await createNotification({
        kind: "project",
        title:
          editorMode === "create"
            ? t("projects.units.notifications.createdTitle", { defaultValue: "Unidad creada" })
            : t("projects.units.notifications.updatedTitle", { defaultValue: "Unidad actualizada" }),
        body: t("projects.units.notifications.changedBody", {
          defaultValue: "{{name}} cambió dentro del proyecto.",
          name: unitDraft.name,
        }),
        linkTo: `/projects/${projectId}/info`,
        sourceType: "project_unit",
        sourceRef: { projectId, unitId: editingUnit?.id ?? null, action: notificationAction },
        notifyNow: true,
      });
      resetEditor();
      toast.success(t("projects.units.toasts.done"), nextFeedback);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("projects.units.toasts.saveFailed")));
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
      toast.success(
        action === "delete" ? t("projects.units.toasts.deletedTitle") : t("projects.units.toasts.updatedTitle"),
        action === "delete" ? t("projects.units.toasts.deletedBody") : t("projects.units.toasts.updatedLiveBody"),
      );
      setWarning(null);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("projects.units.toasts.updateFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  const getCrewOptionsForDepartment = (departmentId: string) =>
    [...crewMembers].sort((left, right) => {
      const leftMatches = left.primaryDepartmentId === departmentId ? 0 : 1;
      const rightMatches = right.primaryDepartmentId === departmentId ? 0 : 1;
      if (leftMatches !== rightMatches) {
        return leftMatches - rightMatches;
      }

      return left.fullName.localeCompare(right.fullName);
    });

  const handleAddDepartment = async () => {
    try {
      setIsSubmitting(true);
      await addDepartmentToProjectUnit({
        projectId,
        unitId: departmentDraft.unitId,
        departmentId: departmentDraft.departmentId,
      });
      await Promise.resolve(onChanged());
      setDepartmentDialogOpen(false);
      setDepartmentDraft({ unitId: "", departmentId: "" });
      setError(null);
      toast.success(t("projects.units.toasts.departmentAddedTitle"), t("projects.units.toasts.departmentAddedBody"));
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("projects.units.toasts.departmentAddFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveDepartment = async (
    unit: ProjectDetailSnapshot["units"][number],
    department: ProjectDetailSnapshot["units"][number]["unitDepartments"][number],
  ) => {
    if (!department.departmentId) {
      return;
    }

    try {
      setIsSubmitting(true);
      await removeDepartmentFromProjectUnit({
        projectId,
        unitId: unit.id,
        departmentId: department.departmentId,
      });
      await Promise.resolve(onChanged());
      setError(null);
      toast.success(t("projects.units.toasts.departmentRemovedTitle"), t("projects.units.toasts.departmentRemovedBody"));
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("projects.units.toasts.departmentRemoveFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAssignCrewBatch = async () => {
    if (!crewDialogTarget?.department.departmentId) {
      return;
    }

    const draftsToSave = crewAssignmentDrafts.filter((draft) => draft.crewMemberId.trim());

    try {
      setIsSubmitting(true);

      let nextConflictSummary: string | null = null;
      for (const draft of draftsToSave) {
        const nextSnapshot = await assignCrewToProjectUnit({
          projectId,
          unitId: crewDialogTarget.unit.id,
          departmentId: crewDialogTarget.department.departmentId,
          crewMemberId: draft.crewMemberId,
          roleLabel: normalizeOptional(draft.roleLabel),
          startDate: normalizeOptional(draft.startDate),
          endDate: normalizeOptional(draft.endDate),
          notes: normalizeOptional(draft.notes),
        });
        nextConflictSummary = nextSnapshot.units.find((unit) => unit.id === crewDialogTarget.unit.id)?.conflictSummary ?? null;
      }

      await Promise.resolve(onChanged());
      setCrewDialogTarget(null);
      setCrewAssignmentDrafts([]);
      setError(null);
      toast.success(t("projects.units.toasts.crewLinkedTitle"), t("projects.units.toasts.crewLinkedBody"));
      setWarning(nextConflictSummary);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("projects.units.toasts.assignCrewFailed")));
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
      toast.success(t("projects.units.toasts.crewRemovedTitle"), t("projects.units.toasts.crewRemovedBody"));
      setWarning(null);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("projects.units.toasts.removeCrewFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  const addCrewAssignmentRow = () => {
    setCrewAssignmentDrafts((current) => [...current, createCrewDraft(crewDialogTarget?.unit)]);
  };

  const updateCrewAssignmentDraft = (localId: string, patch: Partial<CrewAssignmentDraft>) => {
    setCrewAssignmentDrafts((current) =>
      current.map((draft) => (draft.localId === localId ? { ...draft, ...patch } : draft)),
    );
  };

  const removeCrewAssignmentDraft = (localId: string) => {
    setCrewAssignmentDrafts((current) => (current.length > 1 ? current.filter((draft) => draft.localId !== localId) : current));
  };

  const selectCrewForDraft = (draft: CrewAssignmentDraft, crewMemberId: string) => {
    const nextCrewMember = crewMembers.find((crewMember) => crewMember.id === crewMemberId);
    updateCrewAssignmentDraft(draft.localId, {
      crewMemberId,
      roleLabel: draft.roleLabel || nextCrewMember?.roleLabel || "",
      startDate: draft.startDate || crewDialogTarget?.unit.startDate || "",
      endDate: draft.endDate || crewDialogTarget?.unit.endDate || "",
    });
  };

  const canAddDepartment = Boolean(departmentDraft.unitId && departmentDraft.departmentId);
  const canAssignCrewBatch = crewAssignmentDrafts.some((draft) => draft.crewMemberId.trim());

  return (
    <>
    <SurfaceCard
      title={t("projects.units.title")}
      aside={
        <div className="surface-card-action-row">
          <button className="action-primary-button project-unit-secondary-action" disabled={!units.length || !departments.length} onClick={openDepartmentDialog} type="button">
            <Plus size={14} />
            <span>{t("projects.units.addDepartment")}</span>
          </button>
          <button className="action-primary-button" onClick={beginCreate} type="button">
            <Check size={14} />
            <span>{t("projects.units.newUnit")}</span>
          </button>
        </div>
      }
    >
      {warning ? <div className="action-feedback action-feedback-warning">{warning}</div> : null}
      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

      <div ref={unitListRef} className="project-unit-list">
        {units.map((unit) => {
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
                    <StatusBadge tone={statusTone}>{t(`projects.unitStatuses.${unit.status}`, { defaultValue: unit.status })}</StatusBadge>
                  </div>
                  <span className="identity-meta">
                    {t("projects.units.order", { order: unit.sortOrder })} · {unit.startDate ?? t("projects.fallbacks.noStart")} - {unit.endDate ?? t("projects.fallbacks.open")}
                  </span>
                  <span className="identity-meta">
                    {t("projects.units.crewLinked", { count: unit.crewAssignments.length })}
                    {unit.statusSource === "manual_override" ? ` · ${t("projects.units.manualStatus")}` : ""}
                    {unit.conflictCount ? ` · ${t("projects.units.conflicts", { count: unit.conflictCount })}` : ""}
                  </span>
                </div>

                <div className="shell-project-item-actions">
                  <button
                    aria-label={t("projects.units.actions.editAria", { name: unit.name })}
                    className="shell-project-action"
                    data-tooltip={t("projects.units.actions.edit")}
                    onClick={() => beginEdit(unit)}
                    type="button"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    aria-label={t("projects.units.actions.wrapAria", { name: unit.name })}
                    className="shell-project-action"
                    data-tooltip={t("projects.units.actions.markWrapped")}
                    onClick={() => setPendingUnitAction({ unit, action: "mark_wrapped" })}
                    type="button"
                  >
                    <WrapText size={12} />
                  </button>
                  <button
                    aria-label={
                      unit.status === "cancelled"
                        ? t("projects.units.actions.reactivateAria", { name: unit.name })
                        : t("projects.units.actions.cancelAria", { name: unit.name })
                    }
                    className="shell-project-action"
                    data-tooltip={unit.status === "cancelled" ? t("projects.units.actions.reactivate") : t("projects.units.actions.cancel")}
                    onClick={() => void runUnitAction(unit, unit.status === "cancelled" ? "reactivate" : "cancel")}
                    type="button"
                  >
                    <RotateCcw size={12} />
                  </button>
                  {!unit.isPrimary ? (
                    <button
                      aria-label={t("projects.units.actions.deleteAria", { name: unit.name })}
                      className="shell-project-action is-danger"
                      data-tooltip={t("projects.units.actions.delete")}
                      onClick={() => setPendingUnitAction({ unit, action: "delete" })}
                      type="button"
                    >
                      <Trash2 size={12} />
                    </button>
                  ) : null}
                </div>
              </div>

              {unit.notes ? <p className="surface-card-subtitle">{unit.notes}</p> : null}

              {unit.conflictSummary ? <div className="action-feedback action-feedback-warning">{unit.conflictSummary}</div> : null}

              {unit.unitDepartments.length ? (
                <div className="project-unit-department-grid">
                  {unit.unitDepartments.map((department) => {
                    return (
                      <div
                        key={department.departmentId ?? "unclassified"}
                        className={`project-unit-department-card${department.departmentId ? "" : " is-legacy"}`}
                      >
                        <div className="project-unit-department-header">
                          <div className="identity-cell">
                            <span className="identity-title">
                              {department.departmentId ? department.departmentName : t("projects.units.unclassifiedDepartment")}
                            </span>
                            <span className="identity-meta">
                              <UsersRound size={12} />
                              {t("projects.units.departmentCrewCount", { count: department.crewAssignments.length })}
                            </span>
                          </div>
                          {department.departmentId ? (
                            <div className="project-unit-department-actions">
                              <button
                                className="ghost-control project-unit-add-crew-button"
                                onClick={() => openCrewDialog(unit, department)}
                                type="button"
                              >
                                <Plus size={13} />
                                <span>{t("projects.units.linkCrew")}</span>
                              </button>
                              <button
                                aria-label={t("projects.units.actions.removeDepartmentAria", {
                                  department: department.departmentName,
                                  unit: unit.name,
                                })}
                                className="shell-project-action is-danger project-unit-visible-action"
                                data-tooltip={t("projects.units.actions.removeDepartment")}
                                onClick={() => setPendingDepartmentAction({ unit, department })}
                                type="button"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ) : (
                            <StatusBadge tone="warning">{t("projects.units.legacyBadge")}</StatusBadge>
                          )}
                        </div>

                        {department.crewAssignments.length ? (
                          <div className="queue-list project-unit-crew-list">
                            {department.crewAssignments.map((assignment) => (
                              <div key={assignment.id} className="queue-item project-unit-crew-row">
                                <div className="identity-cell">
                                  <span className="identity-title">{assignment.fullName}</span>
                                  <span className="identity-meta">
                                    {assignment.roleLabel} · {assignment.startDate ?? t("projects.fallbacks.noStart")} - {assignment.endDate ?? t("projects.fallbacks.open")}
                                  </span>
                                </div>

                                <button
                                  aria-label={t("projects.units.actions.removeCrewAria", { name: assignment.fullName })}
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
                          <div className="empty-state project-unit-department-empty">
                            {department.departmentId ? t("projects.units.noCrewInDepartment") : t("projects.units.unclassifiedHelp")}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <button className="empty-state project-unit-empty-action" onClick={openDepartmentDialog} type="button">
                  <Plus size={16} />
                  <span>{t("projects.units.noDepartments")}</span>
                </button>
              )}
            </div>
          );
        })}

        {!units.length ? <div className="empty-state">{t("projects.units.empty")}</div> : null}
      </div>

      {editorMode ? (
        <div className="project-unit-editor">
          <div className="surface-card-header">
            <div>
              <h3 className="surface-card-title">{editorMode === "create" ? t("projects.units.editor.newTitle") : t("projects.units.editor.editTitle")}</h3>
            </div>
          </div>

          <div className="action-form-grid">
            <label className="action-field">
              <span className="action-field-label">{t("projects.units.fields.code")}</span>
              <input
                className="action-field-control"
                onChange={(event) => setUnitDraft((current) => ({ ...current, code: event.target.value.toUpperCase() }))}
                value={unitDraft.code}
              />
            </label>

            <label className="action-field">
              <span className="action-field-label">{t("projects.units.fields.name")}</span>
              <input
                className="action-field-control"
                onChange={(event) => setUnitDraft((current) => ({ ...current, name: event.target.value }))}
                value={unitDraft.name}
              />
            </label>

            <label className="action-field">
              <span className="action-field-label">{t("projects.units.fields.startDate")}</span>
              <input
                className="action-field-control"
                onChange={(event) => setUnitDraft((current) => ({ ...current, startDate: event.target.value }))}
                type="date"
                value={unitDraft.startDate}
              />
            </label>

            <label className="action-field">
              <span className="action-field-label">{t("projects.units.fields.endDate")}</span>
              <input
                className="action-field-control"
                onChange={(event) => setUnitDraft((current) => ({ ...current, endDate: event.target.value }))}
                type="date"
                value={unitDraft.endDate}
              />
            </label>
          </div>

          <details className="detail-disclosure">
            <summary className="detail-disclosure-summary">{t("projects.units.moreDetails")}</summary>
            <div className="detail-disclosure-content">
              <div className="action-form-grid">
                <label className="action-field">
                  <span className="action-field-label">{t("projects.units.fields.order")}</span>
                  <input
                    className="action-field-control"
                    inputMode="numeric"
                    onChange={(event) => setUnitDraft((current) => ({ ...current, sortOrder: event.target.value }))}
                    value={unitDraft.sortOrder}
                  />
                </label>

                <label className="action-field">
                  <span className="action-field-label">{t("projects.units.fields.color")}</span>
                  <ProjectColorSelect
                    onChange={(nextColorKey) => setUnitDraft((current) => ({ ...current, colorKey: nextColorKey }))}
                    placeholder={t("projects.units.fields.useProjectColor")}
                    value={unitDraft.colorKey as ProjectColorKey | ""}
                  />
                </label>

                <label className="action-field action-field-wide">
                  <span className="action-field-label">{t("projects.units.fields.notes")}</span>
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
              {t("common.cancel")}
            </button>
            <button className="action-primary-button" disabled={isSubmitting} onClick={() => void handleSave()} type="button">
              {isSubmitting ? t("common.saving") : editorMode === "create" ? t("projects.units.editor.create") : t("projects.units.editor.save")}
            </button>
          </div>
        </div>
      ) : null}
    </SurfaceCard>

    {departmentDialogOpen ? (
      <ModalShell className="project-unit-modal-shell" onClose={() => setDepartmentDialogOpen(false)} width={680}>
        <div className="project-unit-modal">
          <div className="project-unit-modal-header">
            <div>
              <h3>{t("projects.units.departmentDialog.title")}</h3>
              <p>{t("projects.units.departmentDialog.body")}</p>
            </div>
            <button className="icon-ghost-control" onClick={() => setDepartmentDialogOpen(false)} type="button">
              <X size={16} />
            </button>
          </div>

          <div className="project-unit-modal-body">
            {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}
            <div className="action-form-grid">
              <label className="action-field">
                <span className="action-field-label">{t("projects.units.fields.unit")}</span>
                <SelectField
                  onChange={(event) => {
                    const nextUnit = units.find((unit) => unit.id === event.target.value) ?? null;
                    const linkedDepartmentIds = new Set(
                      nextUnit?.unitDepartments
                        .map((department) => department.departmentId)
                        .filter((departmentId): departmentId is string => Boolean(departmentId)) ?? [],
                    );
                    const nextDepartment = departments.find((department) => !linkedDepartmentIds.has(department.id)) ?? null;
                    setDepartmentDraft({
                      unitId: event.target.value,
                      departmentId: nextDepartment?.id ?? "",
                    });
                  }}
                  value={departmentDraft.unitId}
                >
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </SelectField>
              </label>

              <label className="action-field">
                <span className="action-field-label">{t("projects.units.fields.department")}</span>
                <SelectField
                  onChange={(event) => setDepartmentDraft((current) => ({ ...current, departmentId: event.target.value }))}
                  value={departmentDraft.departmentId}
                >
                  {availableDepartmentsForSelectedUnit.length ? (
                    availableDepartmentsForSelectedUnit.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))
                  ) : (
                    <option value="">{t("projects.units.departmentDialog.noDepartments")}</option>
                  )}
                </SelectField>
              </label>
            </div>
          </div>

          <div className="project-unit-modal-actions">
            <button className="action-danger-button project-unit-modal-cancel" onClick={() => setDepartmentDialogOpen(false)} type="button">
              {t("common.cancel")}
            </button>
            <button className="action-primary-button" disabled={!canAddDepartment || isSubmitting} onClick={() => void handleAddDepartment()} type="button">
              <Plus size={14} />
              <span>{t("projects.units.departmentDialog.confirm")}</span>
            </button>
          </div>
        </div>
      </ModalShell>
    ) : null}

    {crewDialogTarget ? (
      <ModalShell className="project-unit-modal-shell" onClose={() => setCrewDialogTarget(null)} width={1040}>
        <div className="project-unit-modal">
          <div className="project-unit-modal-header">
            <div>
              <h3>{t("projects.units.crewDialog.title", { department: crewDialogTarget.department.departmentName })}</h3>
              <p>{t("projects.units.crewDialog.body", { unit: crewDialogTarget.unit.name })}</p>
            </div>
            <button className="icon-ghost-control" onClick={() => setCrewDialogTarget(null)} type="button">
              <X size={16} />
            </button>
          </div>

          <div className="project-unit-modal-body">
            {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}
            <div className="project-unit-crew-batch-list">
              {crewAssignmentDrafts.map((draft, index) => {
                const selectedCrewIds = new Set(
                  crewAssignmentDrafts
                    .filter((row) => row.localId !== draft.localId)
                    .map((row) => row.crewMemberId)
                    .filter(Boolean),
                );
                const assignedCrewIds = new Set(crewDialogTarget.unit.crewAssignments.map((assignment) => assignment.crewMemberId));
                const crewOptions = crewDialogTarget.department.departmentId
                  ? getCrewOptionsForDepartment(crewDialogTarget.department.departmentId).filter(
                      (crewMember) => crewMember.id === draft.crewMemberId || (!assignedCrewIds.has(crewMember.id) && !selectedCrewIds.has(crewMember.id)),
                    )
                  : [];

                return (
                  <div key={draft.localId} className="project-unit-crew-batch-row">
                    <div className="project-unit-crew-batch-row-header">
                      <span>{t("projects.units.crewDialog.rowLabel", { number: index + 1 })}</span>
                      <button
                        aria-label={t("projects.units.crewDialog.removeRow")}
                        className="icon-ghost-control"
                        disabled={crewAssignmentDrafts.length === 1}
                        onClick={() => removeCrewAssignmentDraft(draft.localId)}
                        type="button"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="action-form-grid project-unit-crew-batch-grid">
                      <label className="action-field">
                        <span className="action-field-label">{t("projects.units.fields.crew")}</span>
                        <SelectField onChange={(event) => selectCrewForDraft(draft, event.target.value)} value={draft.crewMemberId}>
                          <option value="">{t("projects.units.fields.chooseCrew")}</option>
                          {crewOptions.map((crewMember) => (
                            <option key={crewMember.id} value={crewMember.id}>
                              {crewMember.fullName}
                              {crewMember.primaryDepartmentId === crewDialogTarget.department.departmentId
                                ? ` · ${crewMember.roleLabel || t("projects.units.fields.defaultRole")}`
                                : ` · ${crewMember.primaryDepartment ?? t("projects.units.otherDepartment")}`}
                            </option>
                          ))}
                        </SelectField>
                      </label>

                      <label className="action-field">
                        <span className="action-field-label">{t("projects.units.fields.role")}</span>
                        <input
                          className="action-field-control"
                          onChange={(event) => updateCrewAssignmentDraft(draft.localId, { roleLabel: event.target.value })}
                          value={draft.roleLabel}
                        />
                      </label>

                      <label className="action-field">
                        <span className="action-field-label">{t("projects.units.fields.start")}</span>
                        <input
                          className="action-field-control"
                          onChange={(event) => updateCrewAssignmentDraft(draft.localId, { startDate: event.target.value })}
                          type="date"
                          value={draft.startDate}
                        />
                      </label>

                      <label className="action-field">
                        <span className="action-field-label">{t("projects.units.fields.end")}</span>
                        <input
                          className="action-field-control"
                          onChange={(event) => updateCrewAssignmentDraft(draft.localId, { endDate: event.target.value })}
                          type="date"
                          value={draft.endDate}
                        />
                      </label>

                      <label className="action-field action-field-wide">
                        <span className="action-field-label">{t("projects.units.fields.notes")}</span>
                        <input
                          className="action-field-control"
                          onChange={(event) => updateCrewAssignmentDraft(draft.localId, { notes: event.target.value })}
                          value={draft.notes}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <button className="ghost-control project-unit-crew-add-row" onClick={addCrewAssignmentRow} type="button">
              <Plus size={14} />
              <span>{t("projects.units.crewDialog.addRow")}</span>
            </button>
          </div>

          <div className="project-unit-modal-actions">
            <button className="action-danger-button project-unit-modal-cancel" onClick={() => setCrewDialogTarget(null)} type="button">
              {t("common.cancel")}
            </button>
            <button className="action-primary-button" disabled={!canAssignCrewBatch || isSubmitting} onClick={() => void handleAssignCrewBatch()} type="button">
              <Check size={14} />
              <span>{t("projects.units.crewDialog.confirm")}</span>
            </button>
          </div>
        </div>
      </ModalShell>
    ) : null}

    {pendingUnitAction ? (
      <ConfirmDialog
        isOpen
        tone={pendingUnitAction.action === "delete" ? "danger" : "default"}
        title={
          pendingUnitAction.action === "delete"
            ? t("projects.units.confirm.deleteTitle", { name: pendingUnitAction.unit.name })
            : t("projects.units.confirm.wrapTitle", { name: pendingUnitAction.unit.name })
        }
        body={
          pendingUnitAction.action === "delete"
            ? t("projects.units.confirm.deleteBody")
            : t("projects.units.confirm.wrapBody")
        }
        confirmLabel={pendingUnitAction.action === "delete" ? t("projects.units.confirm.deleteConfirm") : t("projects.units.confirm.wrapConfirm")}
        cancelLabel={t("common.cancel")}
        isSubmitting={isSubmitting}
        onConfirm={async () => {
          const next = pendingUnitAction;
          setPendingUnitAction(null);
          await runUnitAction(next.unit, next.action);
        }}
        onCancel={() => setPendingUnitAction(null)}
      />
    ) : null}

    {pendingDepartmentAction ? (
      <ConfirmDialog
        isOpen
        tone="danger"
        title={t("projects.units.confirm.removeDepartmentTitle", {
          department: pendingDepartmentAction.department.departmentName,
          unit: pendingDepartmentAction.unit.name,
        })}
        body={t("projects.units.confirm.removeDepartmentBody")}
        confirmLabel={t("projects.units.confirm.removeDepartmentConfirm")}
        cancelLabel={t("common.cancel")}
        isSubmitting={isSubmitting}
        onConfirm={async () => {
          const next = pendingDepartmentAction;
          setPendingDepartmentAction(null);
          await handleRemoveDepartment(next.unit, next.department);
        }}
        onCancel={() => setPendingDepartmentAction(null)}
      />
    ) : null}
    </>
  );
};
