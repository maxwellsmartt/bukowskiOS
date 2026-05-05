import { Check, Plus, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useWorkspace } from "@app/providers/WorkspaceProvider";

export const WorkspacePickerScreen = () => {
  const navigate = useNavigate();
  const { activeWorkspaceId, isLoadingWorkspaces, memberships, refreshWorkspaces, switchWorkspace, workspaceError } =
    useWorkspace();
  const hasNoWorkspaceAccess = !isLoadingWorkspaces && memberships.length === 0;

  return (
    <div className="auth-screen">
      <section className="workspace-picker-panel" aria-labelledby="workspace-picker-title">
        <div className="auth-brand">
          <span className="auth-brand-mark">B</span>
          <div>
            <p className="auth-eyebrow">Workspace</p>
            <h1 id="workspace-picker-title">Choose workspace</h1>
          </div>
        </div>

        <div className="workspace-picker-list">
          {isLoadingWorkspaces ? (
            <div className="workspace-picker-loading">
              <span className="workspace-avatar">B</span>
              <span>
                <strong>Loading workspaces</strong>
                <small>Restoring your latest access...</small>
              </span>
            </div>
          ) : null}
          {memberships.map((membership) => (
            <button
              className={`workspace-picker-item${membership.workspaceId === activeWorkspaceId ? " is-active" : ""}`}
              key={membership.workspaceId}
              onClick={() => {
                switchWorkspace(membership.workspaceId);
                navigate("/", { replace: true });
              }}
              type="button"
            >
              <span className="workspace-avatar">{membership.workspaceName.slice(0, 1).toUpperCase()}</span>
              <span>
                <strong>{membership.workspaceName}</strong>
                <small>{membership.roleName}</small>
              </span>
              {membership.workspaceId === activeWorkspaceId ? <Check size={16} /> : null}
            </button>
          ))}
          {hasNoWorkspaceAccess ? (
            <div className="workspace-picker-empty">
              <strong>No workspace access yet</strong>
              <p>Ask an admin to invite this email, then refresh once you accept the invite.</p>
              <button className="auth-secondary-button" onClick={() => void refreshWorkspaces()} type="button">
                <RefreshCw size={14} />
                <span>Refresh access</span>
              </button>
            </div>
          ) : null}
        </div>

        <button className="auth-secondary-button" onClick={() => navigate("/workspaces/create")} type="button">
          <Plus size={16} />
          <span>Create workspace</span>
        </button>
        {workspaceError ? <p className="auth-status">{workspaceError}</p> : null}
      </section>
    </div>
  );
};
