import { Navigate, useLocation } from "react-router-dom";

import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";

const AuthBlockingShell = ({ message }: { message: string }) => (
  <div className="auth-blocking-shell" role="status" aria-live="polite">
    <div className="auth-blocking-card">
      <span className="auth-blocking-spinner" aria-hidden="true" />
      <strong>{message}</strong>
    </div>
  </div>
);

export const AuthGuard = ({ children }: { children: JSX.Element }) => {
  const location = useLocation();
  const { status } = useSession();
  const { isLoadingWorkspaces, isWorkspaceReady } = useWorkspace();

  if (status === "loading") {
    return <AuthBlockingShell message="Restoring secure session…" />;
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (isLoadingWorkspaces && !isWorkspaceReady) {
    return <AuthBlockingShell message="Loading your workspace…" />;
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
