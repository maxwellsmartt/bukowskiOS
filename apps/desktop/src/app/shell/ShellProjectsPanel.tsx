import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

import { useShellContext } from "@shared/hooks/useShellContext";

type ProjectDraft = {
  code: string;
  name: string;
  clientName: string;
};

const emptyDraft: ProjectDraft = {
  code: "",
  name: "",
  clientName: "",
};

export const ShellProjectsPanel = () => {
  const { activeProjectId, createProject, deleteProject, projects, projectsError, setActiveProjectId, updateProject } =
    useShellContext();
  const [draft, setDraft] = useState<ProjectDraft>(emptyDraft);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const activeDraftProject = projects.find((project) => project.id === editingProjectId) ?? null;

  const resetDraft = () => {
    setDraft(emptyDraft);
    setCreateOpen(false);
    setEditingProjectId(null);
  };

  const handleCreate = async () => {
    try {
      await createProject({
        code: draft.code,
        name: draft.name,
        clientName: draft.clientName,
      });
      setActionError(null);
      resetDraft();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to create project.");
    }
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
        clientName: draft.clientName,
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

    setCreateOpen(false);
    setEditingProjectId(projectId);
    setDraft({
      code: project.code,
      name: project.name,
      clientName: project.client === "—" ? "" : project.client,
    });
    setActionError(null);
  };

  const handleDelete = async (projectId: string, projectName: string) => {
    const confirmed = window.confirm(`Delete project "${projectName}"? This only works if it has no linked operational records.`);

    if (!confirmed) {
      return;
    }

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
            setCreateOpen((current) => !current);
            setDraft(emptyDraft);
            setActionError(null);
          }}
          type="button"
        >
          <Plus size={12} />
        </button>
      </div>

      {createOpen || editingProjectId ? (
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
          <input
            className="shell-project-input"
            onChange={(event) => setDraft((current) => ({ ...current, clientName: event.target.value }))}
            placeholder="Client"
            value={draft.clientName}
          />

          <div className="shell-project-editor-actions">
            <button className="shell-project-action shell-project-action-confirm" onClick={editingProjectId ? handleUpdate : handleCreate} type="button">
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
            className={`shell-project-item${project.id === activeProjectId ? " active" : ""}`}
            onClick={() => setActiveProjectId(project.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setActiveProjectId(project.id);
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
              <button className="shell-project-action" onClick={() => beginEdit(project.id)} type="button">
                <Pencil size={12} />
              </button>
              <button className="shell-project-action" onClick={() => handleDelete(project.id, project.name)} type="button">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
