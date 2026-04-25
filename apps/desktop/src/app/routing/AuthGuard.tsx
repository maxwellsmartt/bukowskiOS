import { Navigate, useLocation } from "react-router-dom";

import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";

export const AuthGuard = ({ children }: { children: JSX.Element }) => {
  const location = useLocation();
  const { status } = useSession();
  const { isLoadingWorkspaces, isWorkspaceReady } = useWorkspace();

  if (status === "loading") {
    return (
      <div className="shell-loading-state">
        <div className="empty-state">Restoring secure session...</div>
      </div>
    );
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (isLoadingWorkspaces && !isWorkspaceReady) {
    return (
      <div className="shell-loading-state">
        <div className="empty-state">Loading workspace...</div>
      </div>
    );
  }

  if (!isWorkspaceReady && !location.pathname.startsWith("/workspaces")) {
    return <Navigate to="/workspaces/select" replace />;
  }

  return children;
};

export const GuestOnlyRoute = ({ children }: { children: JSX.Element }) => {
  const { status } = useSession();

  if (status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  return children;
};
