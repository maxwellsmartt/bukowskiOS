import { Archive, ArchiveRestore, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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
import type { ProjectCardRow, ProjectDeletePreview } from "@contracts";

type LinkedItem = { labelKey: string; count: number };

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
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [deletePreview, setDeletePreview] = useState<{ project: ProjectCardRow; preview: ProjectDeletePreview } | null>(null);
  const [isDeleteSubmitting, setIsDeleteSubmitting] = useState(false);

  const handleEditProject = (projectId: string) => {
    setActionError(null);
    openProject(projectId, "info");
  };

  const handleToggleArchive = async (project: ProjectCardRow) => {
    setActionError(null);

    try {
      if (project.isArchived) {
        await unarchiveProject({ projectId: project.id });
      } else {
        await archiveProject({ projectId: project.id });
      }
    } catch (error) {
      setActionError(
        getUserFacingErrorMessage(
          error,
          project.isArchived ? t("shell.projectsPanel.errors.restoreFailed") : t("shell.projectsPanel.errors.archiveFailed"),
        ),
      );
    }
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

      <div className="shell-project-list">
        {projects.map((project) => {
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
                <button
                  aria-label={t("shell.projectsPanel.deleteProjectAria", { name: project.name })}
                  className="shell-project-action is-danger"
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
              </div>
            </div>
          );
        })}
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
