import { ArrowLeft, Check, Plus, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import brandLogoWhite1x from "@shared/assets/inbox/logos/bukowskiOS_logo_white.png";
import brandLogoWhite from "@shared/assets/logos/bukowskiOS_logo_white@2x.png";

const WorkspaceAvatar = ({ color, name, url }: { color?: string | null; name: string; url?: string | null }) => (
  <span className="workspace-avatar" style={color ? { background: color } : undefined}>
    {url ? <img alt="" className="workspace-avatar-image" src={url} /> : name.slice(0, 1).toUpperCase()}
  </span>
);

export const WorkspacePickerScreen = () => {
  const navigate = useNavigate();
  const { signOut } = useSession();
  const { activeWorkspaceId, isLoadingWorkspaces, memberships, refreshWorkspaces, switchWorkspace, workspaceError } =
    useWorkspace();
  const hasNoWorkspaceAccess = !isLoadingWorkspaces && memberships.length === 0;

  return (
    <div className="auth-screen">
      <div className="auth-lockup" aria-hidden="true">
        <img src={brandLogoWhite1x} srcSet={`${brandLogoWhite1x} 1x, ${brandLogoWhite} 2x`} alt="" />
      </div>
      <section className="workspace-picker-panel" aria-labelledby="workspace-picker-title">
        <div className="auth-brand workspace-picker-header">
          <h1 id="workspace-picker-title">Choose workspace</h1>
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
                window.setTimeout(() => navigate("/", { replace: true }), 110);
              }}
              type="button"
            >
              <WorkspaceAvatar color={membership.iconColor} name={membership.workspaceName} url={membership.avatarUrl} />
              <span>
                <strong>{membership.workspaceName}</strong>
                <small>{membership.roleName}</small>
              </span>
              {membership.workspaceId === activeWorkspaceId ? <Check className="workspace-picker-check" size={16} /> : null}
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
      <button
        className="auth-back-button workspace-picker-back"
        onClick={() => {
          void signOut().finally(() => navigate("/login", { replace: true }));
        }}
        type="button"
      >
        <ArrowLeft size={15} />
        <span>Back to login</span>
      </button>
    </div>
  );
};
