import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { DEFAULT_WORKSPACE_ID } from "@contracts";
import { readStringPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";

import { useSession } from "./SessionProvider";

export type WorkspaceMembership = {
  workspaceId: string;
  workspaceName: string;
  roleName: string;
  status: "active" | "invited" | "inactive";
  permissions: string[];
};

type WorkspaceContextValue = {
  activeWorkspaceId: string;
  activeWorkspaceName: string;
  memberships: WorkspaceMembership[];
  activeMembership: WorkspaceMembership | null;
  permissions: string[];
  isWorkspaceReady: boolean;
  workspaceError: string | null;
  switchWorkspace: (workspaceId: string) => void;
  hasPermission: (permissionKey: string) => boolean;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const localMembership: WorkspaceMembership = {
  workspaceId: DEFAULT_WORKSPACE_ID,
  workspaceName: "Metadata Cine",
  roleName: "Local admin",
  status: "active",
  permissions: ["*"],
};

export const WorkspaceProvider = ({ children }: { children: ReactNode }) => {
  const { status, user, supabase, isLocalFallback } = useSession();
  const [memberships, setMemberships] = useState<WorkspaceMembership[]>(() => [localMembership]);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    () => readStringPreference(uiPreferenceKeys.activeWorkspaceId, DEFAULT_WORKSPACE_ID) ?? DEFAULT_WORKSPACE_ID,
  );

  useEffect(() => {
    writePreference(uiPreferenceKeys.activeWorkspaceId, activeWorkspaceId);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (status === "loading") {
      return;
    }

    if (isLocalFallback || !supabase || !user) {
      setMemberships([localMembership]);
      setActiveWorkspaceId((current) => current || DEFAULT_WORKSPACE_ID);
      setWorkspaceError(null);
      return;
    }

    let isMounted = true;

    const loadMemberships = async () => {
      setWorkspaceError(null);

      const { data, error } = await supabase
        .from("workspace_memberships")
        .select("workspace_id,status,workspaces(name),roles(name)")
        .eq("user_id", user.id)
        .eq("status", "active");

      if (!isMounted) {
        return;
      }

      if (error) {
        setWorkspaceError(error.message);
        setMemberships([]);
        return;
      }

      const nextMemberships = ((data ?? []) as unknown[]).map((row) => {
        const typedRow = row as {
          workspace_id: string;
          status: "active" | "invited" | "inactive";
          workspaces?: { name?: string | null } | null;
          roles?: { name?: string | null } | null;
        };

        return {
          workspaceId: typedRow.workspace_id,
          workspaceName: typedRow.workspaces?.name ?? "Workspace",
          roleName: typedRow.roles?.name ?? "Member",
          status: typedRow.status,
          permissions: [],
        };
      });

      setMemberships(nextMemberships);
      setActiveWorkspaceId((current) =>
        nextMemberships.some((membership) => membership.workspaceId === current)
          ? current
          : nextMemberships[0]?.workspaceId ?? "",
      );
    };

    void loadMemberships();

    return () => {
      isMounted = false;
    };
  }, [isLocalFallback, status, supabase, user]);

  const activeMembership =
    memberships.find((membership) => membership.workspaceId === activeWorkspaceId) ?? memberships[0] ?? null;

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      if (!memberships.some((membership) => membership.workspaceId === workspaceId)) {
        return;
      }

      setActiveWorkspaceId(workspaceId);
    },
    [memberships],
  );

  const hasPermission = useCallback(
    (permissionKey: string) =>
      Boolean(activeMembership?.permissions.includes("*") || activeMembership?.permissions.includes(permissionKey)),
    [activeMembership],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      activeWorkspaceId: activeMembership?.workspaceId ?? activeWorkspaceId,
      activeWorkspaceName: activeMembership?.workspaceName ?? "Select workspace",
      memberships,
      activeMembership,
      permissions: activeMembership?.permissions ?? [],
      isWorkspaceReady: status === "authenticated" && Boolean(activeMembership),
      workspaceError,
      switchWorkspace,
      hasPermission,
    }),
    [activeMembership, activeWorkspaceId, hasPermission, memberships, status, switchWorkspace, workspaceError],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = () => {
  const value = useContext(WorkspaceContext);

  if (!value) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }

  return value;
};

export const usePermission = (permissionKey: string) => useWorkspace().hasPermission(permissionKey);
