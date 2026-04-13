import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

import {
  ProjectSetupWizard,
  createEmptyProjectSetupDraft,
  type ProjectSetupDraft,
  type WizardTab,
} from "@features/projects/ProjectSetupWizard";
import { useCatalogData } from "@features/projects/useProjectsData";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { SelectField } from "@shared/components/SelectField";
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
  const { activeProjectId, deleteProject, openProject, projects, projectsError, scopeMode, updateProject } =
    useShellContext();
  const [draft, setDraft] = useState<ProjectDraft>(emptyDraft);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardTab, setWizardTab] = useState<WizardTab>("general");
  const [wizardDraft, setWizardDraft] = useState<ProjectSetupDraft>(createEmptyProjectSetupDraft());
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDeleteProject, setPendingDeleteProject] = useState<{ id: string; name: string } | null>(null);

  const activeDraftProject = projects.find((project) => project.id === editingProjectId) ?? null;

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

  return (
    <section className="shell-projects">
      <div className="shell-projects-header">
        <span className="shell-nav-label">Projects</span>
        <button
          className="shell-project-action"
          onClick={() => {
            setEditingProjectId(null);
            setWizardOpen(true);
            setWizardTab("general");
            setActionError(null);
          }}
          type="button"
        >
          <Plus size={12} />
        </button>
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
            className={`shell-project-item${scopeMode === "project" && project.id === activeProjectId ? " active" : ""}`}
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
              </div>
              <span className="shell-project-meta">
                {project.assetCount} assets · {project.incidentCount} incidents
              </span>
            </div>

            <div className="shell-project-item-actions" onClick={(event) => event.stopPropagation()}>
              <button className="shell-project-action" onClick={() => beginEdit(project.id)} title="Edit project" type="button">
                <Pencil size={12} />
              </button>
              <button
                className="shell-project-action"
                onClick={() => setPendingDeleteProject({ id: project.id, name: project.name })}
                title="Delete project"
                type="button"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        body={
          pendingDeleteProject
            ? `Delete "${pendingDeleteProject.name}"? This only works when the project has no linked operational records.`
            : ""
        }
        confirmLabel="Delete project"
        isOpen={Boolean(pendingDeleteProject)}
        onCancel={() => setPendingDeleteProject(null)}
        onConfirm={async () => {
          if (!pendingDeleteProject) {
            return;
          }

          await handleDelete(pendingDeleteProject.id);
          setPendingDeleteProject(null);
        }}
        title="Delete project"
        tone="danger"
      />

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
