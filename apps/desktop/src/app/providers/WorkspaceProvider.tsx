import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { DEFAULT_WORKSPACE_ID } from "@contracts";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { readStringPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";

import { useSession } from "./SessionProvider";

export type WorkspaceMembership = {
  workspaceId: string;
  workspaceName: string;
  avatarUrl?: string | null;
  iconColor?: string | null;
  /** ISO-4217 accounting currency of the workspace. Falls back to "USD". */
  baseCurrency: string;
  roleKey: string | null;
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
  isLoadingWorkspaces: boolean;
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
  avatarUrl: null,
  iconColor: null,
  baseCurrency: "USD",
  roleKey: "admin",
  roleName: "Local admin",
  status: "active",
  permissions: ["*"],
};

const toCachedMembership = (workspace: {
  id: string;
  name: string;
  baseCurrency?: string | null;
}): WorkspaceMembership => ({
  workspaceId: workspace.id,
  workspaceName: workspace.name,
  avatarUrl: null,
  iconColor: null,
  baseCurrency: (workspace.baseCurrency ?? "USD").toUpperCase(),
  roleKey: "admin",
  roleName: "Cached access",
  status: "active",
  permissions: ["*"],
});

export const WorkspaceProvider = ({ children }: { children: ReactNode }) => {
  const { status, user, supabase, isLocalFallback } = useSession();
  const [memberships, setMemberships] = useState<WorkspaceMembership[]>(() => []);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(true);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const hasLoadedWorkspacesRef = useRef(false);
  const userId = user?.id ?? null;
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    () => readStringPreference(uiPreferenceKeys.activeWorkspaceId, DEFAULT_WORKSPACE_ID) ?? DEFAULT_WORKSPACE_ID,
  );

  useEffect(() => {
    writePreference(uiPreferenceKeys.activeWorkspaceId, activeWorkspaceId);
  }, [activeWorkspaceId]);

  const refreshWorkspaces = useCallback(async () => {
    if (status === "loading") {
      if (!hasLoadedWorkspacesRef.current) {
        setIsLoadingWorkspaces(true);
      }
      return;
    }

    if (!hasLoadedWorkspacesRef.current) {
      setIsLoadingWorkspaces(true);
    }

    if (isLocalFallback || !supabase || !userId) {
      setMemberships([localMembership]);
      hasLoadedWorkspacesRef.current = true;
      setActiveWorkspaceId((current) => current || DEFAULT_WORKSPACE_ID);
      setWorkspaceError(null);
      setIsLoadingWorkspaces(false);
      return;
    }

    setWorkspaceError(null);

    try {
      let { data, error } = await supabase
        .from("workspace_memberships")
        .select(
          "workspace_id,status,workspaces(name,slug,base_currency,icon_color,avatar_url),roles(key,name,role_permissions(permissions(key)))",
        )
        .eq("user_id", userId)
        .eq("status", "active");

      if (error && /avatar_url/i.test(error.message ?? "")) {
        const fallback = await supabase
          .from("workspace_memberships")
          .select(
            "workspace_id,status,workspaces(name,slug,base_currency,icon_color),roles(key,name,role_permissions(permissions(key)))",
          )
          .eq("user_id", userId)
          .eq("status", "active");
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        throw error;
      }

      const nextMemberships = ((data ?? []) as unknown[]).map((row) => {
        const typedRow = row as {
          workspace_id: string;
          status: "active" | "invited" | "inactive";
          workspaces?: {
            name?: string | null;
            slug?: string | null;
            base_currency?: string | null;
            icon_color?: string | null;
            avatar_url?: string | null;
          } | null;
          roles?: {
            key?: string | null;
            name?: string | null;
            role_permissions?: Array<{ permissions?: { key?: string | null } | null }> | null;
          } | null;
        };

        const permissionKeys = Array.from(
          new Set(
            (typedRow.roles?.role_permissions ?? [])
              .map((entry) => entry?.permissions?.key)
              .filter((key): key is string => typeof key === "string" && key.length > 0),
          ),
        );

        return {
          workspaceId: typedRow.workspace_id,
          workspaceName: typedRow.workspaces?.name ?? "Workspace",
          avatarUrl: typedRow.workspaces?.avatar_url ?? null,
          iconColor: typedRow.workspaces?.icon_color ?? null,
          baseCurrency: (typedRow.workspaces?.base_currency ?? "USD").toUpperCase(),
          roleKey: typedRow.roles?.key ?? null,
          roleName: typedRow.roles?.name ?? "Member",
          status: typedRow.status,
          permissions: permissionKeys,
        };
      });

      await window.bukowskiApp?.ensureLocalWorkspaces(
        nextMemberships.map((membership, index) => {
          const sourceRow = (data ?? [])[index] as
            | {
                workspaces?: {
                  slug?: string | null;
                  base_currency?: string | null;
                  icon_color?: string | null;
                  avatar_url?: string | null;
                } | null;
              }
            | undefined;

          return {
            id: membership.workspaceId,
            name: membership.workspaceName,
            slug: sourceRow?.workspaces?.slug ?? membership.workspaceId,
            baseCurrency: sourceRow?.workspaces?.base_currency ?? "USD",
            iconColor: sourceRow?.workspaces?.icon_color ?? null,
          };
        }),
      );

      setMemberships(nextMemberships);
      hasLoadedWorkspacesRef.current = true;
      setActiveWorkspaceId((current) =>
        nextMemberships.some((membership) => membership.workspaceId === current)
          ? current
          : nextMemberships[0]?.workspaceId ?? "",
      );
      setIsLoadingWorkspaces(false);
    } catch (error) {
      const localWorkspaces = (await window.bukowskiApp?.getLocalWorkspaces?.().catch(() => [])) ?? [];
      const cachedMemberships = localWorkspaces.length > 0 ? localWorkspaces.map(toCachedMembership) : [localMembership];
      const message = getUserFacingErrorMessage(error, "Unable to load remote workspaces.");

      setWorkspaceError(`Supabase no responde ahora mismo. Se cargó el cache local de workspaces. ${message}`);
      setMemberships(cachedMemberships);
      hasLoadedWorkspacesRef.current = true;
      setActiveWorkspaceId((current) =>
        cachedMemberships.some((membership) => membership.workspaceId === current)
          ? current
          : cachedMemberships[0]?.workspaceId ?? current ?? DEFAULT_WORKSPACE_ID,
      );
      setIsLoadingWorkspaces(false);
    }
  }, [isLocalFallback, status, supabase, userId]);

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  useEffect(() => {
    const handleWorkspaceMembershipChange = () => {
      void refreshWorkspaces();
    };

    window.addEventListener("bukowski:workspace-memberships-changed", handleWorkspaceMembershipChange);
    return () => window.removeEventListener("bukowski:workspace-memberships-changed", handleWorkspaceMembershipChange);
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
        const message = getUserFacingErrorMessage(error, "Workspace creation failed.");
        setWorkspaceError(message);
        throw error;
      } finally {
        setIsCreatingWorkspace(false);
      }
    },
    [isLocalFallback, refreshWorkspaces, supabase],
  );

  const activeMembership =
    memberships.find((membership) => membership.workspaceId === activeWorkspaceId) ??
    (isLocalFallback ? memberships[0] ?? null : null);

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
      activeWorkspaceId: activeMembership?.workspaceId ?? (isLocalFallback ? activeWorkspaceId : "__pending-workspace__"),
      activeWorkspaceName: activeMembership?.workspaceName ?? "Select workspace",
      memberships,
      activeMembership,
      permissions: activeMembership?.permissions ?? [],
      isWorkspaceReady: status === "authenticated" && !isLoadingWorkspaces && Boolean(activeMembership),
      isLoadingWorkspaces,
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
      isLoadingWorkspaces,
      isLocalFallback,
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
