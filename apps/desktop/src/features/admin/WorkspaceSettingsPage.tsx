import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, Save, Send, X } from "lucide-react";

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

export const WorkspaceSettingsPage = () => {
  const toast = useToast();
  const navigate = useNavigate();
  const { supabase, isLocalFallback, user: sessionUser } = useSession();
  const { activeWorkspaceId, activeWorkspaceName, activeMembership, memberships, refreshWorkspaces } = useWorkspace();
  const [usersSnapshot, setUsersSnapshot] = useState<AppUsersSnapshot>(emptyUsersSnapshot);
  const [pendingInvites, setPendingInvites] = useState<PendingInviteRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [workspaceProfile, setWorkspaceProfile] = useState<{
    name: string;
    slug: string;
    baseCurrency: string;
    iconColor: string | null;
  } | null>(null);
  const [isEditingWorkspace, setIsEditingWorkspace] = useState(false);
  const [workspaceDraft, setWorkspaceDraft] = useState({ name: "", baseCurrency: "USD", iconColor: "" });
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);

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
  }, [activeWorkspaceId]);

  const loadWorkspaceProfile = useCallback(async () => {
    if (!supabase || isLocalFallback || !activeWorkspaceId) {
      setWorkspaceProfile(null);
      return;
    }

    try {
      const { data, error: queryError } = await supabase
        .from("workspaces")
        .select("name,slug,base_currency,icon_color")
        .eq("id", activeWorkspaceId)
        .maybeSingle();

      if (queryError || !data) {
        setWorkspaceProfile(null);
        return;
      }

      const profile = {
        name: (data as { name?: string }).name ?? "",
        slug: (data as { slug?: string }).slug ?? "",
        baseCurrency: (data as { base_currency?: string }).base_currency ?? "USD",
        iconColor: (data as { icon_color?: string | null }).icon_color ?? null,
      };

      setWorkspaceProfile(profile);
      setWorkspaceDraft({
        name: profile.name,
        baseCurrency: profile.baseCurrency,
        iconColor: profile.iconColor ?? "",
      });
    } catch {
      setWorkspaceProfile(null);
    }
  }, [activeWorkspaceId, isLocalFallback, supabase]);

  useEffect(() => {
    void loadMembers();
    void loadPendingInvites();
    void loadWorkspaceProfile();
  }, [loadMembers, loadPendingInvites, loadWorkspaceProfile]);

  const handleSaveWorkspace = async () => {
    if (!supabase || !workspaceProfile) {
      return;
    }

    const nextName = workspaceDraft.name.trim();
    const nextBaseCurrency = workspaceDraft.baseCurrency.trim().toUpperCase();
    const nextIconColor = workspaceDraft.iconColor.trim() || null;

    if (!nextName || !nextBaseCurrency) {
      toast.error("Cannot save", "Name and currency are required.");
      return;
    }

    setIsSavingWorkspace(true);

    try {
      const updatePayload = {
        name: nextName,
        base_currency: nextBaseCurrency,
        icon_color: nextIconColor,
        updated_at: new Date().toISOString(),
      };
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
      <SectionHeader
        eyebrow="Workspace"
        title={activeWorkspaceName}
        body="Identity, currency, branding, members and roles for this workspace."
        titleTone="accent"
      />

      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

      <SettingsLayout>

      <SurfaceCard
        title="Identity"
        subtitle="The workspace's name, slug and accent. Currency lives below."
        aside={
          workspaceProfile && !isEditingWorkspace && !isLocalFallback ? (
            <button className="ghost-control" onClick={() => setIsEditingWorkspace(true)} type="button">
              <Pencil size={13} />
              <span>Edit</span>
            </button>
          ) : null
        }
      >
        {isEditingWorkspace && workspaceProfile ? (
          <div className="agent-form-grid">
            <label className="field-block">
              <span className="field-label">Workspace name</span>
              <input
                className="field-input"
                onChange={(event) => setWorkspaceDraft((current) => ({ ...current, name: event.target.value }))}
                value={workspaceDraft.name}
              />
            </label>
            <label className="field-block">
              <span className="field-label">Icon color (hex, optional)</span>
              <input
                className="field-input"
                onChange={(event) => setWorkspaceDraft((current) => ({ ...current, iconColor: event.target.value }))}
                placeholder="#d6b37a"
                value={workspaceDraft.iconColor}
              />
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
              <div className="summary-grid compact-summary-grid">
                <div className="summary-row">
                  <span className="summary-label">Name</span>
                  <span className="summary-value">{workspaceProfile?.name ?? activeWorkspaceName}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Slug</span>
                  <span className="summary-value">{workspaceProfile?.slug ?? "—"}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Icon color</span>
                  <span className="summary-value">
                    {workspaceProfile?.iconColor ? (
                      <span className="workspace-color-chip">
                        <span style={{ background: workspaceProfile.iconColor }} />
                        <code>{workspaceProfile.iconColor}</code>
                      </span>
                    ) : (
                      "Default"
                    )}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Workspace ID</span>
                  <span className="summary-value workspace-details-id">{activeWorkspaceId}</span>
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

      <CurrencySettingsCard />
      <WorkspaceBrandingCard />

      <SurfaceCard
        title="Members"
        aside={
          <button
            className="action-primary-button"
            disabled={isLocalFallback || !inviteRolesForDialog.length}
            data-tooltip={isLocalFallback ? "Invites require a Supabase session" : undefined}
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

      <SurfaceCard title="Pending invites">
        {pendingInvites.length === 0 ? (
          <p className="surface-card-subtitle">
            No invitations waiting. When you send one, your teammate gets a magic link in their inbox — no password required.
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

      {supabase && !isLocalFallback ? (
        <CustomRolesEditor supabase={supabase} workspaceId={activeWorkspaceId} />
      ) : null}

      <SurfaceCard
        title="Channel access"
        subtitle="Link members to the messaging channels they should reach the assistant from."
        aside={
          <button className="action-primary-button" onClick={() => navigate("/agents/connectors")} type="button">
            <Send size={13} />
            <span>Manage channels</span>
          </button>
        }
      >
        <p className="surface-card-subtitle">
          Today only Telegram is wired with a delivery provider — find each member there and pair them with their
          internal account. WhatsApp, Email and Webhook are staged but ship in a future release.
        </p>
      </SurfaceCard>

      {memberships.length > 1 ? (
        <SurfaceCard title="Switch workspace">
          <p className="surface-card-subtitle">You belong to {memberships.length} workspaces.</p>
          <ul className="confirm-dialog-list" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {memberships.map((membership) => (
              <li key={membership.workspaceId}>
                <strong>{membership.workspaceName}</strong> · {membership.roleName}
                {membership.workspaceId === activeWorkspaceId ? " (active)" : null}
              </li>
            ))}
          </ul>
        </SurfaceCard>
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
