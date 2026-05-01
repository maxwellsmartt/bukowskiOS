import { Archive, ArchiveRestore, Pencil, Trash2, createLucideIcon } from "lucide-react";
import { useState } from "react";

import {
  ProjectSetupWizard,
  createEmptyProjectSetupDraft,
  type ProjectSetupDraft,
  type WizardTab,
} from "@features/projects/ProjectSetupWizard";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { useShellContext } from "@shared/hooks/useShellContext";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import type { ProjectCardRow, ProjectDeletePreview } from "@contracts";

const LayersPlus = createLucideIcon("layers-plus", [
  [
    "path",
    {
      d: "M13 13.74a2 2 0 0 1-2 0L2.5 8.87a1 1 0 0 1 0-1.74L11 2.26a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74z",
      key: "layers-plus-top",
    },
  ],
  [
    "path",
    {
      d: "m20 14.285 1.5.845a1 1 0 0 1 0 1.74L13 21.74a2 2 0 0 1-2 0l-8.5-4.87a1 1 0 0 1 0-1.74l1.5-.845",
      key: "layers-plus-bottom",
    },
  ],
  ["path", { d: "M19 8h4", key: "layers-plus-horizontal" }],
  ["path", { d: "M21 6v4", key: "layers-plus-vertical" }],
]);

type LinkedItem = { label: string; count: number };

const buildLinkedItems = (preview: ProjectDeletePreview): LinkedItem[] => {
  const relationSummary = preview.operationalRelationSummary;
  return [
    { label: "current assets", count: relationSummary.currentAssetCount },
    { label: "assignments", count: relationSummary.assignmentCount },
    { label: "incidents", count: relationSummary.incidentCount },
    { label: "packing slips", count: relationSummary.packingCount },
    { label: "finance records", count: relationSummary.financeCount },
    { label: "collaborator fees", count: relationSummary.collaboratorFeeCount },
  ].filter((item) => item.count > 0);
};

export const ShellProjectsPanel = () => {
  const {
    activeProjectId,
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
          project.isArchived ? "Could not restore this project." : "Could not archive this project.",
        ),
      );
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
            : "This project cannot be deleted yet.",
        );
        setDeletingProjectId(null);
        return;
      }

      setDeletePreview({ project, preview });
    } catch (error) {
      setActionError(getUserFacingErrorMessage(error, "Could not prepare this deletion."));
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
      setActionError(getUserFacingErrorMessage(error, "Could not delete this project."));
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
        <span className="shell-nav-label">Projects</span>
        <div className="shell-projects-header-actions">
          <button
            aria-label={showArchivedProjects ? "Hide archived projects" : "Show archived projects"}
            className={`icon-ghost-control shell-project-toggle${showArchivedProjects ? " is-active" : ""}`}
            onClick={() => setShowArchivedProjects(!showArchivedProjects)}
            type="button"
          >
            <Archive size={14} />
          </button>
          <button
            aria-label="New project"
            className="icon-ghost-control shell-project-create-button"
            onClick={() => {
              setWizardOpen(true);
              setWizardTab("general");
              setActionError(null);
            }}
            type="button"
          >
            <LayersPlus size={14} />
          </button>
        </div>
      </div>

      {projectsError || actionError ? <div className="shell-project-error">{projectsError ?? actionError}</div> : null}

      <div className="shell-project-list">
        {projects.map((project) => (
          <div
            key={project.id}
            className={`shell-project-item${scopeMode === "project" && project.id === activeProjectId ? " active" : ""}${project.isArchived ? " is-archived" : ""}`}
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
                {project.isArchived ? <span className="shell-project-archived-badge">Archived</span> : null}
              </div>
              <span className="shell-project-meta">
                {project.assetCount} assets · {project.incidentCount} incidents
              </span>
            </div>
            <div className="shell-project-item-actions" aria-label={`${project.name} actions`}>
              <button
                aria-label={`Edit ${project.name}`}
                className="shell-project-action"
                onClick={(event) => {
                  event.stopPropagation();
                  handleEditProject(project.id);
                }}
                title="Edit details"
                type="button"
              >
                <Pencil size={13} />
              </button>
              <button
                aria-label={project.isArchived ? `Restore ${project.name}` : `Archive ${project.name}`}
                className="shell-project-action"
                onClick={(event) => {
                  event.stopPropagation();
                  void handleToggleArchive(project);
                }}
                title={project.isArchived ? "Restore project (reversible)" : "Archive project (reversible)"}
                type="button"
              >
                {project.isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
              </button>
              <button
                aria-label={`Delete ${project.name}`}
                className="shell-project-action is-danger"
                disabled={deletingProjectId === project.id}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleRequestDelete(project);
                }}
                title="Delete permanently (with backup)"
                type="button"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
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
          confirmLabel="Delete project"
          cancelLabel="Keep project"
          isSubmitting={isDeleteSubmitting}
          title={`Delete "${deletePreview.preview.name}"?`}
          body={
            <>
              <p>
                {deletePreview.preview.backupWillRun
                  ? "A backup will be created before deletion."
                  : "No backup is scheduled for this deletion."}
              </p>
              <p className="confirm-dialog-warning">This action cannot be undone.</p>
            </>
          }
          details={(() => {
            const linkedItems = buildLinkedItems(deletePreview.preview);
            if (!linkedItems.length) {
              return <p className="confirm-dialog-empty">No linked operational data was found.</p>;
            }
            return (
              <>
                <span className="confirm-dialog-details-label">Linked data that will be removed</span>
                <ul className="confirm-dialog-list">
                  {linkedItems.map((item) => (
                    <li key={item.label}>
                      <strong>{item.count}</strong> {item.label}
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
