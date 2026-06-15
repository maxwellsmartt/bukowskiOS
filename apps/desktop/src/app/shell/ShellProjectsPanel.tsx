import { Archive, ArchiveRestore, Eye, EyeOff, ListFilter, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ProjectSetupWizard,
  createEmptyProjectSetupDraft,
  type ProjectSetupDraft,
  type WizardTab,
} from "@features/projects/ProjectSetupWizard";
import { useProjectTimelinePreferences } from "@features/projects/useProjectTimelinePreferences";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { useShellContext } from "@shared/hooks/useShellContext";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { readStringPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";
import type { ProjectCardRow, ProjectDeletePreview } from "@contracts";

type LinkedItem = { labelKey: string; count: number };
type ProjectSidebarSort = "name" | "code" | "startDate" | "createdAt" | "updatedAt" | "incidents";

const projectSortValues: ProjectSidebarSort[] = ["name", "code", "startDate", "createdAt", "updatedAt", "incidents"];

const readStoredProjectSort = (): ProjectSidebarSort => {
  const stored = readStringPreference(uiPreferenceKeys.shellProjectsSort);
  return projectSortValues.includes(stored as ProjectSidebarSort) ? (stored as ProjectSidebarSort) : "name";
};

const buildLinkedItems = (preview: ProjectDeletePreview): LinkedItem[] => {
  const relationSummary = preview.operationalRelationSummary;
  return [
    { labelKey: "shell.projectsPanel.deleteDialog.linked.currentAssets", count: relationSummary.currentAssetCount },
    { labelKey: "shell.projectsPanel.deleteDialog.linked.assignments", count: relationSummary.assignmentCount },
    { labelKey: "shell.projectsPanel.deleteDialog.linked.incidents", count: relationSummary.incidentCount },
    { labelKey: "shell.projectsPanel.deleteDialog.linked.packingSlips", count: relationSummary.packingCount },
    { labelKey: "shell.projectsPanel.deleteDialog.linked.financeRecords", count: relationSummary.financeCount },
    { labelKey: "shell.projectsPanel.deleteDialog.linked.collaboratorFees", count: relationSummary.collaboratorFeeCount },
  ].filter((item) => item.count > 0);
};

export const ShellProjectsPanel = () => {
  const { t } = useTranslation();
  const {
    activeProjectId,
    activeWorkspaceId,
    archiveProject,
    deleteProject,
    getProjectDeletePreview,
    openProject,
    projects,
    projectsError,
    scopeMode,
    showArchivedProjects,
    setShowArchivedProjects,
    unarchiveProject,
  } = useShellContext();
  const { hiddenProjectIds, toggleProjectHidden } = useProjectTimelinePreferences(activeWorkspaceId);
  const hiddenProjectIdSet = new Set(hiddenProjectIds);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardTab, setWizardTab] = useState<WizardTab>("general");
  const [wizardDraft, setWizardDraft] = useState<ProjectSetupDraft>(createEmptyProjectSetupDraft());
  const [actionError, setActionError] = useState<string | null>(null);
  const [archivePreview, setArchivePreview] = useState<ProjectCardRow | null>(null);
  const [isArchiveSubmitting, setIsArchiveSubmitting] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [deletePreview, setDeletePreview] = useState<{ project: ProjectCardRow; preview: ProjectDeletePreview } | null>(null);
  const [isDeleteSubmitting, setIsDeleteSubmitting] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectSort, setProjectSort] = useState<ProjectSidebarSort>(readStoredProjectSort);

  const handleProjectSortChange = (next: ProjectSidebarSort) => {
    setProjectSort(next);
    writePreference(uiPreferenceKeys.shellProjectsSort, next);
  };

  const visibleProjects = useMemo(() => {
    const query = projectSearch.trim().toLocaleLowerCase();
    const matchesSearch = (project: ProjectCardRow) => {
      if (!query) {
        return true;
      }

      return [project.name, project.code, project.client, project.productionCompany, project.status, project.departments, project.exposure, project.description]
        .flatMap((value) => (value ? [value] : []))
        .some((value) => value.toLocaleLowerCase().includes(query));
    };

    return [...projects]
      .filter(matchesSearch)
      .sort((first, second) => {
        if (projectSort === "code") {
          return first.code.localeCompare(second.code, undefined, { sensitivity: "base" });
        }

        if (projectSort === "startDate") {
          return (first.startDate ?? "9999-12-31").localeCompare(second.startDate ?? "9999-12-31");
        }

        if (projectSort === "createdAt") {
          return (second.createdAt ?? "").localeCompare(first.createdAt ?? "");
        }

        if (projectSort === "updatedAt") {
          return (second.updatedAt ?? "").localeCompare(first.updatedAt ?? "");
        }

        if (projectSort === "incidents") {
          return second.incidentCount - first.incidentCount || first.name.localeCompare(second.name, undefined, { sensitivity: "base" });
        }

        return first.name.localeCompare(second.name, undefined, { sensitivity: "base" });
      });
  }, [projectSearch, projectSort, projects]);

  const handleEditProject = (projectId: string) => {
    setActionError(null);
    openProject(projectId, "info");
  };

  const handleToggleArchive = async (project: ProjectCardRow) => {
    setActionError(null);

    if (!project.isArchived) {
      setArchivePreview(project);
      return;
    }

    try {
      await unarchiveProject({ projectId: project.id });
    } catch (error) {
      setActionError(getUserFacingErrorMessage(error, t("shell.projectsPanel.errors.restoreFailed")));
    }
  };

  const handleConfirmArchive = async () => {
    if (!archivePreview) {
      return;
    }

    setIsArchiveSubmitting(true);
    setActionError(null);

    try {
      await archiveProject({ projectId: archivePreview.id });
      setArchivePreview(null);
    } catch (error) {
      setActionError(getUserFacingErrorMessage(error, t("shell.projectsPanel.errors.archiveFailed")));
    } finally {
      setIsArchiveSubmitting(false);
    }
  };

  const handleCancelArchive = () => {
    setArchivePreview(null);
  };

  const handleToggleTimelineVisibility = async (project: ProjectCardRow) => {
    setActionError(null);

    try {
      await toggleProjectHidden(project.id);
    } catch (error) {
      setActionError(getUserFacingErrorMessage(error, t("shell.projectsPanel.timelineVisibilityFailed")));
    }
  };

  const handleRequestDelete = async (project: ProjectCardRow) => {
    if (deletingProjectId) {
      return;
    }

    setDeletingProjectId(project.id);
    setActionError(null);

    try {
      const preview = await getProjectDeletePreview(project.id);

      if (!preview.canHardDelete) {
        setActionError(
          preview.hardDeleteBlockedReasons.length
            ? preview.hardDeleteBlockedReasons.join(" ")
            : t("shell.projectsPanel.errors.deleteBlocked"),
        );
        setDeletingProjectId(null);
        return;
      }

      setDeletePreview({ project, preview });
    } catch (error) {
      setActionError(getUserFacingErrorMessage(error, t("shell.projectsPanel.errors.deletePreviewFailed")));
      setDeletingProjectId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletePreview) {
      return;
    }

    setIsDeleteSubmitting(true);

    try {
      await deleteProject(deletePreview.project.id);
      setDeletePreview(null);
    } catch (error) {
      setActionError(getUserFacingErrorMessage(error, t("shell.projectsPanel.errors.deleteFailed")));
    } finally {
      setIsDeleteSubmitting(false);
      setDeletingProjectId(null);
    }
  };

  const handleCancelDelete = () => {
    setDeletePreview(null);
    setDeletingProjectId(null);
  };

  return (
    <section className="shell-projects">
      <div className="shell-projects-header">
        <span className="shell-nav-label">{t("shell.nav.primary.projects")}</span>
        <div className="shell-projects-header-actions">
          <button
            aria-label={showArchivedProjects ? t("shell.projectsPanel.hideArchived") : t("shell.projectsPanel.showArchived")}
            className={`icon-ghost-control shell-project-toggle${showArchivedProjects ? " is-active" : ""}`}
            onClick={() => setShowArchivedProjects(!showArchivedProjects)}
            type="button"
          >
            <Archive size={14} />
          </button>
          <button
            aria-label={t("shell.projectsPanel.newProject")}
            className="icon-ghost-control shell-project-create-button"
            onClick={() => {
              setWizardOpen(true);
              setWizardTab("general");
              setActionError(null);
            }}
            type="button"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {projectsError || actionError ? <div className="shell-project-error">{projectsError ?? actionError}</div> : null}

      <div className="shell-projects-tools">
        <label className="shell-project-search">
          <Search size={12} />
          <input
            aria-label={t("shell.projectsPanel.searchAria", { defaultValue: "Buscar proyectos" })}
            onChange={(event) => setProjectSearch(event.target.value)}
            placeholder={t("shell.projectsPanel.searchPlaceholder", { defaultValue: "Buscar" })}
            value={projectSearch}
          />
        </label>
        <label className="shell-project-sort-control">
          <ListFilter size={12} />
          <select
            aria-label={t("shell.projectsPanel.sortAria", { defaultValue: "Ordenar proyectos" })}
            onChange={(event) => handleProjectSortChange(event.target.value as ProjectSidebarSort)}
            value={projectSort}
          >
            <option value="name">{t("shell.projectsPanel.sortName", { defaultValue: "Nombre" })}</option>
            <option value="code">{t("shell.projectsPanel.sortCode", { defaultValue: "Código" })}</option>
            <option value="startDate">{t("shell.projectsPanel.sortStartDate", { defaultValue: "Fecha" })}</option>
            <option value="createdAt">{t("shell.projectsPanel.sortCreatedAt", { defaultValue: "Fecha de creación" })}</option>
            <option value="updatedAt">{t("shell.projectsPanel.sortUpdatedAt", { defaultValue: "Fecha de actualización" })}</option>
            <option value="incidents">{t("shell.projectsPanel.sortIncidents", { defaultValue: "Incidentes" })}</option>
          </select>
        </label>
      </div>

      <div className="shell-project-list">
        {visibleProjects.map((project) => {
          const isTimelineHidden = hiddenProjectIdSet.has(project.id);

          return (
            <div
              key={project.id}
              className={`shell-project-item${scopeMode === "project" && project.id === activeProjectId ? " active" : ""}${project.isArchived ? " is-archived" : ""}${isTimelineHidden ? " is-timeline-hidden" : ""}`}
              onClick={() => openProject(project.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openProject(project.id);
                }
              }}
            >
              <div className="shell-project-copy">
                <div className="shell-project-title-row">
                  <span className="shell-project-code-badge">{project.code}</span>
                  <span className="shell-project-name">{project.name}</span>
                  {project.isArchived ? <span className="shell-project-archived-badge">{t("shell.projectsPanel.archived")}</span> : null}
                </div>
                <span className="shell-project-meta">
                  {t("shell.projectsPanel.assets", { count: project.assetCount })} · {t("shell.projectsPanel.incidents", { count: project.incidentCount })}
                </span>
              </div>
              <div className="shell-project-item-actions" aria-label={`${project.name} actions`}>
                <button
                  aria-label={t("shell.projectsPanel.editProjectAria", { name: project.name })}
                  className="shell-project-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleEditProject(project.id);
                  }}
                  title={t("shell.projectsPanel.editProject")}
                  type="button"
                >
                  <Pencil size={13} />
                </button>
                <button
                  aria-label={
                    project.isArchived
                      ? t("shell.projectsPanel.restoreProjectAria", { name: project.name })
                      : t("shell.projectsPanel.archiveProjectAria", { name: project.name })
                  }
                  className="shell-project-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleToggleArchive(project);
                  }}
                  title={project.isArchived ? t("shell.projectsPanel.restoreProject") : t("shell.projectsPanel.archiveProject")}
                  type="button"
                >
                  {project.isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                </button>
                <button
                  aria-label={
                    isTimelineHidden
                      ? t("shell.projectsPanel.showInTimelineAria", { name: project.name })
                      : t("shell.projectsPanel.hideFromTimelineAria", { name: project.name })
                  }
                  className="shell-project-action shell-project-visibility-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.detail > 0) {
                      event.currentTarget.blur();
                    }
                    void handleToggleTimelineVisibility(project);
                  }}
                  title={isTimelineHidden ? t("shell.projectsPanel.showInTimeline") : t("shell.projectsPanel.hideFromTimeline")}
                  type="button"
                >
                  {isTimelineHidden ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                {project.isArchived ? (
                  <button
                    aria-label={t("shell.projectsPanel.deleteProjectAria", { name: project.name })}
                    className="shell-project-action is-danger shell-project-delete-action"
                    disabled={deletingProjectId === project.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleRequestDelete(project);
                    }}
                    title={t("shell.projectsPanel.deleteProject")}
                    type="button"
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {!visibleProjects.length ? (
          <div className="shell-project-empty">
            {projectSearch.trim()
              ? t("shell.projectsPanel.noSearchResults", { defaultValue: "No hay proyectos que coincidan." })
              : t("shell.projectsPanel.empty", { defaultValue: "No hay proyectos todavía." })}
          </div>
        ) : null}
      </div>

      <ProjectSetupWizard
        activeTab={wizardTab}
        draft={wizardDraft}
        onChangeDraft={setWizardDraft}
        onChangeTab={setWizardTab}
        onClose={() => setWizardOpen(false)}
        onDiscardDraft={() => {
          setWizardDraft(createEmptyProjectSetupDraft());
          setWizardTab("general");
        }}
        open={wizardOpen}
      />

      {archivePreview ? (
        <ConfirmDialog
          isOpen
          confirmLabel={t("shell.projectsPanel.archiveDialog.confirm")}
          cancelLabel={t("shell.projectsPanel.archiveDialog.cancel")}
          isSubmitting={isArchiveSubmitting}
          title={t("shell.projectsPanel.archiveDialog.title", { name: archivePreview.name })}
          body={
            <>
              <p>{t("shell.projectsPanel.archiveDialog.body")}</p>
              <p className="confirm-dialog-warning">{t("shell.projectsPanel.archiveDialog.warning")}</p>
            </>
          }
          onConfirm={handleConfirmArchive}
          onCancel={handleCancelArchive}
        />
      ) : null}

      {deletePreview ? (
        <ConfirmDialog
          isOpen
          tone="danger"
          confirmLabel={t("shell.projectsPanel.deleteDialog.confirm")}
          cancelLabel={t("shell.projectsPanel.deleteDialog.cancel")}
          isSubmitting={isDeleteSubmitting}
          title={t("shell.projectsPanel.deleteDialog.title", { name: deletePreview.preview.name })}
          body={
            <>
              <p>
                {deletePreview.preview.backupWillRun
                  ? t("shell.projectsPanel.deleteDialog.bodyBackup")
                  : t("shell.projectsPanel.deleteDialog.bodyNoBackup")}
              </p>
              <p className="confirm-dialog-warning">{t("shell.projectsPanel.deleteDialog.warning")}</p>
            </>
          }
          details={(() => {
            const linkedItems = buildLinkedItems(deletePreview.preview);
            if (!linkedItems.length) {
              return <p className="confirm-dialog-empty">{t("shell.projectsPanel.deleteDialog.noLinkedData")}</p>;
            }
            return (
              <>
                <span className="confirm-dialog-details-label">{t("shell.projectsPanel.deleteDialog.detailsLabel")}</span>
                <ul className="confirm-dialog-list">
                  {linkedItems.map((item) => (
                    <li key={item.labelKey}>
                      <strong>{item.count}</strong> {t(item.labelKey, { count: item.count })}
                    </li>
                  ))}
                </ul>
              </>
            );
          })()}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      ) : null}
    </section>
  );
};
