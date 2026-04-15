import { Check, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useWorkspace } from "@app/providers/WorkspaceProvider";

export const WorkspacePickerScreen = () => {
  const navigate = useNavigate();
  const { activeWorkspaceId, memberships, switchWorkspace, workspaceError } = useWorkspace();

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
