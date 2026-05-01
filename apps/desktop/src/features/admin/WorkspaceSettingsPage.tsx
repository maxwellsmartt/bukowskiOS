import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Send } from "lucide-react";

import type { AppUserAdminRow, AppUsersSnapshot } from "@contracts";
import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import { InviteMemberDialog } from "./InviteMemberDialog";

const emptyUsersSnapshot: AppUsersSnapshot = { users: [], roles: [] };

type PendingInviteRow = {
  id: string;
  email: string;
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
  const navigate = useNavigate();
  const { supabase, isLocalFallback } = useSession();
  const { activeWorkspaceId, activeWorkspaceName, activeMembership, memberships } = useWorkspace();
  const [usersSnapshot, setUsersSnapshot] = useState<AppUsersSnapshot>(emptyUsersSnapshot);
  const [pendingInvites, setPendingInvites] = useState<PendingInviteRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const loadPendingInvites = useCallback(async () => {
    if (!supabase || isLocalFallback) {
      setPendingInvites([]);
      return;
    }

    try {
      const { data, error: queryError } = await supabase
        .from("workspace_memberships")
        .select("id,invited_at,roles(name),user_profiles(email)")
        .eq("workspace_id", activeWorkspaceId)
        .eq("status", "invited");

      if (queryError) {
        throw queryError;
      }

      const rows = ((data ?? []) as unknown[]).map((row) => {
        const typed = row as {
          id: string;
          invited_at: string | null;
          roles?: { name?: string | null } | null;
          user_profiles?: { email?: string | null } | null;
        };

        return {
          id: typed.id,
          email: typed.user_profiles?.email ?? "Pending",
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

  useEffect(() => {
    void loadMembers();
    void loadPendingInvites();
  }, [loadMembers, loadPendingInvites]);

  const teamMembers = usersSnapshot.users.filter((user) => user.membershipStatus !== "missing");
  const inviteRolesForDialog = usersSnapshot.roles;

  return (
    <div className="page-stack">
      <div className="settings-back-row">
        <button className="ghost-control" onClick={() => navigate("/settings")} type="button">
          <ArrowLeft size={14} />
          <span>All settings</span>
        </button>
      </div>

      <SectionHeader
        eyebrow="Workspace"
        title={activeWorkspaceName}
        body="Workspace identity, currency, color and members. Editing the name, currency or icon will be enabled in the next release."
        titleTone="accent"
      />

      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}
      {feedback ? <div className="action-feedback action-feedback-success">{feedback}</div> : null}

      <SurfaceCard title="Workspace details">
        <div className="summary-grid compact-summary-grid">
          <div className="summary-row">
            <span className="summary-label">Name</span>
            <span className="summary-value">{activeWorkspaceName}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Workspace ID</span>
            <span className="summary-value">{activeWorkspaceId}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Your role</span>
            <span className="summary-value">{activeMembership?.roleName ?? "Member"}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Your access</span>
            <span className="summary-value">
              {activeMembership?.permissions.length
                ? `${activeMembership.permissions.length} permissions`
                : "Pending — refresh the workspace if this stays empty"}
            </span>
          </div>
        </div>
      </SurfaceCard>

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
            { key: "role", label: "Role", render: (row) => row.roleName ?? "Member" },
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
          ]}
          rows={teamMembers}
          emptyMessage="No members yet."
        />
      </SurfaceCard>

      <SurfaceCard title="Pending invites">
        {pendingInvites.length === 0 ? (
          <p className="surface-card-subtitle">No invitations pending. Use the Invite button above to add a teammate.</p>
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
            ]}
            rows={pendingInvites}
            emptyMessage="No pending invites."
          />
        )}
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

      <InviteMemberDialog
        isOpen={inviteOpen}
        roles={inviteRolesForDialog}
        onClose={() => setInviteOpen(false)}
        onSent={async (email) => {
          setFeedback(`Invite sent to ${email}.`);
          await Promise.all([loadMembers(), loadPendingInvites()]);
        }}
      />
    </div>
  );
};
