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
  isCreatingWorkspace: boolean;
  workspaceError: string | null;
  switchWorkspace: (workspaceId: string) => void;
  refreshWorkspaces: () => Promise<void>;
  createWorkspace: (input: CreateWorkspaceInput) => Promise<string>;
  hasPermission: (permissionKey: string) => boolean;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const readFunctionErrorMessage = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: unknown; message?: unknown };
    const detail =
      typeof payload.error === "string"
        ? payload.error
        : typeof payload.message === "string"
          ? payload.message
          : response.statusText;
    return `Workspace creation failed (${response.status}): ${detail}`;
  } catch {
    return `Workspace creation failed (${response.status}): ${response.statusText}`;
  }
};

export type CreateWorkspaceInput = {
  name: string;
  slug: string;
  baseCurrency: string;
  iconColor?: string | null;
};

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
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    () => readStringPreference(uiPreferenceKeys.activeWorkspaceId, DEFAULT_WORKSPACE_ID) ?? DEFAULT_WORKSPACE_ID,
  );

  useEffect(() => {
    writePreference(uiPreferenceKeys.activeWorkspaceId, activeWorkspaceId);
  }, [activeWorkspaceId]);

  const refreshWorkspaces = useCallback(async () => {
    if (status === "loading") {
      return;
    }

    if (isLocalFallback || !supabase || !user) {
      setMemberships([localMembership]);
      setActiveWorkspaceId((current) => current || DEFAULT_WORKSPACE_ID);
      setWorkspaceError(null);
      return;
    }

    setWorkspaceError(null);

    const { data, error } = await supabase
      .from("workspace_memberships")
      .select("workspace_id,status,workspaces(name),roles(name)")
      .eq("user_id", user.id)
      .eq("status", "active");

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
  }, [isLocalFallback, status, supabase, user]);

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  const createWorkspace = useCallback(
    async (input: CreateWorkspaceInput) => {
      if (isLocalFallback || !supabase) {
        throw new Error("Supabase is not configured. Workspace creation is disabled in local-dev fallback mode.");
      }

      const name = input.name.trim();
      const slug = input.slug.trim().toLowerCase();
      const baseCurrency = input.baseCurrency.trim().toUpperCase();

      if (!name || !slug || !baseCurrency) {
        throw new Error("Workspace name, slug and currency are required.");
      }

      setIsCreatingWorkspace(true);
      setWorkspaceError(null);

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;

        if (sessionError || !accessToken) {
          throw new Error(sessionError?.message ?? "An authenticated session is required to create a workspace.");
        }

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, "");
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !anonKey) {
          throw new Error("Supabase is not configured. Workspace creation requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
        }

        const response = await fetch(`${supabaseUrl}/functions/v1/admin-workspace-bootstrap`, {
          method: "POST",
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name,
            slug,
            baseCurrency,
            iconColor: input.iconColor?.trim() || null,
          }),
        });

        if (!response.ok) {
          await refreshWorkspaces();
          throw new Error(await readFunctionErrorMessage(response));
        }

        const data = (await response.json()) as unknown;

        const workspaceId =
          data && typeof data === "object" && "workspaceId" in data && typeof data.workspaceId === "string"
            ? data.workspaceId
            : null;

        if (!workspaceId) {
          throw new Error("Workspace was created but the response did not include a workspace id.");
        }

        await refreshWorkspaces();
        setActiveWorkspaceId(workspaceId);
        return workspaceId;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Workspace creation failed.";
        setWorkspaceError(message);
        throw error;
      } finally {
        setIsCreatingWorkspace(false);
      }
    },
    [isLocalFallback, refreshWorkspaces, supabase],
  );

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
      isCreatingWorkspace,
      workspaceError,
      switchWorkspace,
      refreshWorkspaces,
      createWorkspace,
      hasPermission,
    }),
    [
      activeMembership,
      activeWorkspaceId,
      createWorkspace,
      hasPermission,
      isCreatingWorkspace,
      memberships,
      refreshWorkspaces,
      status,
      switchWorkspace,
      workspaceError,
    ],
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
