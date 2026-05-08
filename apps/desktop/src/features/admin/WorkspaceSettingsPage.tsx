import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Camera, Check, ChevronDown, Copy, Pencil, Save, Send, Trash2, X } from "lucide-react";

import type { AppUserAdminRow, AppUsersSnapshot } from "@contracts";
import { useSession } from "@app/providers/SessionProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import { CurrencySettingsCard } from "./CurrencySettingsCard";
import { CustomRolesEditor } from "./CustomRolesEditor";
import { InviteMemberDialog } from "./InviteMemberDialog";
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

const resolveMembershipLabel = (status: AppUserAdminRow["membershipStatus"]) => {
  if (status === "active") {
    return "Active";
  }

  if (status === "inactive") {
    return "Inactive";
  }

  return "Not in workspace";
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
    .select("id,user_id,status,role_id,roles(key,name,role_permissions(permissions(key)))")
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

export const WorkspaceSettingsPage = () => {
  const toast = useToast();
  const navigate = useNavigate();
  const { supabase, isLocalFallback, user: sessionUser } = useSession();
  const { activeWorkspaceId, activeWorkspaceName, activeMembership, memberships, refreshWorkspaces } = useWorkspace();
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
      const { data, error: queryError } = await supabase
        .from("workspace_memberships")
        .select("id,invited_at,role_id,roles(name),user_profiles(email)")
        .eq("workspace_id", activeWorkspaceId)
        .eq("status", "invited");

      if (queryError) {
        throw queryError;
      }

      const rows = ((data ?? []) as unknown[]).map((row) => {
        const typed = row as {
          id: string;
          invited_at: string | null;
          role_id: string | null;
          roles?: { name?: string | null } | null;
          user_profiles?: { email?: string | null } | null;
        };

        return {
          id: typed.id,
          email: typed.user_profiles?.email ?? "Pending",
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
    if (!supabase || !workspaceProfile) {
      return;
    }

    const nextProfile = {
      ...workspaceProfile,
      avatarUrl: updates.avatarUrl !== undefined ? updates.avatarUrl : workspaceProfile.avatarUrl,
      iconColor: updates.iconColor !== undefined ? updates.iconColor : workspaceProfile.iconColor,
    };

    const updatePayload: Record<string, string | null> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.avatarUrl !== undefined) {
      updatePayload.avatar_url = nextProfile.avatarUrl;
    }

    if (updates.iconColor !== undefined) {
      updatePayload.icon_color = nextProfile.iconColor;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const looseSupabase = supabase as any;
    const { error: updateError } = await looseSupabase
      .from("workspaces")
      .update(updatePayload)
      .eq("id", activeWorkspaceId);

    if (updateError) {
      throw updateError;
    }

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
      toast.error("Cannot save", "Name and currency are required.");
      return;
    }

    if (nextIconColor && !workspaceAccentColorPattern.test(nextIconColor)) {
      toast.error("Cannot save", "Accent color must be a hex color like #d6b37a.");
      return;
    }

    setIsSavingWorkspace(true);

    try {
      const updatePayload: Record<string, string | null> = {
        name: nextName,
        base_currency: nextBaseCurrency,
        icon_color: nextIconColor,
        updated_at: new Date().toISOString(),
      };

      if (workspaceProfile.avatarUrl !== null || nextAvatarUrl !== null) {
        updatePayload.avatar_url = nextAvatarUrl;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const looseSupabase = supabase as any;
      const { error: updateError } = await looseSupabase
        .from("workspaces")
        .update(updatePayload)
        .eq("id", activeWorkspaceId);

      if (updateError) {
        throw updateError;
      }

      toast.success("Workspace updated", "Identity changes apply right away across the app.");
      setIsEditingWorkspace(false);
      await Promise.all([loadWorkspaceProfile(), refreshWorkspaces()]);
    } catch (nextError) {
      toast.error("Could not save", getUserFacingErrorMessage(nextError, "Try again in a moment."));
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
      toast.error("Sign in required", "You need to be signed in to update the workspace avatar.");
      return;
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const hasSupportedMime = file.type ? workspaceAvatarAcceptedTypes.test(file.type) : false;
    const hasSupportedExtension = workspaceAvatarAcceptedExtensions.has(ext);

    if (!hasSupportedMime && !hasSupportedExtension) {
      toast.error("Unsupported format", "Use a PNG, JPEG, WebP or SVG image.");
      return;
    }

    if (file.size > workspaceAvatarMaxBytes) {
      toast.error("File too large", "Pick an image under 8 MB.");
      return;
    }

    setIsUploadingWorkspaceAvatar(true);

    try {
      const path = `${activeWorkspaceId}/avatar-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("workspace-assets")
        .upload(path, file, { upsert: true, contentType: file.type || (ext === "svg" ? "image/svg+xml" : undefined) });

      if (uploadError) {
        throw uploadError;
      }

      const { data: publicUrlData } = supabase.storage.from("workspace-assets").getPublicUrl(path);
      if (isEditingWorkspace) {
        setWorkspaceDraft((current) => ({ ...current, avatarUrl: publicUrlData.publicUrl }));
        toast.success("Avatar ready", "Save changes to apply it across the app.");
      } else {
        await persistWorkspaceIdentity({ avatarUrl: publicUrlData.publicUrl });
        toast.success("Workspace avatar updated", "The new avatar is now visible across the app.");
      }
    } catch (nextError) {
      toast.error("Upload failed", getUserFacingErrorMessage(nextError, "Try again with a smaller image."));
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
      toast.success("Workspace avatar removed", "The workspace now uses its initial.");
    } catch (nextError) {
      toast.error("Could not remove avatar", getUserFacingErrorMessage(nextError, "Try again in a moment."));
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
      toast.error("Could not update color", getUserFacingErrorMessage(nextError, "Try again in a moment."));
      await loadWorkspaceProfile();
    }
  };

  const handleCopyWorkspaceId = async () => {
    try {
      await navigator.clipboard.writeText(activeWorkspaceId);
      setCopiedWorkspaceId(true);
      if (copyFeedbackTimeoutRef.current) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
      copyFeedbackTimeoutRef.current = window.setTimeout(() => setCopiedWorkspaceId(false), 1800);
    } catch (nextError) {
      toast.error("Could not copy", getUserFacingErrorMessage(nextError, "Copy the ID manually."));
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
      toast.success("Role updated", `${member.fullName || member.email} has a new role.`);
      await loadMembers();
    } catch (nextError) {
      toast.error("Could not change role", getUserFacingErrorMessage(nextError, "Try again in a moment."));
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
        nextStatus === "inactive" ? "Member suspended" : "Member reactivated",
        `${member.fullName || member.email} is now ${nextStatus === "inactive" ? "suspended" : "active"}.`,
      );
      await loadMembers();
    } catch (nextError) {
      toast.error("Could not change status", getUserFacingErrorMessage(nextError, "Try again in a moment."));
    }
  };

  const handleResendInvite = async (invite: PendingInviteRow) => {
    if (!supabase || !invite.roleId) {
      toast.error("Cannot resend", "This invite is missing role information.");
      return;
    }

    try {
      await sendWorkspaceInvite(supabase, {
        workspaceId: activeWorkspaceId,
        email: invite.email,
        roleId: invite.roleId,
      });
      toast.success("Invite resent", `${invite.email} got a fresh magic link.`);
      await loadPendingInvites();
    } catch (nextError) {
      toast.error("Could not resend", getUserFacingErrorMessage(nextError, "Try again in a moment."));
    }
  };

  const handleRevokeInvite = async (invite: PendingInviteRow) => {
    if (!supabase) {
      return;
    }

    try {
      await revokeWorkspaceInvite(supabase, { membershipId: invite.id });
      toast.success("Invite revoked", `${invite.email} can no longer join with the previous link.`);
      await loadPendingInvites();
    } catch (nextError) {
      toast.error("Could not revoke", getUserFacingErrorMessage(nextError, "Try again in a moment."));
    }
  };

  return (
    <div className="page-stack settings-page">
      <SectionHeader title="Workspace" />

      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

      <SettingsLayout>

      <SurfaceCard
        title="General info"
        aside={
          workspaceProfile && !isEditingWorkspace && !isLocalFallback ? (
            <button className="ghost-control" onClick={() => setIsEditingWorkspace(true)} type="button">
              <Pencil size={13} />
              <span>Edit</span>
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
                aria-label="Upload workspace avatar"
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
                <strong>Workspace avatar</strong>
                <span>Appears in the workspace picker, switcher and navigation surfaces.</span>
              </div>
              {workspaceDraft.avatarUrl ? (
                <button
                  className="ghost-control is-danger"
                  disabled={isUploadingWorkspaceAvatar}
                  onClick={() => void handleWorkspaceAvatarRemove()}
                  type="button"
                >
                  <Trash2 size={13} />
                  <span>Remove</span>
                </button>
              ) : null}
            </div>
            <label className="field-block">
              <span className="field-label">Workspace name</span>
              <input
                className="field-input"
                onChange={(event) => setWorkspaceDraft((current) => ({ ...current, name: event.target.value }))}
                value={workspaceDraft.name}
              />
            </label>
            <label className="field-block">
              <span className="field-label">Accent color</span>
              <span className="workspace-color-picker-row">
                <input
                  aria-label="Accent color picker"
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
                className="ghost-control"
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
                <span>Cancel</span>
              </button>
              <button
                className="action-primary-button"
                disabled={isSavingWorkspace}
                onClick={() => void handleSaveWorkspace()}
                type="button"
              >
                <Save size={13} />
                <span>{isSavingWorkspace ? "Saving…" : "Save changes"}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="workspace-details-groups">
            <div className="workspace-details-group">
              <span className="workspace-details-group-label">Workspace</span>
              <div className="workspace-identity-row">
                <button
                  aria-label="Change workspace avatar"
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
                  <span className="summary-label">Short name</span>
                  <span className="summary-value">{workspaceProfile?.slug ?? "—"}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Workspace ID</span>
                  <span className="summary-value workspace-id-copy-row">
                    <code className="workspace-details-id">{activeWorkspaceId}</code>
                    <button
                      className={`icon-ghost-control workspace-id-copy-button${copiedWorkspaceId ? " is-copied" : ""}`}
                      data-tooltip={copiedWorkspaceId ? "Copied" : "Copy workspace ID"}
                      onClick={() => void handleCopyWorkspaceId()}
                      type="button"
                    >
                      {copiedWorkspaceId ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Accent color</span>
                  <span className="summary-value">
                    <label className="workspace-color-chip workspace-color-chip-button">
                      <span style={{ background: workspaceProfile?.iconColor ?? "#d6b37a" }} />
                      <code>{workspaceProfile?.iconColor ?? "Default"}</code>
                      <input
                        aria-label="Change workspace accent color"
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
                  <span className="summary-label">Base currency</span>
                  <span className="summary-value">{workspaceProfile?.baseCurrency ?? "USD"}</span>
                </div>
              </div>
            </div>

            <div className="workspace-details-group">
              <span className="workspace-details-group-label">Your access</span>
              <div className="summary-grid compact-summary-grid">
                <div className="summary-row">
                  <span className="summary-label">Role</span>
                  <span className="summary-value">{activeMembership?.roleName ?? "Member"}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Permissions</span>
                  <span className="summary-value">
                    {activeMembership?.permissions.length
                      ? `${activeMembership.permissions.length} permissions granted`
                      : "Pending — refresh the workspace if this stays empty"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </SurfaceCard>

      <WorkspaceDisclosure title="Currency" summary={`Base currency and exchange rates${workspaceProfile?.baseCurrency ? ` · ${workspaceProfile.baseCurrency}` : ""}`}>
        <CurrencySettingsCard />
      </WorkspaceDisclosure>

      <WorkspaceDisclosure title="Branding" summary="Logo and document assets">
        <WorkspaceBrandingCard />
      </WorkspaceDisclosure>

      <WorkspaceDisclosure title="Members" summary={`${teamMembers.length} member${teamMembers.length === 1 ? "" : "s"} · ${teamMembers.filter((member) => member.membershipStatus === "active").length} active`}>
        <SurfaceCard
          title="Members"
          aside={
            <button
              className="action-primary-button"
              disabled={isLocalFallback || !inviteRolesForDialog.length}
              data-tooltip={isLocalFallback ? "Sign in to send invites" : undefined}
              onClick={() => setInviteOpen(true)}
              type="button"
            >
              <Send size={14} />
              <span>Invite member</span>
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
                label: "Member",
                render: (row) => (
                  <div className="identity-cell">
                    <span className="identity-title">{row.fullName}</span>
                    <span className="identity-meta">{row.email || "Email pending"}</span>
                  </div>
                ),
              },
              {
                key: "role",
                label: "Role",
                render: (row) => {
                  const isSelf = row.id === sessionUser?.id;
                  const canEdit = !isLocalFallback && Boolean(supabase) && !isSelf;
                  if (!canEdit) {
                    return <span>{row.roleName ?? "Member"}</span>;
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
                label: "Membership",
                render: (row) => (
                  <StatusBadge tone={resolveMembershipTone(row.membershipStatus)}>
                    {resolveMembershipLabel(row.membershipStatus)}
                  </StatusBadge>
                ),
              },
              {
                key: "permissions",
                label: "Permissions",
                align: "right",
                render: (row) => row.permissionKeys.length,
              },
              {
                key: "actions",
                label: "Actions",
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
                      {isActive ? "Suspend" : "Reactivate"}
                    </button>
                  );
                },
              },
            ]}
            rows={teamMembers}
            emptyMessage="No members yet."
          />
        </SurfaceCard>
      </WorkspaceDisclosure>

      {supabase && !isLocalFallback ? (
        <WorkspaceDisclosure
          title="System actors"
          summary={
            systemActors.length
              ? `${systemActors.length} automation identity${systemActors.length === 1 ? "" : "ies"}`
              : "No automation identities yet"
          }
        >
          <SurfaceCard title="Automation identities">
            <p className="surface-card-subtitle">
              System actors audit assistant-driven actions without creating fake human accounts or invite emails.
            </p>
            <DataTable
              getRowId={(row) => row.id}
              persistKey="workspace-settings-system-actors"
              columns={[
                {
                  key: "actor",
                  label: "Actor",
                  minWidth: 220,
                  render: (row) => (
                    <div className="identity-cell">
                      <span className="identity-title">
                        <Bot size={14} aria-hidden="true" />
                        {row.name}
                      </span>
                      <span className="identity-meta">{row.email ?? row.description ?? "Managed by bukowskiOS"}</span>
                    </div>
                  ),
                },
                {
                  key: "kind",
                  label: "Type",
                  render: (row) => row.kind,
                },
                {
                  key: "status",
                  label: "Status",
                  render: (row) => <StatusBadge tone={resolveSystemActorTone(row.status)}>{row.status}</StatusBadge>,
                },
                {
                  key: "permissions",
                  label: "Permissions",
                  align: "right",
                  render: (row) => row.permissionKeys.length,
                },
              ]}
              rows={systemActors}
              emptyMessage="Run the system actors migration to create the AI Agent identity for this workspace."
            />
          </SurfaceCard>
        </WorkspaceDisclosure>
      ) : null}

      <WorkspaceDisclosure title="Pending invites" summary={pendingInvites.length ? `${pendingInvites.length} waiting` : "No pending invites"}>
        <SurfaceCard title="Pending invites">
          {pendingInvites.length === 0 ? (
            <p className="surface-card-subtitle">
              No invitations waiting. New teammates get a magic link by email.
            </p>
          ) : (
            <DataTable
              getRowId={(row) => row.id}
              persistKey="workspace-settings-pending-invites"
              columns={[
                { key: "email", label: "Email", render: (row) => row.email },
                { key: "role", label: "Role", render: (row) => row.roleName },
                {
                  key: "invitedAt",
                  label: "Invited",
                  render: (row) => (row.invitedAt ? new Date(row.invitedAt).toLocaleDateString() : "Pending"),
                },
                {
                  key: "actions",
                  label: "Actions",
                  align: "right",
                  render: (row) => (
                    <div className="surface-card-actions" style={{ justifyContent: "flex-end" }}>
                      <button
                        className="ghost-control"
                        disabled={!row.roleId}
                        onClick={() => void handleResendInvite(row)}
                        type="button"
                      >
                        Resend
                      </button>
                      <button
                        className="ghost-control is-danger"
                        onClick={() => void handleRevokeInvite(row)}
                        type="button"
                      >
                        Revoke
                      </button>
                    </div>
                  ),
                },
              ]}
              rows={pendingInvites}
              emptyMessage="No pending invites."
            />
          )}
        </SurfaceCard>
      </WorkspaceDisclosure>

      {supabase && !isLocalFallback ? (
        <WorkspaceDisclosure title="Roles" summary={`${usersSnapshot.roles.length} role${usersSnapshot.roles.length === 1 ? "" : "s"} available`}>
          <CustomRolesEditor supabase={supabase} workspaceId={activeWorkspaceId} />
        </WorkspaceDisclosure>
      ) : null}

      <WorkspaceDisclosure title="Channels" summary="Messaging access for workspace members">
        <SurfaceCard
          title="Channel access"
          aside={
            <button className="action-primary-button" onClick={() => navigate("/agents/connectors")} type="button">
              <Send size={13} />
              <span>Manage channels</span>
            </button>
          }
        >
          <p className="surface-card-subtitle">
            Connect members to the messaging channels they use with the assistant.
          </p>
        </SurfaceCard>
      </WorkspaceDisclosure>

      {memberships.length > 1 ? (
        <WorkspaceDisclosure title="Other workspaces" summary={`${memberships.length} workspaces connected`}>
          <SurfaceCard title="Other workspaces">
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

      <InviteMemberDialog
        isOpen={inviteOpen}
        roles={inviteRolesForDialog}
        existingEmails={teamMembers.map((member) => member.email).filter(Boolean)}
        pendingInviteEmails={pendingInvites.map((invite) => invite.email).filter((value) => value !== "Pending")}
        onClose={() => setInviteOpen(false)}
        onSent={async (email) => {
          toast.success("Invite sent", `${email} will receive a magic link to join this workspace.`);
          await Promise.all([loadMembers(), loadPendingInvites()]);
        }}
      />
    </div>
  );
};
