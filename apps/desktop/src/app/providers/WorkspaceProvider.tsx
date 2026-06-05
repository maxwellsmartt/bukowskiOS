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
  isSessionExpired: boolean;
  workspaceError: string | null;
  switchWorkspace: (workspaceId: string) => void;
  refreshWorkspaces: () => Promise<void>;
  createWorkspace: (input: CreateWorkspaceInput) => Promise<string>;
  hasPermission: (permissionKey: string) => boolean;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

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

// Heuristic: did this failure come from an invalid/expired session rather than a
// transient network/server hiccup? Auth failures must route to "session expired"
// messaging (and a re-login CTA), never to the misleading "no workspace access".
const isAuthLikeError = (error: unknown) => {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return (
    message.includes("jwt") ||
    message.includes("expired") ||
    message.includes("401") ||
    message.includes("403") ||
    message.includes("unauthorized") ||
    message.includes("invalid token") ||
    message.includes("invalid_token") ||
    message.includes("not authenticated") ||
    message.includes("pgrst301") ||
    message.includes("authsessionmissing")
  );
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
  const { status, user, supabase, isLocalFallback, verifySessionActive } = useSession();
  const [memberships, setMemberships] = useState<WorkspaceMembership[]>(() => []);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isSessionExpired, setIsSessionExpired] = useState(false);
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

    // True local-dev fallback (no Supabase configured): expose a single synthetic
    // local workspace so the app is usable offline.
    if (isLocalFallback || !supabase) {
      setMemberships([localMembership]);
      hasLoadedWorkspacesRef.current = true;
      setActiveWorkspaceId((current) => current || DEFAULT_WORKSPACE_ID);
      setWorkspaceError(null);
      setIsSessionExpired(false);
      setIsLoadingWorkspaces(false);
      return;
    }

    // Supabase is configured but there is no authenticated user yet (login screen
    // or just signed out). Stay in a not-ready, loading state with NO memberships
    // so a successful login resolves the real workspace before the app interior
    // (or the empty-state picker) can render — this is what prevents the brief
    // flash of the app interior right after login.
    if (!userId) {
      hasLoadedWorkspacesRef.current = false;
      setMemberships([]);
      setWorkspaceError(null);
      setIsSessionExpired(false);
      setIsLoadingWorkspaces(true);
      return;
    }

    setWorkspaceError(null);
    setIsSessionExpired(false);

    try {
      let { data, error } = await supabase
        .from("workspace_memberships")
        .select(
          "workspace_id,status,workspaces(name,slug,base_currency,icon_color,avatar_url),roles!workspace_memberships_workspace_role_fk(key,name,role_permissions(permissions(key)))",
        )
        .eq("user_id", userId)
        .eq("status", "active");

      if (error && /avatar_url/i.test(error.message ?? "")) {
        const fallback = await supabase
          .from("workspace_memberships")
          .select(
            "workspace_id,status,workspaces(name,slug,base_currency,icon_color),roles!workspace_memberships_workspace_role_fk(key,name,role_permissions(permissions(key)))",
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

      // Zero rows with no error is ambiguous: either the user genuinely has no
      // membership, or the request ran unauthenticated because the session
      // expired (RLS then returns an empty set, not an error). Probe the stored
      // token so the picker shows the right message instead of always "no access".
      if (nextMemberships.length === 0) {
        setIsSessionExpired(!(await verifySessionActive()));
      } else {
        setIsSessionExpired(false);
      }

      setMemberships(nextMemberships);
      hasLoadedWorkspacesRef.current = true;
      setActiveWorkspaceId((current) =>
        nextMemberships.some((membership) => membership.workspaceId === current)
          ? current
          : nextMemberships[0]?.workspaceId ?? "",
      );
      setIsLoadingWorkspaces(false);
    } catch (error) {
      // An auth/expired-session failure must not masquerade as an offline cache
      // load: surface "session expired" with empty memberships and let the picker
      // route the user back to login.
      if (isAuthLikeError(error) && !(await verifySessionActive())) {
        setIsSessionExpired(true);
        setWorkspaceError(null);
        setMemberships([]);
        hasLoadedWorkspacesRef.current = true;
        setIsLoadingWorkspaces(false);
        return;
      }

      const localWorkspaces = (await window.bukowskiApp?.getLocalWorkspaces?.().catch(() => [])) ?? [];
      const cachedMemberships = localWorkspaces.length > 0 ? localWorkspaces.map(toCachedMembership) : [localMembership];
      const message = getUserFacingErrorMessage(error, "Unable to load remote workspaces.");

      setIsSessionExpired(false);
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
  }, [isLocalFallback, status, supabase, userId, verifySessionActive]);

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
        if (!window.bukowskiApp?.createRemoteWorkspace) {
          throw new Error("The secure workspace bridge is unavailable.");
        }

        const data = await window.bukowskiApp.createRemoteWorkspace({
          name,
          slug,
          baseCurrency,
          iconColor: input.iconColor?.trim() || null,
        });
        const workspaceId = data?.workspaceId ?? null;

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
      isSessionExpired,
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
      isSessionExpired,
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
