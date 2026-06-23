import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bot, Camera, Check, ChevronDown, Copy, Pencil, Save, Send, Trash2, X } from "lucide-react";

import type { AppUserAdminRow, AppUsersSnapshot } from "@contracts";
import { useSession } from "@app/providers/SessionProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useLocale } from "@shared/hooks/useLocale";
import { copyToClipboard } from "@shared/lib/clipboard";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { hasFinanceAccess } from "@shared/lib/financeAccess";

import { CurrencySettingsCard } from "./CurrencySettingsCard";
import { DocumentsFolderCard } from "./DocumentsFolderCard";
import { CustomRolesEditor } from "./CustomRolesEditor";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { NcfSettingsCard } from "./NcfSettingsCard";
import { SettingsLayout } from "./SettingsLayout";
import { WorkspaceBrandingCard } from "./WorkspaceBrandingCard";
import {
  revokeWorkspaceInvite,
  sendWorkspaceInvite,
  setMemberStatus,
  updateMemberRole,
} from "./inviteService";

const emptyUsersSnapshot: AppUsersSnapshot = { users: [], roles: [] };

type PendingInviteRow = {
  id: string;
  email: string;
  roleId: string | null;
  roleName: string;
  invitedAt: string | null;
};

type SystemActorRow = {
  id: string;
  name: string;
  email: string | null;
  kind: string;
  status: "active" | "paused" | "inactive";
  description: string | null;
  permissionKeys: string[];
};

const workspaceAvatarAcceptedTypes = /^image\/(png|jpeg|webp|svg\+xml)$/;
const workspaceAvatarAcceptedExtensions = new Set(["png", "jpg", "jpeg", "webp", "svg"]);
const workspaceAvatarMaxBytes = 8 * 1024 * 1024;
const workspaceAccentColorPattern = /^#[0-9a-fA-F]{6}$/;

const resolveMembershipTone = (status: AppUserAdminRow["membershipStatus"]) => {
  if (status === "active") {
    return "success" as const;
  }

  if (status === "inactive") {
    return "warning" as const;
  }

  return "neutral" as const;
};

/** Returns the i18n key suffix for the membership label. Translate at call site. */
const membershipLabelKey = (status: AppUserAdminRow["membershipStatus"]): "active" | "inactive" | "missing" => {
  if (status === "active") return "active";
  if (status === "inactive") return "inactive";
  return "missing";
};

const resolveSystemActorTone = (status: SystemActorRow["status"]) => {
  if (status === "active") {
    return "success" as const;
  }

  if (status === "paused") {
    return "warning" as const;
  }

  return "neutral" as const;
};

const toPermissionKeys = (rolePermissions: unknown) =>
  Array.from(
    new Set(
      (Array.isArray(rolePermissions) ? rolePermissions : [])
        .map((entry) => {
          const typed = entry as { permissions?: { key?: unknown } | null };
          return typeof typed.permissions?.key === "string" ? typed.permissions.key : null;
        })
        .filter((key): key is string => Boolean(key)),
    ),
  ).sort((left, right) => left.localeCompare(right));

const loadRemoteUsersSnapshot = async (
  supabase: NonNullable<ReturnType<typeof useSession>["supabase"]>,
  workspaceId: string,
): Promise<AppUsersSnapshot> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const looseSupabase = supabase as any;
  const { data: rolesData, error: rolesError } = await looseSupabase
    .from("roles")
    .select("id,key,name,description,is_system_role,role_permissions(permissions(key))")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });

  if (rolesError) {
    throw rolesError;
  }

  const { data: membershipsData, error: membershipsError } = await looseSupabase
    .from("workspace_memberships")
    .select("id,user_id,status,role_id,roles!workspace_memberships_workspace_role_fk(key,name,role_permissions(permissions(key)))")
    .eq("workspace_id", workspaceId)
    .in("status", ["active", "inactive", "invited"]);

  if (membershipsError) {
    throw membershipsError;
  }

  const userIds = Array.from(
    new Set(
      ((membershipsData ?? []) as Array<{ user_id?: string | null }>)
        .map((row) => row.user_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const profilesByUserId = new Map<string, { email: string; fullName: string; phone: string }>();

  if (userIds.length > 0) {
    const { data: profilesData, error: profilesError } = await looseSupabase
      .from("user_profiles")
      .select("user_id,email,full_name,phone")
      .in("user_id", userIds);

    if (profilesError) {
      throw profilesError;
    }

    for (const profile of (profilesData ?? []) as Array<{
      user_id?: string | null;
      email?: string | null;
      full_name?: string | null;
      phone?: string | null;
    }>) {
      if (!profile.user_id) {
        continue;
      }

      profilesByUserId.set(profile.user_id, {
        email: profile.email ?? "",
        fullName: profile.full_name ?? profile.email ?? "Workspace member",
        phone: profile.phone ?? "",
      });
    }
  }

  const assignedCounts = new Map<string, number>();
  for (const membership of (membershipsData ?? []) as Array<{ role_id?: string | null }>) {
    if (membership.role_id) {
      assignedCounts.set(membership.role_id, (assignedCounts.get(membership.role_id) ?? 0) + 1);
    }
  }

  const roles = ((rolesData ?? []) as Array<{
    id: string;
    key: string;
    name: string;
    description?: string | null;
    is_system_role?: boolean | null;
    role_permissions?: unknown;
  }>).map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description ?? "",
    isSystemRole: Boolean(role.is_system_role),
    permissionKeys: toPermissionKeys(role.role_permissions),
    assignedUserCount: assignedCounts.get(role.id) ?? 0,
  }));

  const users = ((membershipsData ?? []) as Array<{
    user_id: string;
    status: "active" | "inactive" | "invited";
    role_id: string | null;
    roles?: {
      key?: string | null;
      name?: string | null;
      role_permissions?: unknown;
    } | null;
  }>).map((membership) => {
    const profile = profilesByUserId.get(membership.user_id);
    const membershipStatus =
      membership.status === "active" || membership.status === "inactive" ? membership.status : "missing";

    return {
      id: membership.user_id,
      fullName: profile?.fullName ?? "Workspace member",
      email: profile?.email ?? "",
      phone: profile?.phone ?? "",
      isActive: membership.status === "active",
      membershipStatus,
      roleId: membership.role_id,
      roleKey: membership.roles?.key ?? null,
      roleName: membership.roles?.name ?? null,
      permissionKeys: toPermissionKeys(membership.roles?.role_permissions),
      linkedCrewId: null,
      linkedCrewLabel: null,
      telegramAccountId: null,
      telegramLinkStatus: "none" as const,
      telegramDisplayName: null,
      telegramUsername: null,
      telegramExternalUserId: null,
      telegramLinkedAt: null,
      telegramLastSeenAt: null,
      readyForTelegram: membership.status === "active" && Boolean(membership.role_id),
    } satisfies AppUserAdminRow;
  });

  return { roles, users };
};

const loadRemoteSystemActors = async (
  supabase: NonNullable<ReturnType<typeof useSession>["supabase"]>,
  workspaceId: string,
): Promise<SystemActorRow[]> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const looseSupabase = supabase as any;
  const { data, error } = await looseSupabase
    .from("workspace_system_actors")
    .select("id,name,email,kind,status,description,workspace_system_actor_permissions(permissions(key))")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as Array<{
    id: string;
    name?: string | null;
    email?: string | null;
    kind?: string | null;
    status?: "active" | "paused" | "inactive" | null;
    description?: string | null;
    workspace_system_actor_permissions?: unknown;
  }>).map((actor) => ({
    id: actor.id,
    name: actor.name ?? "System actor",
    email: actor.email ?? null,
    kind: actor.kind ?? "agent",
    status: actor.status ?? "active",
    description: actor.description ?? null,
    permissionKeys: toPermissionKeys(actor.workspace_system_actor_permissions),
  }));
};

type WorkspaceDisclosureProps = {
  children: ReactNode;
  defaultOpen?: boolean;
  summary: string;
  title: string;
};

const WorkspaceDisclosure = ({ children, defaultOpen = false, summary, title }: WorkspaceDisclosureProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className={`workspace-disclosure${isOpen ? " is-open" : ""}`}>
      <button
        aria-expanded={isOpen}
        className="workspace-disclosure-trigger"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span>
          <strong>{title}</strong>
          <small>{summary}</small>
        </span>
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      {isOpen ? <div className="workspace-disclosure-body">{children}</div> : null}
    </section>
  );
};

type WorkspaceSettingsPageProps = {
  /** "access" renders only the members/invites/roles blocks, for embedding
   *  inside the Equipo y acceso settings section. */
  variant?: "workspace" | "access";
};

export const WorkspaceSettingsPage = ({ variant = "workspace" }: WorkspaceSettingsPageProps) => {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { supabase, isLocalFallback, user: sessionUser } = useSession();
  const { activeWorkspaceId, activeWorkspaceName, activeMembership, memberships, refreshWorkspaces } = useWorkspace();
  const canAccessFinance = hasFinanceAccess(activeMembership);
  const { formatDate } = useLocale();
  const workspaceAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const [usersSnapshot, setUsersSnapshot] = useState<AppUsersSnapshot>(emptyUsersSnapshot);
  const [pendingInvites, setPendingInvites] = useState<PendingInviteRow[]>([]);
  const [systemActors, setSystemActors] = useState<SystemActorRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [workspaceProfile, setWorkspaceProfile] = useState<{
    name: string;
    slug: string;
    baseCurrency: string;
    iconColor: string | null;
    avatarUrl: string | null;
  } | null>(null);
  const [isEditingWorkspace, setIsEditingWorkspace] = useState(false);
  const [workspaceDraft, setWorkspaceDraft] = useState({ name: "", baseCurrency: "USD", iconColor: "", avatarUrl: "" });
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [isUploadingWorkspaceAvatar, setIsUploadingWorkspaceAvatar] = useState(false);
  const [copiedWorkspaceId, setCopiedWorkspaceId] = useState(false);

  const loadPendingInvites = useCallback(async () => {
    if (!supabase || isLocalFallback) {
      setPendingInvites([]);
      return;
    }

    try {
      // Load memberships and profiles separately; embedded profile joins can be hidden
      // by RLS and made pending invites look empty even when the invite exists.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const looseSupabase = supabase as any;
      const { data, error: queryError } = await looseSupabase
        .from("workspace_memberships")
        .select("id,user_id,invited_at,role_id,roles!workspace_memberships_workspace_role_fk(name)")
        .eq("workspace_id", activeWorkspaceId)
        .eq("status", "invited");

      if (queryError) {
        throw queryError;
      }

      const inviteRows = (data ?? []) as Array<{
        id: string;
        user_id: string | null;
        invited_at: string | null;
        role_id: string | null;
        roles?: { name?: string | null } | null;
      }>;
      const inviteUserIds = inviteRows.map((row) => row.user_id).filter((value): value is string => Boolean(value));
      const profilesByUserId = new Map<string, string>();

      if (inviteUserIds.length > 0) {
        const { data: profilesData } = await looseSupabase
          .from("user_profiles")
          .select("user_id,email")
          .in("user_id", inviteUserIds);

        for (const profile of (profilesData ?? []) as Array<{ user_id?: string | null; email?: string | null }>) {
          if (profile.user_id && profile.email) {
            profilesByUserId.set(profile.user_id, profile.email);
          }
        }
      }

      const rows = inviteRows.map((row) => {
        const typed = row as {
          id: string;
          user_id: string | null;
          invited_at: string | null;
          role_id: string | null;
          roles?: { name?: string | null } | null;
        };

        return {
          id: typed.id,
          email: typed.user_id ? profilesByUserId.get(typed.user_id) ?? "Pending" : "Pending",
          roleId: typed.role_id,
          roleName: typed.roles?.name ?? "Member",
          invitedAt: typed.invited_at,
        } satisfies PendingInviteRow;
      });

      setPendingInvites(rows);
    } catch (nextError) {
      // Pending invites are optional — silently degrade
      setPendingInvites([]);
      // eslint-disable-next-line no-console
      console.warn("Could not load pending invites", nextError);
    }
  }, [activeWorkspaceId, isLocalFallback, supabase]);

  const loadMembers = useCallback(async () => {
    if (supabase && !isLocalFallback) {
      try {
        const next = await loadRemoteUsersSnapshot(supabase, activeWorkspaceId);
        setUsersSnapshot(next);
        setError(null);
      } catch (nextError) {
        setError(getUserFacingErrorMessage(nextError, "Could not load remote workspace members."));
      }
      return;
    }

    if (!window.bukowskiApp) {
      return;
    }

    try {
      const next = await window.bukowskiApp.getUsersSnapshot({ workspaceId: activeWorkspaceId });
      setUsersSnapshot(next);
      setError(null);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "Could not load workspace members."));
    }
  }, [activeWorkspaceId, isLocalFallback, supabase]);

  const loadSystemActors = useCallback(async () => {
    if (!supabase || isLocalFallback || !activeWorkspaceId) {
      setSystemActors([]);
      return;
    }

    try {
      const next = await loadRemoteSystemActors(supabase, activeWorkspaceId);
      setSystemActors(next);
    } catch (nextError) {
      setSystemActors([]);
      // System actors are additive during rollout. If the migration has not
      // landed yet, Team should still remain usable for human members.
      // eslint-disable-next-line no-console
      console.warn("Could not load workspace system actors", nextError);
    }
  }, [activeWorkspaceId, isLocalFallback, supabase]);

  const loadWorkspaceProfile = useCallback(async () => {
    if (!supabase || isLocalFallback || !activeWorkspaceId) {
      setWorkspaceProfile(null);
      return;
    }

    try {
      let { data, error: queryError } = await supabase
        .from("workspaces")
        .select("name,slug,base_currency,icon_color,avatar_url")
        .eq("id", activeWorkspaceId)
        .maybeSingle();

      if (queryError && /avatar_url/i.test(queryError.message ?? "")) {
        const fallback = await supabase
          .from("workspaces")
          .select("name,slug,base_currency,icon_color")
          .eq("id", activeWorkspaceId)
          .maybeSingle();
        data = fallback.data;
        queryError = fallback.error;
      }

      if (queryError || !data) {
        setWorkspaceProfile(null);
        return;
      }

      const profile = {
        name: (data as { name?: string }).name ?? "",
        slug: (data as { slug?: string }).slug ?? "",
        baseCurrency: (data as { base_currency?: string }).base_currency ?? "USD",
        iconColor: (data as { icon_color?: string | null }).icon_color ?? null,
        avatarUrl: (data as { avatar_url?: string | null }).avatar_url ?? null,
      };

      setWorkspaceProfile(profile);
      setWorkspaceDraft({
        name: profile.name,
        baseCurrency: profile.baseCurrency,
        iconColor: profile.iconColor ?? "",
        avatarUrl: profile.avatarUrl ?? "",
      });
    } catch {
      setWorkspaceProfile(null);
    }
  }, [activeWorkspaceId, isLocalFallback, supabase]);

  useEffect(() => {
    void loadMembers();
    void loadPendingInvites();
    void loadSystemActors();
    void loadWorkspaceProfile();
  }, [loadMembers, loadPendingInvites, loadSystemActors, loadWorkspaceProfile]);

  useEffect(
    () => () => {
      if (copyFeedbackTimeoutRef.current) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    },
    [],
  );

  const persistWorkspaceIdentity = async (updates: { avatarUrl?: string | null; iconColor?: string | null }) => {
    if (!workspaceProfile) {
      return;
    }

    const nextProfile = {
      ...workspaceProfile,
      avatarUrl: updates.avatarUrl !== undefined ? updates.avatarUrl : workspaceProfile.avatarUrl,
      iconColor: updates.iconColor !== undefined ? updates.iconColor : workspaceProfile.iconColor,
    };

    if (!window.bukowskiApp?.updateRemoteWorkspaceIdentity) {
      throw new Error("The secure workspace bridge is unavailable.");
    }

    await window.bukowskiApp.updateRemoteWorkspaceIdentity({
      workspaceId: activeWorkspaceId,
      ...(updates.avatarUrl !== undefined ? { avatarUrl: nextProfile.avatarUrl } : {}),
      ...(updates.iconColor !== undefined ? { iconColor: nextProfile.iconColor } : {}),
    });

    setWorkspaceProfile(nextProfile);
    setWorkspaceDraft((current) => ({
      ...current,
      avatarUrl: nextProfile.avatarUrl ?? "",
      iconColor: nextProfile.iconColor ?? "",
    }));
    await refreshWorkspaces();
  };

  const handleSaveWorkspace = async () => {
    if (!supabase || !workspaceProfile) {
      return;
    }

    const nextName = workspaceDraft.name.trim();
    const nextBaseCurrency = workspaceDraft.baseCurrency.trim().toUpperCase();
    const nextIconColor = workspaceDraft.iconColor.trim() || null;
    const nextAvatarUrl = workspaceDraft.avatarUrl.trim() || null;

    if (!nextName || !nextBaseCurrency) {
      toast.error(t("settings.workspace.toasts.cannotSave"), t("settings.workspace.toasts.requireNameCurrency"));
      return;
    }

    if (nextIconColor && !workspaceAccentColorPattern.test(nextIconColor)) {
      toast.error(t("settings.workspace.toasts.cannotSave"), t("settings.workspace.toasts.invalidAccent"));
      return;
    }

    setIsSavingWorkspace(true);

    try {
      if (!window.bukowskiApp?.updateRemoteWorkspaceIdentity) {
        throw new Error("The secure workspace bridge is unavailable.");
      }

      await window.bukowskiApp.updateRemoteWorkspaceIdentity({
        workspaceId: activeWorkspaceId,
        name: nextName,
        baseCurrency: nextBaseCurrency,
        iconColor: nextIconColor,
        ...(workspaceProfile.avatarUrl !== null || nextAvatarUrl !== null ? { avatarUrl: nextAvatarUrl } : {}),
      });

      toast.success(t("settings.workspace.toasts.updatedTitle"), t("settings.workspace.toasts.updatedBody"));
      setIsEditingWorkspace(false);
      await Promise.all([loadWorkspaceProfile(), refreshWorkspaces()]);
    } catch (nextError) {
      toast.error(t("common.couldNotSave"), getUserFacingErrorMessage(nextError, t("common.tryAgain")));
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const handleWorkspaceAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!supabase) {
      toast.error(t("settings.workspace.toasts.signInRequiredTitle"), t("settings.workspace.toasts.signInRequiredBody"));
      return;
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const hasSupportedMime = file.type ? workspaceAvatarAcceptedTypes.test(file.type) : false;
    const hasSupportedExtension = workspaceAvatarAcceptedExtensions.has(ext);

    if (!hasSupportedMime && !hasSupportedExtension) {
      toast.error(t("settings.workspace.toasts.unsupportedFormatTitle"), t("settings.workspace.toasts.unsupportedFormatBody"));
      return;
    }

    if (file.size > workspaceAvatarMaxBytes) {
      toast.error(t("settings.workspace.toasts.fileTooLargeTitle"), t("settings.workspace.toasts.fileTooLargeBody"));
      return;
    }

    setIsUploadingWorkspaceAvatar(true);

    try {
      if (!window.bukowskiApp?.uploadWorkspaceImageAsset) {
        throw new Error("The secure workspace image upload bridge is unavailable.");
      }

      const { publicUrl } = await window.bukowskiApp.uploadWorkspaceImageAsset({
        workspaceId: activeWorkspaceId,
        assetKind: "avatar",
        fileName: file.name,
        contentType: file.type || (ext === "svg" ? "image/svg+xml" : ""),
        bytes: await file.arrayBuffer(),
      });
      if (isEditingWorkspace) {
        setWorkspaceDraft((current) => ({ ...current, avatarUrl: publicUrl }));
        toast.success(t("settings.workspace.toasts.avatarReadyTitle"), t("settings.workspace.toasts.avatarReadyBody"));
      } else {
        await persistWorkspaceIdentity({ avatarUrl: publicUrl });
        toast.success(t("settings.workspace.toasts.avatarUpdatedTitle"), t("settings.workspace.toasts.avatarUpdatedBody"));
      }
    } catch (nextError) {
      toast.error(t("settings.workspace.toasts.uploadFailedTitle"), getUserFacingErrorMessage(nextError, t("settings.workspace.toasts.uploadFailedBody")));
    } finally {
      setIsUploadingWorkspaceAvatar(false);
    }
  };

  const handleWorkspaceAvatarRemove = async () => {
    if (isEditingWorkspace) {
      setWorkspaceDraft((current) => ({ ...current, avatarUrl: "" }));
      return;
    }

    try {
      await persistWorkspaceIdentity({ avatarUrl: null });
      toast.success(t("settings.workspace.toasts.avatarRemovedTitle"), t("settings.workspace.toasts.avatarRemovedBody"));
    } catch (nextError) {
      toast.error(t("settings.workspace.toasts.couldNotRemoveAvatar"), getUserFacingErrorMessage(nextError, t("common.tryAgain")));
    }
  };

  const handleWorkspaceAccentColorPreview = (nextColor: string) => {
    setWorkspaceDraft((current) => ({ ...current, iconColor: nextColor }));
    if (!isEditingWorkspace) {
      setWorkspaceProfile((current) => (current ? { ...current, iconColor: nextColor } : current));
    }
  };

  const handleWorkspaceAccentColorCommit = async (nextColor: string) => {
    if (isEditingWorkspace || !workspaceAccentColorPattern.test(nextColor)) {
      return;
    }

    try {
      await persistWorkspaceIdentity({ iconColor: nextColor });
    } catch (nextError) {
      toast.error(t("settings.workspace.toasts.couldNotUpdateColor"), getUserFacingErrorMessage(nextError, t("common.tryAgain")));
      await loadWorkspaceProfile();
    }
  };

  const handleCopyWorkspaceId = async () => {
    try {
      await copyToClipboard(activeWorkspaceId);
      setCopiedWorkspaceId(true);
      if (copyFeedbackTimeoutRef.current) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
      copyFeedbackTimeoutRef.current = window.setTimeout(() => setCopiedWorkspaceId(false), 1800);
    } catch (nextError) {
      toast.error(t("settings.workspace.toasts.couldNotCopy"), getUserFacingErrorMessage(nextError, t("settings.workspace.toasts.copyIdManually")));
    }
  };

  const teamMembers = usersSnapshot.users.filter((user) => user.membershipStatus !== "missing");
  const inviteRolesForDialog = usersSnapshot.roles;

  const handleChangeMemberRole = async (member: AppUserAdminRow, nextRoleId: string) => {
    if (!supabase || !nextRoleId || nextRoleId === member.roleId) {
      return;
    }
    try {
      await updateMemberRole(supabase, {
        workspaceId: activeWorkspaceId,
        userId: member.id,
        roleId: nextRoleId,
      });
      toast.success(
        t("settings.workspace.toasts.roleUpdatedTitle"),
        t("settings.workspace.toasts.roleUpdatedBody", { user: member.fullName || member.email }),
      );
      await loadMembers();
    } catch (nextError) {
      toast.error(t("settings.workspace.toasts.couldNotChangeRole"), getUserFacingErrorMessage(nextError, t("common.tryAgain")));
    }
  };

  const handleToggleMemberStatus = async (member: AppUserAdminRow) => {
    if (!supabase) return;
    const nextStatus: "active" | "inactive" = member.membershipStatus === "active" ? "inactive" : "active";
    try {
      await setMemberStatus(supabase, {
        workspaceId: activeWorkspaceId,
        userId: member.id,
        status: nextStatus,
      });
      toast.success(
        nextStatus === "inactive"
          ? t("settings.workspace.toasts.memberSuspendedTitle")
          : t("settings.workspace.toasts.memberReactivatedTitle"),
        t(`settings.workspace.toasts.memberStatusBody_${nextStatus === "inactive" ? "suspended" : "active"}`, {
          user: member.fullName || member.email,
        }),
      );
      await loadMembers();
    } catch (nextError) {
      toast.error(t("settings.workspace.toasts.couldNotChangeStatus"), getUserFacingErrorMessage(nextError, t("common.tryAgain")));
    }
  };

  const handleResendInvite = async (invite: PendingInviteRow) => {
    if (!supabase || !invite.roleId) {
      toast.error(t("settings.workspace.toasts.cannotResendTitle"), t("settings.workspace.toasts.cannotResendBody"));
      return;
    }

    try {
      await sendWorkspaceInvite(supabase, {
        workspaceId: activeWorkspaceId,
        email: invite.email,
        roleId: invite.roleId,
      });
      toast.success(
        t("settings.workspace.toasts.inviteResentTitle"),
        t("settings.workspace.toasts.inviteResentBody", { email: invite.email }),
      );
      await loadPendingInvites();
    } catch (nextError) {
      toast.error(t("settings.workspace.toasts.couldNotResend"), getUserFacingErrorMessage(nextError, t("common.tryAgain")));
    }
  };

  const handleRevokeInvite = async (invite: PendingInviteRow) => {
    if (!supabase) {
      return;
    }

    try {
      await revokeWorkspaceInvite(supabase, { workspaceId: activeWorkspaceId, membershipId: invite.id });
      toast.success(
        t("settings.workspace.toasts.inviteRevokedTitle"),
        t("settings.workspace.toasts.inviteRevokedBody", { email: invite.email }),
      );
      await loadPendingInvites();
    } catch (nextError) {
      toast.error(t("settings.workspace.toasts.couldNotRevoke"), getUserFacingErrorMessage(nextError, t("common.tryAgain")));
    }
  };

  const accessSections = (
    <>
      <span className="settings-group-label">{t("settings.team.groups.people")}</span>
      <WorkspaceDisclosure
        defaultOpen
        title={t("settings.workspace.sections.members")}
        summary={t("settings.workspace.summaries.membersCount", {
          count: teamMembers.length,
          active: teamMembers.filter((member) => member.membershipStatus === "active").length,
        })}
      >
        <SurfaceCard
          aside={
            <button
              className="action-primary-button"
              disabled={isLocalFallback || !inviteRolesForDialog.length}
              data-tooltip={isLocalFallback ? t("settings.workspace.members.inviteDisabledTooltip") : undefined}
              onClick={() => setInviteOpen(true)}
              type="button"
            >
              <Send size={14} />
              <span>{t("settings.workspace.members.invite")}</span>
            </button>
          }
        >
          <DataTable
            getRowId={(row) => row.id}
            maxHeight="min(48vh, 540px)"
            persistKey="workspace-settings-members"
            columns={[
              {
                key: "person",
                label: t("settings.workspace.members.column.member"),
                render: (row) => (
                  <div className="identity-cell">
                    <span className="identity-title">{row.fullName}</span>
                    <span className="identity-meta">{row.email || t("settings.workspace.members.emailPending")}</span>
                  </div>
                ),
              },
              {
                key: "role",
                label: t("settings.workspace.members.column.role"),
                render: (row) => {
                  const isSelf = row.id === sessionUser?.id;
                  const canEdit = !isLocalFallback && Boolean(supabase) && !isSelf;
                  if (!canEdit) {
                    return <span>{row.roleName ?? t("settings.account.member")}</span>;
                  }
                  return (
                    <select
                      className="field-input field-input-inline"
                      onChange={(event) => void handleChangeMemberRole(row, event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      value={row.roleId ?? ""}
                    >
                      {usersSnapshot.roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  );
                },
              },
              {
                key: "status",
                label: t("settings.workspace.members.column.membership"),
                render: (row) => (
                  <StatusBadge tone={resolveMembershipTone(row.membershipStatus)}>
                    {t(`settings.workspace.members.membership.${membershipLabelKey(row.membershipStatus)}`)}
                  </StatusBadge>
                ),
              },
              {
                key: "permissions",
                label: t("settings.workspace.members.column.permissions"),
                align: "right",
                render: (row) =>
                  row.roleName?.toLowerCase().includes("admin")
                    ? t("settings.workspace.generalInfo.fullAccess")
                    : row.permissionKeys.length,
              },
              {
                key: "actions",
                label: t("settings.workspace.members.column.actions"),
                align: "right",
                render: (row) => {
                  const isSelf = row.id === sessionUser?.id;
                  if (isSelf || isLocalFallback || !supabase) {
                    return null;
                  }
                  const isActive = row.membershipStatus === "active";
                  return (
                    <button
                      className={`ghost-control${isActive ? " is-danger" : ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleToggleMemberStatus(row);
                      }}
                      type="button"
                    >
                      {isActive ? t("settings.workspace.members.suspend") : t("settings.workspace.members.reactivate")}
                    </button>
                  );
                },
              },
            ]}
            rows={teamMembers}
            emptyMessage={t("settings.workspace.members.empty")}
          />
        </SurfaceCard>
      </WorkspaceDisclosure>

      <WorkspaceDisclosure
        title={t("settings.workspace.sections.pendingInvites")}
        summary={
          pendingInvites.length
            ? t("settings.workspace.summaries.pending", { count: pendingInvites.length })
            : t("settings.workspace.summaries.noPending")
        }
      >
        <SurfaceCard>
          {pendingInvites.length === 0 ? (
            <p className="surface-card-subtitle">
              {t("settings.workspace.invites.empty")}
            </p>
          ) : (
            <DataTable
              getRowId={(row) => row.id}
              persistKey="workspace-settings-pending-invites"
              columns={[
                { key: "email", label: t("settings.workspace.invites.column.email"), render: (row) => row.email },
                { key: "role", label: t("settings.workspace.invites.column.role"), render: (row) => row.roleName },
                {
                  key: "invitedAt",
                  label: t("settings.workspace.invites.column.invited"),
                  render: (row) =>
                    row.invitedAt ? formatDate(row.invitedAt) : t("settings.workspace.invites.pendingFallback"),
                },
                {
                  key: "actions",
                  label: t("settings.workspace.invites.column.actions"),
                  align: "right",
                  render: (row) => (
                    <div className="surface-card-actions" style={{ justifyContent: "flex-end" }}>
                      <button
                        className="ghost-control"
                        disabled={!row.roleId}
                        onClick={() => void handleResendInvite(row)}
                        type="button"
                      >
                        {t("settings.workspace.invites.resend")}
                      </button>
                      <button
                        className="ghost-control is-danger"
                        onClick={() => void handleRevokeInvite(row)}
                        type="button"
                      >
                        {t("settings.workspace.invites.revoke")}
                      </button>
                    </div>
                  ),
                },
              ]}
              rows={pendingInvites}
              emptyMessage={t("settings.workspace.invites.emptyTable")}
            />
          )}
        </SurfaceCard>
      </WorkspaceDisclosure>

      {supabase && !isLocalFallback ? (
        <>
        <span className="settings-group-label">{t("settings.team.groups.roles")}</span>
        <WorkspaceDisclosure
          title={t("settings.workspace.sections.roles")}
          summary={t("settings.workspace.summaries.rolesCount", { count: usersSnapshot.roles.length })}
        >
          <CustomRolesEditor supabase={supabase} workspaceId={activeWorkspaceId} />
        </WorkspaceDisclosure>
        </>
      ) : null}
      {supabase && !isLocalFallback ? (
        <>
        <span className="settings-group-label">{t("settings.team.groups.automation")}</span>
        <WorkspaceDisclosure
          title={t("settings.workspace.sections.systemActors")}
          summary={
            systemActors.length
              ? t("settings.workspace.summaries.actorsCount", { count: systemActors.length })
              : t("settings.workspace.summaries.noActors")
          }
        >
          <SurfaceCard>
            <p className="surface-card-subtitle">
              {t("settings.workspace.systemActors.subtitle")}
            </p>
            <DataTable
              getRowId={(row) => row.id}
              persistKey="workspace-settings-system-actors"
              columns={[
                {
                  key: "actor",
                  label: t("settings.workspace.systemActors.column.actor"),
                  minWidth: 220,
                  render: (row) => (
                    <div className="identity-cell">
                      <span className="identity-title">
                        <Bot size={14} aria-hidden="true" />
                        {row.name}
                      </span>
                      <span className="identity-meta">{row.email ?? row.description ?? t("settings.workspace.systemActors.managedBy")}</span>
                    </div>
                  ),
                },
                {
                  key: "kind",
                  label: t("settings.workspace.systemActors.column.type"),
                  render: (row) => row.kind,
                },
                {
                  key: "status",
                  label: t("settings.workspace.systemActors.column.status"),
                  render: (row) => <StatusBadge tone={resolveSystemActorTone(row.status)}>{row.status}</StatusBadge>,
                },
                {
                  key: "permissions",
                  label: t("settings.workspace.systemActors.column.permissions"),
                  align: "right",
                  render: (row) => row.permissionKeys.length,
                },
              ]}
              rows={systemActors}
              emptyMessage={t("settings.workspace.systemActors.empty")}
            />
          </SurfaceCard>
        </WorkspaceDisclosure>
        </>
      ) : null}
    </>
  );

  if (variant === "access") {
    return (
      <div className="settings-access-stack page-stack">
        {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}
        {accessSections}
      <InviteMemberDialog
        isOpen={inviteOpen}
        roles={inviteRolesForDialog}
        existingEmails={teamMembers.map((member) => member.email).filter(Boolean)}
        pendingInviteEmails={pendingInvites.map((invite) => invite.email).filter((value) => value !== "Pending")}
        onClose={() => setInviteOpen(false)}
        onSent={async (email) => {
          toast.success(
            t("settings.workspace.toasts.inviteSentTitle"),
            t("settings.workspace.toasts.inviteSentBody", { email }),
          );
          await Promise.all([loadMembers(), loadPendingInvites()]);
        }}
      />
      </div>
    );
  }

  return (
    <div className="page-stack settings-page">
      <SectionHeader title={t("settings.workspace.title")} />

      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

      <SettingsLayout>

      <SurfaceCard
        title={t("settings.workspace.sections.generalInfo")}
        aside={
          workspaceProfile && !isEditingWorkspace && !isLocalFallback ? (
            <button className="ghost-control" onClick={() => setIsEditingWorkspace(true)} type="button">
              <Pencil size={13} />
              <span>{t("common.edit")}</span>
            </button>
          ) : null
        }
      >
        <input
          accept="image/png,image/jpeg,image/webp"
          className="user-account-avatar-input"
          onChange={(event) => void handleWorkspaceAvatarFile(event)}
          ref={workspaceAvatarInputRef}
          type="file"
        />
        {isEditingWorkspace && workspaceProfile ? (
          <div className="agent-form-grid">
            <div className="workspace-avatar-editor" style={{ gridColumn: "1 / -1" }}>
              <button
                aria-label={t("settings.workspace.generalInfo.uploadAvatar")}
                className="workspace-avatar-editor-button"
                disabled={isUploadingWorkspaceAvatar}
                onClick={() => workspaceAvatarInputRef.current?.click()}
                type="button"
              >
                {workspaceDraft.avatarUrl ? (
                  <img alt="" className="workspace-avatar-editor-image" src={workspaceDraft.avatarUrl} />
                ) : (
                  <span style={workspaceDraft.iconColor ? { background: workspaceDraft.iconColor } : undefined}>
                    {workspaceDraft.name.slice(0, 1).toUpperCase() || "W"}
                  </span>
                )}
                <span className="workspace-avatar-editor-overlay">
                  <Camera size={16} />
                </span>
              </button>
              <div className="workspace-avatar-editor-copy">
                <strong>{t("settings.workspace.generalInfo.workspaceAvatar")}</strong>
                <span>{t("settings.workspace.generalInfo.workspaceAvatarHelp")}</span>
              </div>
              {workspaceDraft.avatarUrl ? (
                <button
                  className="ghost-control action-row-button is-danger workspace-avatar-editor-remove"
                  disabled={isUploadingWorkspaceAvatar}
                  onClick={() => void handleWorkspaceAvatarRemove()}
                  type="button"
                >
                  <Trash2 size={13} />
                  <span>{t("common.remove")}</span>
                </button>
              ) : null}
            </div>
            <label className="field-block">
              <span className="field-label">{t("settings.workspace.generalInfo.workspaceName")}</span>
              <input
                className="field-input"
                onChange={(event) => setWorkspaceDraft((current) => ({ ...current, name: event.target.value }))}
                value={workspaceDraft.name}
              />
            </label>
            <label className="field-block">
              <span className="field-label">{t("settings.workspace.generalInfo.accentColor")}</span>
              <span className="workspace-color-picker-row">
                <input
                  aria-label={t("settings.workspace.generalInfo.accentColor")}
                  className="workspace-color-input"
                  onChange={(event) => handleWorkspaceAccentColorPreview(event.target.value)}
                  type="color"
                  value={workspaceDraft.iconColor || "#d6b37a"}
                />
                <input
                  className="field-input"
                  onChange={(event) => setWorkspaceDraft((current) => ({ ...current, iconColor: event.target.value }))}
                  placeholder="#d6b37a"
                  value={workspaceDraft.iconColor}
                />
              </span>
            </label>
            <div className="surface-card-actions" style={{ gridColumn: "1 / -1", justifyContent: "flex-end" }}>
              <button
                className="ghost-control action-row-button"
                disabled={isSavingWorkspace}
                onClick={() => {
                  setIsEditingWorkspace(false);
                  if (workspaceProfile) {
                    setWorkspaceDraft({
                      name: workspaceProfile.name,
                      baseCurrency: workspaceProfile.baseCurrency,
                      iconColor: workspaceProfile.iconColor ?? "",
                      avatarUrl: workspaceProfile.avatarUrl ?? "",
                    });
                  }
                }}
                type="button"
              >
                <X size={13} />
                <span>{t("common.cancel")}</span>
              </button>
              <button
                className="action-primary-button action-row-button"
                disabled={isSavingWorkspace}
                onClick={() => void handleSaveWorkspace()}
                type="button"
              >
                <Save size={13} />
                <span>{isSavingWorkspace ? t("common.saving") : t("common.saveChanges")}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="workspace-details-groups">
            <div className="workspace-details-group">
              <span className="workspace-details-group-label">{t("settings.workspace.generalInfo.workspaceLabel")}</span>
              <div className="workspace-identity-row">
                <button
                  aria-label={t("settings.workspace.generalInfo.uploadAvatar")}
                  className="workspace-avatar workspace-avatar-lg workspace-avatar-inline-button"
                  disabled={isLocalFallback || isUploadingWorkspaceAvatar}
                  onClick={() => workspaceAvatarInputRef.current?.click()}
                  style={workspaceProfile?.iconColor ? { background: workspaceProfile.iconColor } : undefined}
                  type="button"
                >
                  {workspaceProfile?.avatarUrl ? (
                    <img alt="" className="workspace-avatar-image" src={workspaceProfile.avatarUrl} />
                  ) : (
                    (workspaceProfile?.name ?? activeWorkspaceName).slice(0, 1).toUpperCase()
                  )}
                  <span className="workspace-avatar-inline-overlay">
                    <Camera size={14} />
                  </span>
                </button>
                <div>
                  <strong>{workspaceProfile?.name ?? activeWorkspaceName}</strong>
                  <span>{workspaceProfile?.slug ?? "workspace"}</span>
                </div>
              </div>
              <div className="summary-grid compact-summary-grid">
                <div className="summary-row">
                  <span className="summary-label">{t("settings.workspace.generalInfo.shortName")}</span>
                  <span className="summary-value">{workspaceProfile?.slug ?? "—"}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">{t("settings.workspace.generalInfo.workspaceId")}</span>
                  <span className="summary-value workspace-id-copy-row">
                    {/* Only a short fingerprint on screen; the copy button still
                        puts the full id on the clipboard for support. */}
                    <code className="workspace-details-id">{`${activeWorkspaceId.slice(0, 8)}…`}</code>
                    <button
                      className={`icon-ghost-control workspace-id-copy-button${copiedWorkspaceId ? " is-copied" : ""}`}
                      data-tooltip={copiedWorkspaceId ? t("settings.workspace.generalInfo.copied") : t("settings.workspace.generalInfo.copyId")} aria-label={copiedWorkspaceId ? t("settings.workspace.generalInfo.copied") : t("settings.workspace.generalInfo.copyId")}
                      onClick={() => void handleCopyWorkspaceId()}
                      type="button"
                    >
                      {copiedWorkspaceId ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">{t("settings.workspace.generalInfo.accentColor")}</span>
                  <span className="summary-value">
                    <label className="workspace-color-chip workspace-color-chip-button">
                      <span style={{ background: workspaceProfile?.iconColor ?? "#d6b37a" }} />
                      <code>
                        {workspaceProfile?.iconColor && workspaceProfile.iconColor !== "#000000"
                          ? workspaceProfile.iconColor
                          : t("settings.workspace.generalInfo.accentNotCustomized")}
                      </code>
                      <input
                        aria-label={t("settings.workspace.generalInfo.accentColor")}
                        disabled={isLocalFallback}
                        onBlur={(event) => void handleWorkspaceAccentColorCommit(event.target.value)}
                        onChange={(event) => handleWorkspaceAccentColorPreview(event.target.value)}
                        type="color"
                        value={workspaceProfile?.iconColor ?? "#d6b37a"}
                      />
                    </label>
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">{t("settings.workspace.generalInfo.baseCurrency")}</span>
                  <span className="summary-value">{workspaceProfile?.baseCurrency ?? "USD"}</span>
                </div>
              </div>
            </div>

            <div className="workspace-details-group">
              <span className="workspace-details-group-label">{t("settings.workspace.generalInfo.yourAccess")}</span>
              <div className="summary-grid compact-summary-grid">
                <div className="summary-row">
                  <span className="summary-label">{t("settings.account.role")}</span>
                  <span className="summary-value">{activeMembership?.roleName ?? t("settings.account.member")}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">{t("settings.workspace.members.column.permissions")}</span>
                  <span className="summary-value">
                    {activeMembership?.permissions.length
                      ? activeMembership.roleName?.toLowerCase().includes("admin")
                        ? t("settings.workspace.generalInfo.fullAccess")
                        : t("settings.workspace.generalInfo.permissionsGranted", { count: activeMembership.permissions.length })
                      : t("settings.workspace.generalInfo.permissionsPending")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </SurfaceCard>

      <WorkspaceDisclosure
        title={t("settings.workspace.sections.branding")}
        summary={t("settings.workspace.summaries.branding")}
      >
        <WorkspaceBrandingCard />
      </WorkspaceDisclosure>

      {canAccessFinance ? (
        <>
          <WorkspaceDisclosure
            title={t("settings.workspace.sections.currency")}
            summary={
              workspaceProfile?.baseCurrency
                ? t("settings.workspace.summaries.currencyWith", { currency: workspaceProfile.baseCurrency })
                : t("settings.workspace.summaries.currency")
            }
          >
            <CurrencySettingsCard />
          </WorkspaceDisclosure>

          <WorkspaceDisclosure
            title={t("settings.workspace.sections.ncf", { defaultValue: "NCF" })}
            summary={t("settings.workspace.summaries.ncf", {
              defaultValue: "Serie fiscal, próxima secuencia y vencimiento para facturación.",
            })}
          >
            <NcfSettingsCard />
          </WorkspaceDisclosure>
        </>
      ) : null}

      <WorkspaceDisclosure
        title={t("settings.workspace.sections.documentsFolder", { defaultValue: "Carpeta de documentos" })}
        summary={t("settings.workspace.summaries.documentsFolder", {
          defaultValue: "Dónde se guardan localmente facturas y documentos (carpeta iCloud/Drive opcional).",
        })}
      >
        <DocumentsFolderCard />
      </WorkspaceDisclosure>

      <WorkspaceDisclosure
        title={t("settings.workspace.sections.channels")}
        summary={t("settings.workspace.summaries.channels")}
      >
        <SurfaceCard
          title={t("settings.workspace.channels.channelAccess")}
          aside={
            <button className="action-primary-button" onClick={() => navigate("/agents/connectors")} type="button">
              <Send size={13} />
              <span>{t("settings.workspace.channels.manage")}</span>
            </button>
          }
        >
          <p className="surface-card-subtitle">
            {t("settings.workspace.channels.subtitle")}
          </p>
        </SurfaceCard>
      </WorkspaceDisclosure>

      {memberships.length > 1 ? (
        <WorkspaceDisclosure
          title={t("settings.workspace.sections.otherWorkspaces")}
          summary={t("settings.workspace.summaries.workspacesConnected", { count: memberships.length })}
        >
          <SurfaceCard title={t("settings.workspace.sections.otherWorkspaces")}>
            <ul className="confirm-dialog-list" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
              {memberships.map((membership) => (
                <li key={membership.workspaceId}>
                  <strong>{membership.workspaceName}</strong> · {membership.roleName}
                  {membership.workspaceId === activeWorkspaceId ? " (active)" : null}
                </li>
              ))}
            </ul>
          </SurfaceCard>
        </WorkspaceDisclosure>
      ) : null}

      </SettingsLayout>

    </div>
  );
};
