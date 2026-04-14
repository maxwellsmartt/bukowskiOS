import { Archive, Check, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  ProjectSetupWizard,
  createEmptyProjectSetupDraft,
  type ProjectSetupDraft,
  type WizardTab,
} from "@features/projects/ProjectSetupWizard";
import { useCatalogData } from "@features/projects/useProjectsData";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { useShellContext } from "@shared/hooks/useShellContext";

type ProjectDraft = {
  code: string;
  name: string;
  clientId: string;
};

const emptyDraft: ProjectDraft = {
  code: "",
  name: "",
  clientId: "",
};

export const ShellProjectsPanel = () => {
  const { data: catalog } = useCatalogData();
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
    updateProject,
  } = useShellContext();
  const [draft, setDraft] = useState<ProjectDraft>(emptyDraft);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardTab, setWizardTab] = useState<WizardTab>("general");
  const [wizardDraft, setWizardDraft] = useState<ProjectSetupDraft>(createEmptyProjectSetupDraft());
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDeleteProject, setPendingDeleteProject] = useState<{ id: string; name: string } | null>(null);
  const [deletePreview, setDeletePreview] = useState<Awaited<ReturnType<typeof getProjectDeletePreview>> | null>(null);
  const [isLoadingDeletePreview, setIsLoadingDeletePreview] = useState(false);
  const [isRunningLifecycleAction, setIsRunningLifecycleAction] = useState(false);

  const activeDraftProject = projects.find((project) => project.id === editingProjectId) ?? null;

  useEffect(() => {
    if (!pendingDeleteProject) {
      setDeletePreview(null);
      setIsLoadingDeletePreview(false);
      return;
    }

    let cancelled = false;
    setIsLoadingDeletePreview(true);

    void getProjectDeletePreview(pendingDeleteProject.id)
      .then((preview) => {
        if (!cancelled) {
          setDeletePreview(preview);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setActionError(error instanceof Error ? error.message : "Unable to load project lifecycle preview.");
          setDeletePreview(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingDeletePreview(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [getProjectDeletePreview, pendingDeleteProject]);

  const resetDraft = () => {
    setDraft(emptyDraft);
    setEditingProjectId(null);
  };

  const handleUpdate = async () => {
    if (!editingProjectId) {
      return;
    }

    try {
      await updateProject({
        projectId: editingProjectId,
        code: draft.code,
        name: draft.name,
        clientId: draft.clientId || undefined,
        status: activeDraftProject?.status ?? "Prep",
        description: activeDraftProject?.description ?? "",
      });
      setActionError(null);
      resetDraft();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update project.");
    }
  };

  const beginEdit = (projectId: string) => {
    const project = projects.find((entry) => entry.id === projectId);

    if (!project) {
      return;
    }

    setEditingProjectId(projectId);
    setDraft({
      code: project.code,
      name: project.name,
      clientId: project.clientId ?? "",
    });
    setActionError(null);
  };

  const handleDelete = async (projectId: string) => {
    try {
      await deleteProject(projectId);
      setActionError(null);
      if (editingProjectId === projectId) {
        resetDraft();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to delete project.");
    }
  };

  const closeLifecycleDialog = () => {
    setPendingDeleteProject(null);
    setDeletePreview(null);
    setIsLoadingDeletePreview(false);
  };

  return (
    <section className="shell-projects">
      <div className="shell-projects-header">
        <span className="shell-nav-label">Projects</span>
        <div className="shell-projects-header-actions">
          <button
            className={`shell-project-toggle${showArchivedProjects ? " is-active" : ""}`}
            onClick={() => setShowArchivedProjects(!showArchivedProjects)}
            type="button"
          >
            {showArchivedProjects ? "Hide archived" : "Show archived"}
          </button>
          <button
            className="shell-project-create-button"
            onClick={() => {
              setEditingProjectId(null);
              setWizardOpen(true);
              setWizardTab("general");
              setActionError(null);
            }}
            type="button"
          >
            <Plus size={12} />
            <span>New project</span>
          </button>
        </div>
      </div>

      {editingProjectId ? (
        <div className="shell-project-editor">
          <input
            className="shell-project-input shell-project-code"
            onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))}
            placeholder="Code"
            value={draft.code}
          />
          <input
            className="shell-project-input"
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            placeholder="Project name"
            value={draft.name}
          />
          <SelectField
            className="shell-project-select"
            wrapperClassName="shell-project-select-shell"
            onChange={(event) => setDraft((current) => ({ ...current, clientId: event.target.value }))}
            value={draft.clientId}
          >
            <option value="">No client linked</option>
            {catalog.clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </SelectField>

          <div className="shell-project-editor-actions">
            <button className="shell-project-action shell-project-action-confirm" onClick={handleUpdate} type="button">
              <Check size={12} />
            </button>
            <button className="shell-project-action" onClick={resetDraft} type="button">
              <X size={12} />
            </button>
          </div>
        </div>
      ) : null}

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

            <div className="shell-project-item-actions" onClick={(event) => event.stopPropagation()}>
              <button
                aria-label={`Edit ${project.name}`}
                className="shell-project-action"
                data-tooltip="Edit project"
                onClick={() => beginEdit(project.id)}
                type="button"
              >
                <Pencil size={12} />
              </button>
              <button
                aria-label={`${project.isArchived ? "Manage lifecycle for" : "Archive or delete"} ${project.name}`}
                className="shell-project-action is-danger"
                data-tooltip={project.isArchived ? "Manage archived project" : "Archive or delete project"}
                onClick={() => setPendingDeleteProject({ id: project.id, name: project.name })}
                type="button"
              >
                {project.isArchived ? <Archive size={12} /> : <Trash2 size={12} />}
              </button>
            </div>
          </div>
        ))}
      </div>

      {pendingDeleteProject ? (
        <div className="project-lifecycle-dialog-backdrop" onClick={closeLifecycleDialog} role="presentation">
          <div
            aria-modal="true"
            className="project-lifecycle-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="project-lifecycle-dialog-header">
              <div>
                <h3>Project lifecycle</h3>
                <p>{pendingDeleteProject.name}</p>
              </div>
              <button className="shell-project-action" onClick={closeLifecycleDialog} type="button">
                <X size={14} />
              </button>
            </div>

            {isLoadingDeletePreview ? (
              <div className="project-lifecycle-dialog-body">
                <span className="shell-project-meta">Loading lifecycle preview…</span>
              </div>
            ) : !deletePreview ? (
              <div className="project-lifecycle-dialog-body">
                <span className="shell-project-summary-copy">The app could not load lifecycle details for this project.</span>
              </div>
            ) : (
              <>
                <div className="project-lifecycle-dialog-body">
                  <div className="project-lifecycle-summary-row">
                    <span className="shell-project-meta">Status</span>
                    <StatusBadge>{deletePreview.status}</StatusBadge>
                  </div>
                  <div className="project-lifecycle-summary-row">
                    <span className="shell-project-meta">Archive state</span>
                    <StatusBadge tone={deletePreview.isArchived ? "warning" : "info"}>
                      {deletePreview.isArchived ? "Archived" : "Visible in operations"}
                    </StatusBadge>
                  </div>
                  <div className="project-lifecycle-summary-row">
                    <span className="shell-project-meta">Backup</span>
                    <span className="shell-project-summary-copy">
                      {deletePreview.backupWillRun ? "A local backup will run before any hard delete." : "No backup required."}
                    </span>
                  </div>
                  <div className="project-lifecycle-summary-row is-stacked">
                    <span className="shell-project-meta">Operational history</span>
                    <span className="shell-project-summary-copy">
                      {deletePreview.operationalRelationSummary.currentAssetCount} current assets ·{" "}
                      {deletePreview.operationalRelationSummary.assignmentCount} assignments ·{" "}
                      {deletePreview.operationalRelationSummary.incidentCount} incidents ·{" "}
                      {deletePreview.operationalRelationSummary.packingCount} packing ·{" "}
                      {deletePreview.operationalRelationSummary.financeCount} finance ·{" "}
                      {deletePreview.operationalRelationSummary.collaboratorFeeCount} collaborator fees
                    </span>
                  </div>
                  {deletePreview.hardDeleteBlockedReasons.length ? (
                    <div className="project-lifecycle-reason-list">
                      {deletePreview.hardDeleteBlockedReasons.map((reason) => (
                        <div key={reason} className="project-lifecycle-reason-item">
                          {reason}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="project-lifecycle-dialog-actions">
                  {deletePreview.canArchive ? (
                    <button
                      className="ghost-control"
                      disabled={isRunningLifecycleAction}
                      onClick={() => {
                        setIsRunningLifecycleAction(true);
                        void archiveProject({ projectId: pendingDeleteProject.id })
                          .then(() => {
                            setActionError(null);
                            closeLifecycleDialog();
                          })
                          .catch((error) => setActionError(error instanceof Error ? error.message : "Unable to archive project."))
                          .finally(() => setIsRunningLifecycleAction(false));
                      }}
                      type="button"
                    >
                      <Archive size={14} />
                      <span>Archive</span>
                    </button>
                  ) : null}
                  {deletePreview.canUnarchive ? (
                    <button
                      className="ghost-control"
                      disabled={isRunningLifecycleAction}
                      onClick={() => {
                        setIsRunningLifecycleAction(true);
                        void unarchiveProject({ projectId: pendingDeleteProject.id })
                          .then(() => {
                            setActionError(null);
                            closeLifecycleDialog();
                          })
                          .catch((error) => setActionError(error instanceof Error ? error.message : "Unable to unarchive project."))
                          .finally(() => setIsRunningLifecycleAction(false));
                      }}
                      type="button"
                    >
                      <Undo2 size={14} />
                      <span>Unarchive</span>
                    </button>
                  ) : null}
                  <button
                    className="ghost-control is-danger"
                    disabled={isRunningLifecycleAction || !deletePreview.canHardDelete}
                    onClick={() => {
                      setIsRunningLifecycleAction(true);
                      void handleDelete(pendingDeleteProject.id)
                        .then(() => {
                          closeLifecycleDialog();
                        })
                        .finally(() => setIsRunningLifecycleAction(false));
                    }}
                    type="button"
                  >
                    <Trash2 size={14} />
                    <span>Hard delete</span>
                  </button>
                  <button className="ghost-control" disabled={isRunningLifecycleAction} onClick={closeLifecycleDialog} type="button">
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

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
    </section>
  );
};
