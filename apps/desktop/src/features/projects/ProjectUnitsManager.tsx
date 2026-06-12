import { Check, Pencil, RotateCcw, Trash2, WrapText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CatalogSnapshot, ProjectColorKey, ProjectDetailSnapshot } from "@contracts";
import { useNotifications } from "@app/providers/NotificationsProvider";
import { useToast } from "@app/providers/ToastProvider";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { ProjectColorSelect } from "@shared/components/ProjectColorSelect";
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

const getCrewDraftKey = (unitId: string, departmentId: string) => `${unitId}:${departmentId}`;

export const ProjectUnitsManager = ({ crewMembers, focusedUnitId = null, onChanged, projectId, units }: ProjectUnitsManagerProps) => {
  const { t } = useTranslation();
  const unitListRef = useRef<HTMLDivElement | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [unitDraft, setUnitDraft] = useState<UnitDraft>(emptyUnitDraft);
  const [crewDrafts, setCrewDrafts] = useState<Record<string, CrewAssignmentDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const toast = useToast();
  const { createNotification } = useNotifications();
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

  const handleAssignCrew = async (unitId: string, departmentId: string) => {
    const draftKey = getCrewDraftKey(unitId, departmentId);
    const draft = crewDrafts[draftKey] ?? emptyCrewDraft;

    try {
      setIsSubmitting(true);
      const nextSnapshot = await assignCrewToProjectUnit({
        projectId,
        unitId,
        departmentId,
        crewMemberId: draft.crewMemberId,
        roleLabel: normalizeOptional(draft.roleLabel),
        startDate: normalizeOptional(draft.startDate),
        endDate: normalizeOptional(draft.endDate),
        notes: normalizeOptional(draft.notes),
      });
      await Promise.resolve(onChanged());
      setCrewDrafts((current) => ({ ...current, [draftKey]: emptyCrewDraft }));
      setError(null);
      toast.success(t("projects.units.toasts.crewLinkedTitle"), t("projects.units.toasts.crewLinkedBody"));
      setWarning(nextSnapshot.units.find((unit) => unit.id === unitId)?.conflictSummary ?? null);
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

  return (
    <>
    <SurfaceCard
      title={t("projects.units.title")}
      aside={
        <button className="action-primary-button" onClick={beginCreate} type="button">
          <Check size={14} />
          <span>{t("projects.units.newUnit")}</span>
        </button>
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
                  <button
                    aria-label={t("projects.units.actions.deleteAria", { name: unit.name })}
                    className="shell-project-action is-danger"
                    data-tooltip={t("projects.units.actions.delete")}
                    onClick={() => setPendingUnitAction({ unit, action: "delete" })}
                    type="button"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {unit.notes ? <p className="surface-card-subtitle">{unit.notes}</p> : null}

              {unit.conflictSummary ? <div className="action-feedback action-feedback-warning">{unit.conflictSummary}</div> : null}

              {unit.unitDepartments.length ? (
                <div className="project-unit-department-grid">
                  {unit.unitDepartments.map((department) => {
                    const departmentId = department.departmentId ?? "";
                    const draftKey = getCrewDraftKey(unit.id, departmentId);
                    const crewDraft = crewDrafts[draftKey] ?? emptyCrewDraft;
                    const crewOptions = department.departmentId ? getCrewOptionsForDepartment(department.departmentId) : [];
                    const canAssign = Boolean(department.departmentId && crewDraft.crewMemberId);

                    return (
                      <div key={department.departmentId ?? "unclassified"} className={`project-unit-department-card${department.departmentId ? "" : " is-legacy"}`}>
                        <div className="project-unit-department-header">
                          <div className="identity-cell">
                            <span className="identity-title">
                              {department.departmentId ? department.departmentName : t("projects.units.unclassifiedDepartment")}
                            </span>
                            <span className="identity-meta">
                              {t("projects.units.departmentCrewCount", { count: department.crewAssignments.length })}
                            </span>
                          </div>
                          {!department.departmentId ? <StatusBadge tone="warning">{t("projects.units.legacyBadge")}</StatusBadge> : null}
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

                        {department.departmentId ? (
                          <div className="project-unit-crew-form">
                            <div className="action-form-grid">
                              <label className="action-field">
                                <span className="action-field-label">{t("projects.units.fields.crew")}</span>
                                <SelectField
                                  onChange={(event) => {
                                    const nextCrewMember = crewMembers.find((crewMember) => crewMember.id === event.target.value);
                                    setCrewDrafts((current) => ({
                                      ...current,
                                      [draftKey]: {
                                        ...crewDraft,
                                        crewMemberId: event.target.value,
                                        roleLabel: crewDraft.roleLabel || nextCrewMember?.roleLabel || "",
                                        startDate: crewDraft.startDate || unit.startDate || "",
                                        endDate: crewDraft.endDate || unit.endDate || "",
                                      },
                                    }));
                                  }}
                                  value={crewDraft.crewMemberId}
                                >
                                  <option value="">{t("projects.units.fields.chooseCrew")}</option>
                                  {crewOptions.map((crewMember) => (
                                    <option key={crewMember.id} value={crewMember.id}>
                                      {crewMember.fullName}
                                      {crewMember.primaryDepartmentId === department.departmentId
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
                                  onChange={(event) =>
                                    setCrewDrafts((current) => ({
                                      ...current,
                                      [draftKey]: { ...crewDraft, roleLabel: event.target.value },
                                    }))
                                  }
                                  value={crewDraft.roleLabel}
                                />
                              </label>

                              <label className="action-field">
                                <span className="action-field-label">{t("projects.units.fields.start")}</span>
                                <input
                                  className="action-field-control"
                                  onChange={(event) =>
                                    setCrewDrafts((current) => ({
                                      ...current,
                                      [draftKey]: { ...crewDraft, startDate: event.target.value },
                                    }))
                                  }
                                  type="date"
                                  value={crewDraft.startDate}
                                />
                              </label>

                              <label className="action-field">
                                <span className="action-field-label">{t("projects.units.fields.end")}</span>
                                <input
                                  className="action-field-control"
                                  onChange={(event) =>
                                    setCrewDrafts((current) => ({
                                      ...current,
                                      [draftKey]: { ...crewDraft, endDate: event.target.value },
                                    }))
                                  }
                                  type="date"
                                  value={crewDraft.endDate}
                                />
                              </label>

                              <label className="action-field action-field-wide">
                                <span className="action-field-label">{t("projects.units.fields.notes")}</span>
                                <input
                                  className="action-field-control"
                                  onChange={(event) =>
                                    setCrewDrafts((current) => ({
                                      ...current,
                                      [draftKey]: { ...crewDraft, notes: event.target.value },
                                    }))
                                  }
                                  value={crewDraft.notes}
                                />
                              </label>
                            </div>

                            <div className="action-panel-actions action-panel-actions-start">
                              <button
                                className="ghost-control"
                                disabled={!canAssign || isSubmitting}
                                onClick={() => void handleAssignCrew(unit.id, department.departmentId!)}
                                type="button"
                              >
                                {t("projects.units.linkCrew")}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">{t("projects.units.noDepartments")}</div>
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
    </>
  );
};
