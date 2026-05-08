import { Check, ChevronDown, Plus, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useWorkspace } from "@app/providers/WorkspaceProvider";

const WorkspaceAvatar = ({ color, name, url }: { color?: string | null; name: string; url?: string | null }) => (
  <span className="workspace-avatar" style={color ? { background: color } : undefined}>
    {url ? <img alt="" className="workspace-avatar-image" src={url} /> : name.slice(0, 1).toUpperCase()}
  </span>
);

export const WorkspaceSwitcher = () => {
  const navigate = useNavigate();
  const { activeMembership, activeWorkspaceId, activeWorkspaceName, memberships, switchWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  return (
    <div className="workspace-switcher" ref={switcherRef}>
      <button
        aria-expanded={open}
        aria-label={`Switch workspace · current: ${activeWorkspaceName}`}
        className="workspace-switcher-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <WorkspaceAvatar color={activeMembership?.iconColor} name={activeWorkspaceName} url={activeMembership?.avatarUrl} />
        <span className="workspace-switcher-name">{activeWorkspaceName}</span>
        <ChevronDown className="workspace-switcher-chevron" size={13} />
      </button>

      {open ? (
        <div className="workspace-switcher-menu">
          {memberships.map((membership) => (
            <button
              className={`workspace-switcher-item${membership.workspaceId === activeWorkspaceId ? " is-active" : ""}`}
              key={membership.workspaceId}
              onClick={() => {
                switchWorkspace(membership.workspaceId);
                setOpen(false);
                navigate("/", { replace: true });
              }}
              type="button"
            >
              <WorkspaceAvatar color={membership.iconColor} name={membership.workspaceName} url={membership.avatarUrl} />
              <span>
                <strong>{membership.workspaceName}</strong>
                <small>{membership.roleName}</small>
              </span>
              {membership.workspaceId === activeWorkspaceId ? <Check className="workspace-switcher-check" size={14} /> : null}
            </button>
          ))}
          <div className="workspace-switcher-footer">
            <button
              onClick={() => {
                setOpen(false);
                navigate("/workspaces/create");
              }}
              type="button"
            >
              <Plus size={14} />
              <span>Create workspace</span>
            </button>
            <button
              onClick={() => {
                setOpen(false);
                navigate("/settings/workspace");
              }}
              type="button"
            >
              <Settings size={14} />
              <span>Settings</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
