import { Check, ChevronDown, Plus, Settings } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useWorkspace } from "@app/providers/WorkspaceProvider";

export const WorkspaceSwitcher = () => {
  const navigate = useNavigate();
  const { activeWorkspaceId, activeWorkspaceName, memberships, switchWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);

  return (
    <div className="workspace-switcher">
      <button className="workspace-switcher-trigger" onClick={() => setOpen((current) => !current)} type="button">
        <span className="workspace-avatar">{activeWorkspaceName.slice(0, 1).toUpperCase()}</span>
        <span className="context-meta-stack">
          <span className="context-meta-label">Workspace</span>
          <span className="context-meta-value">{activeWorkspaceName}</span>
        </span>
        <ChevronDown size={13} />
      </button>

      {open ? (
        <div className="workspace-switcher-menu">
          {memberships.map((membership) => (
            <button
              className="workspace-switcher-item"
              key={membership.workspaceId}
              onClick={() => {
                switchWorkspace(membership.workspaceId);
                setOpen(false);
                navigate("/", { replace: true });
              }}
              type="button"
            >
              <span className="workspace-avatar">{membership.workspaceName.slice(0, 1).toUpperCase()}</span>
              <span>
                <strong>{membership.workspaceName}</strong>
                <small>{membership.roleName}</small>
              </span>
              {membership.workspaceId === activeWorkspaceId ? <Check size={14} /> : null}
            </button>
          ))}
          <div className="workspace-switcher-footer">
            <button onClick={() => { setOpen(false); navigate("/workspaces/create"); }} type="button">
              <Plus size={14} />
              <span>Create workspace</span>
            </button>
            <button onClick={() => { setOpen(false); navigate("/settings"); }} type="button">
              <Settings size={14} />
              <span>Workspace settings</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
