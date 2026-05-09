import type {
  AppActionResult,
  AppDiagnosticsSnapshot,
  AppExportResult,
  AppUserAdminRow,
  AppUsersSnapshot,
  AppSupportEventSummary,
  AppSupportSnapshot,
  AppSyncOutboxRow,
} from "@contracts";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useCatalogData } from "@features/projects/useProjectsData";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useShellContext } from "@shared/hooks/useShellContext";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

const emptyDiagnostics: AppDiagnosticsSnapshot = {
  databaseSizeBytes: 0,
  backupSizeBytes: 0,
  databaseExists: false,
  backupExists: false,
  lastBackupAt: null,
  lastIntegrityCheckAt: null,
  lastIntegrityCheckStatus: "never",
  lastRetentionRunAt: null,
  lastRetentionSummary: null,
  lastSyncRunAt: null,
  lastSyncSummary: null,
  lastSyncStatus: "idle",
  syncOutboxPendingCount: 0,
  syncOutboxProcessingCount: 0,
  syncOutboxFailedCount: 0,
  encryptionAvailable: false,
  internalBuildArtifacts: [],
};

const emptySupportSnapshot: AppSupportSnapshot = {
  diagnostics: emptyDiagnostics,
  appInfo: {
    appName: "bukowskiOS",
    platform: "unknown",
    isPackaged: false,
    version: "Unknown",
    shellVersion: "Unknown",
  },
  recentLogFiles: [],
  logStorageLabel: "Stored in the local desktop app support directory.",
  lastCrash: null,
  lastError: null,
  lastLoadFailure: null,
  recentCriticalEvents: [],
};

const emptyUsersSnapshot: AppUsersSnapshot = {
  users: [],
  roles: [],
};

type UserEditorDraft = {
  fullName: string;
  email: string;
  phone: string;
  roleId: string;
  linkedCrewMemberId: string;
};

import { AutoLogoutSetting } from "./AutoLogoutSetting";
import { SettingsLayout, settingsNavEntries, useActiveSettingsSection } from "./SettingsLayout";
import { UserChannelDots } from "./UserChannelDots";
import { UserAccountSettings } from "./UserAccountSettings";

const roleCoverageGroups = [
  { label: "Assets", keys: ["assets.read", "assets.manage", "licenses.manage"] },
  { label: "Incidents", keys: ["incidents.read", "incidents.create"] },
  { label: "RMA", keys: ["rma.read", "rma.create"] },
  { label: "Packing", keys: ["packing-slips.read", "packing-slips.create"] },
  { label: "Finance", keys: ["finance.read"] },
] as const;

const roleUseCaseMap: Record<string, string> = {
  admin: "Full control for workspace owners and trusted operators.",
  crew: "Daily crew access for assigned equipment, packing context and incident reports.",
  supervisor: "Operational lead access for projects, assets, incidents, RMAs and packing slips.",
  finance_viewer: "Finance visibility without edit access.",
  maintenance: "Repair and RMA access for damaged equipment follow-up.",
};

const getRoleCoverageLabels = (permissionKeys: string[]) =>
  roleCoverageGroups.filter((group) => group.keys.some((key) => permissionKeys.includes(key))).map((group) => group.label);

const formatBytes = (value: number) => {
  if (!value) {
    return "0 B";
  }

  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${value} B`;
};

const formatDateLabel = (value: string | null) => {
  if (!value) {
    return "Never";
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? value : parsedDate.toLocaleString();
};

const resolveIntegrityLabel = (status: AppDiagnosticsSnapshot["lastIntegrityCheckStatus"]) => {
  if (status === "healthy") {
    return "Healthy";
  }

  if (status === "failed") {
    return "Failed";
  }

  return "Not run yet";
};

const buildUserDraft = (user: AppUserAdminRow | null, roles: AppUsersSnapshot["roles"]): UserEditorDraft => ({
  fullName: user?.fullName ?? "",
  email: user?.email ?? "",
  phone: user?.phone ?? "",
  roleId: user?.roleId ?? roles.find((role) => role.key === "crew")?.id ?? roles[0]?.id ?? "",
  linkedCrewMemberId: user?.linkedCrewId ?? "",
});

const permissionLabelOverrides: Record<string, string> = {
  "projects.read": "View projects",
  "projects.manage": "Manage projects",
  "assets.read": "View assets",
  "assets.manage": "Manage assets",
  "licenses.manage": "Manage licenses",
  "incidents.read": "View incidents",
  "incidents.create": "Report incidents",
  "packing-slips.read": "View packing slips",
  "packing-slips.create": "Issue packing slips",
  "finance.read": "View finance",
  "rma.read": "View RMAs",
  "rma.create": "Create RMAs",
  "users.invite": "Invite users",
};

const permissionGroupForKey = (key: string) => {
  if (key.startsWith("projects.")) return "Projects";
  if (key.startsWith("assets.")) return "Assets";
  if (key.startsWith("licenses.")) return "Assets";
  if (key.startsWith("incidents.")) return "Incidents";
  if (key.startsWith("packing-slips.")) return "Packing";
  if (key.startsWith("finance.")) return "Finance";
  if (key.startsWith("rma.")) return "RMA";
  if (key.startsWith("users.")) return "Team";
  return "Other";
};

type RolesPermissionMatrixProps = {
  roles: AppUsersSnapshot["roles"];
};

type SettingsDisclosureProps = {
  children: ReactNode;
  defaultOpen?: boolean;
  summary: string;
  title: string;
};

const SettingsDisclosure = ({ children, defaultOpen = false, summary, title }: SettingsDisclosureProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className={`settings-disclosure${isOpen ? " is-open" : ""}`}>
      <button
        aria-expanded={isOpen}
        className="settings-disclosure-trigger"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span>
          <strong>{title}</strong>
          <small>{summary}</small>
        </span>
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      {isOpen ? <div className="settings-disclosure-body">{children}</div> : null}
    </section>
  );
};

const RolesPermissionMatrix = ({ roles }: RolesPermissionMatrixProps) => {
  const allPermissionKeys = useMemo(() => {
    const set = new Set<string>();
    for (const role of roles) {
      for (const key of role.permissionKeys) {
        set.add(key);
      }
    }
    return Array.from(set).sort((a, b) => {
      const groupA = permissionGroupForKey(a);
      const groupB = permissionGroupForKey(b);
      if (groupA !== groupB) {
        return groupA.localeCompare(groupB);
      }
      return a.localeCompare(b);
    });
  }, [roles]);

  if (!roles.length) {
    return <p className="surface-card-subtitle">No roles defined for this workspace.</p>;
  }

  if (!allPermissionKeys.length) {
    return <p className="surface-card-subtitle">No permissions are assigned to any role yet.</p>;
  }

  let lastGroup = "";

  return (
    <div className="permission-matrix-wrapper">
      <table className="permission-matrix">
        <thead>
          <tr>
            <th className="permission-matrix-corner">Permission</th>
            {roles.map((role) => (
              <th key={role.id} className="permission-matrix-role">
                {role.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allPermissionKeys.map((key) => {
            const group = permissionGroupForKey(key);
            const showGroup = group !== lastGroup;
            const permissionLabel = permissionLabelOverrides[key] ?? key;
            lastGroup = group;
            return (
              <tr key={key}>
                <td className="permission-matrix-permission">
                  {showGroup ? <span className="permission-matrix-group">{group}</span> : null}
                  <span className="permission-matrix-permission-label">
                    {permissionLabel}
                  </span>
                </td>
                {roles.map((role) => {
                  const has = role.permissionKeys.includes(key);
                  return (
                    <td
                      key={role.id}
                      className={`permission-matrix-cell${has ? " is-allowed" : " is-denied"}`}
                      aria-label={has ? `${role.name} can ${permissionLabel}` : `${role.name} cannot ${permissionLabel}`}
                    >
                      {has ? "✓" : "—"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const SettingsPage = () => {
  const { appInfo } = useShellContext();
  const { activeWorkspaceId, activeWorkspaceName } = useWorkspace();
  const { data: catalog } = useCatalogData({
    workspaceId: activeWorkspaceId,
    entityType: "crew",
    search: "",
    sortBy: "fullName",
    sortDirection: "asc",
  });
  const navigate = useNavigate();
  const toast = useToast();
  const [diagnostics, setDiagnostics] = useState<AppDiagnosticsSnapshot>(emptyDiagnostics);
  const [supportSnapshot, setSupportSnapshot] = useState<AppSupportSnapshot>(emptySupportSnapshot);
  const [usersSnapshot, setUsersSnapshot] = useState<AppUsersSnapshot>(emptyUsersSnapshot);
  const activeSection = useActiveSettingsSection();
  const activeSectionTitle = settingsNavEntries.find((entry) => entry.id === activeSection)?.label ?? "General";
  const [roleDirectoryId, setRoleDirectoryId] = useState<string>("");
  const [selectedUserId, setSelectedUserId] = useState<string>("new");
  const [userDraft, setUserDraft] = useState<UserEditorDraft>(buildUserDraft(null, []));
  const [error, setError] = useState<string | null>(null);
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isRunningLocalSync, setIsRunningLocalSync] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingSupportBundle, setIsExportingSupportBundle] = useState(false);
  const [isExportingLogs, setIsExportingLogs] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [isTogglingUser, setIsTogglingUser] = useState(false);
  const [isRevokingTelegram, setIsRevokingTelegram] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [isDeleteUserConfirmOpen, setIsDeleteUserConfirmOpen] = useState(false);
  const [syncRows, setSyncRows] = useState<AppSyncOutboxRow[]>([]);

  const loadDiagnostics = async () => {
    if (!window.bukowskiApp) {
      return;
    }

    try {
      const [nextDiagnostics, nextSupportSnapshot, nextSyncRows, nextUsersSnapshot] = await Promise.all([
        window.bukowskiApp.getDiagnostics(),
        window.bukowskiApp.getSupportSnapshot(),
        window.bukowskiApp.getSyncOutboxRows(),
        window.bukowskiApp.getUsersSnapshot({ workspaceId: activeWorkspaceId }),
      ]);
      setDiagnostics(nextDiagnostics);
      setSupportSnapshot(nextSupportSnapshot);
      setSyncRows(nextSyncRows);
      setUsersSnapshot(nextUsersSnapshot);
      setError(null);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "Settings are unavailable right now."));
    }
  };

  useEffect(() => {
    void loadDiagnostics();
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!error) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setError(null);
    }, 6500);

    return () => window.clearTimeout(timeoutId);
  }, [error]);

  const runAction = async (
    action: () => Promise<AppActionResult | AppExportResult>,
    stateSetter: (value: boolean) => void,
  ) => {
    try {
      stateSetter(true);
      const result = await action();
      toast.success("Settings action complete", result.summary);
      setError(null);

      if ("diagnostics" in result) {
        setDiagnostics(result.diagnostics);
        if (window.bukowskiApp) {
          const [nextSyncRows, nextSupportSnapshot, nextUsersSnapshot] = await Promise.all([
            window.bukowskiApp.getSyncOutboxRows(),
            window.bukowskiApp.getSupportSnapshot(),
            window.bukowskiApp.getUsersSnapshot({ workspaceId: activeWorkspaceId }),
          ]);
          setSyncRows(nextSyncRows);
          setSupportSnapshot(nextSupportSnapshot);
          setUsersSnapshot(nextUsersSnapshot);
        }
      } else {
        await loadDiagnostics();
      }
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "The app could not complete that settings action."));
    } finally {
      stateSetter(false);
    }
  };

  const dataHealthRows = useMemo(
    () => [
      {
        label: "Local data",
        value: diagnostics.databaseExists ? formatBytes(diagnostics.databaseSizeBytes) : "Not created yet",
      },
      {
        label: "Latest backup",
        value: diagnostics.backupExists ? formatBytes(diagnostics.backupSizeBytes) : "No backup available yet",
      },
      {
        label: "Last backup",
        value: formatDateLabel(diagnostics.lastBackupAt),
      },
      {
        label: "Data check",
        value: resolveIntegrityLabel(diagnostics.lastIntegrityCheckStatus),
      },
      {
        label: "Last integrity check",
        value: formatDateLabel(diagnostics.lastIntegrityCheckAt),
      },
      {
        label: "Device security",
        value: diagnostics.encryptionAvailable ? "Available" : "Unavailable on this device",
      },
    ],
    [diagnostics],
  );

  const syncHealthRows = useMemo(
    () => [
      {
        label: "Maintenance",
        value: formatDateLabel(diagnostics.lastRetentionRunAt),
      },
      {
        label: "Maintenance result",
        value: diagnostics.lastRetentionSummary ?? "Not run yet",
      },
      {
        label: "Last upload",
        value: formatDateLabel(diagnostics.lastSyncRunAt),
      },
      {
        label: "Upload status",
        value:
          diagnostics.lastSyncStatus === "healthy"
            ? "Healthy"
            : diagnostics.lastSyncStatus === "failed"
              ? "Failed"
              : "Idle",
      },
      {
        label: "Upload result",
        value: diagnostics.lastSyncSummary ?? "No sync run yet",
      },
      {
        label: "Waiting",
        value: String(diagnostics.syncOutboxPendingCount),
      },
      {
        label: "Uploading",
        value: String(diagnostics.syncOutboxProcessingCount),
      },
      {
        label: "Needs attention",
        value: String(diagnostics.syncOutboxFailedCount),
      },
    ],
    [diagnostics],
  );

  const formatSupportEvent = (event: AppSupportEventSummary | null, emptyLabel: string) =>
    event ? `${event.processLabel} · ${event.errorName} · ${formatDateLabel(event.occurredAt)}` : emptyLabel;

  const supportSummaryText = useMemo(
    () =>
      [
        `App: ${supportSnapshot.appInfo.appName} ${supportSnapshot.appInfo.version}`,
        `Platform: ${supportSnapshot.appInfo.platform}`,
        `Build: ${supportSnapshot.appInfo.isPackaged ? "Packaged build" : "Development build"}`,
        `Last crash: ${formatSupportEvent(supportSnapshot.lastCrash, "None captured yet")}`,
        `Last error: ${formatSupportEvent(supportSnapshot.lastError, "None captured yet")}`,
        `Last load failure: ${formatSupportEvent(supportSnapshot.lastLoadFailure, "None captured yet")}`,
        `Recent log files: ${supportSnapshot.recentLogFiles.map((file) => file.name).join(", ") || "None"}`,
      ].join("\n"),
    [supportSnapshot],
  );

  const selectedUser = useMemo(
    () => usersSnapshot.users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, usersSnapshot.users],
  );

  const selectedRole = useMemo(
    () => usersSnapshot.roles.find((role) => role.id === userDraft.roleId) ?? null,
    [userDraft.roleId, usersSnapshot.roles],
  );

  const selectedRoleCoverage = useMemo(
    () => (selectedRole ? getRoleCoverageLabels(selectedRole.permissionKeys) : []),
    [selectedRole],
  );

  const handleCrewMemberChange = (crewMemberId: string) => {
    const crewMember = catalog.crewMembers.find((row) => row.id === crewMemberId) ?? null;

    setUserDraft((current) => ({
      ...current,
      linkedCrewMemberId: crewMemberId,
      fullName: crewMember?.fullName ?? current.fullName,
      email: crewMember?.email || current.email,
      phone: crewMember?.phone || current.phone,
    }));
  };

  const teamSummaryRows = useMemo(
    () => [
      {
        label: "Active users",
        value: usersSnapshot.users.filter((user) => user.isActive).length,
        detail: `${usersSnapshot.users.length} total`,
      },
      {
        label: "Telegram linked",
        value: usersSnapshot.users.filter((user) => user.telegramLinkStatus === "linked").length,
        detail: `${usersSnapshot.users.filter((user) => user.readyForTelegram).length} ready`,
      },
      {
        label: "Roles",
        value: usersSnapshot.roles.length,
        detail: "Access presets",
      },
    ],
    [usersSnapshot.roles.length, usersSnapshot.users],
  );

  useEffect(() => {
    if (!usersSnapshot.roles.length && !usersSnapshot.users.length) {
      setUserDraft(buildUserDraft(null, []));
      setSelectedUserId("new");
      return;
    }

    if (selectedUserId !== "new" && !usersSnapshot.users.some((user) => user.id === selectedUserId)) {
      setSelectedUserId("new");
      return;
    }

    setUserDraft(buildUserDraft(selectedUser, usersSnapshot.roles));
  }, [selectedUser, selectedUserId, usersSnapshot.roles, usersSnapshot.users]);

  useEffect(() => {
    if (!usersSnapshot.roles.length) {
      setRoleDirectoryId("");
      return;
    }

    if (!roleDirectoryId || !usersSnapshot.roles.some((role) => role.id === roleDirectoryId)) {
      setRoleDirectoryId(selectedRole?.id ?? usersSnapshot.roles[0].id);
    }
  }, [roleDirectoryId, selectedRole?.id, usersSnapshot.roles]);

  const applyUserMutation = async (action: () => Promise<{ summary: string; snapshot: AppUsersSnapshot; userId: string | null }>) => {
    try {
      const result = await action();
      setUsersSnapshot(result.snapshot);
      toast.success("Users updated", result.summary);
      setError(null);
      setSelectedUserId(result.userId ?? "new");
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "The app could not update users."));
    }
  };

  const handleSaveUser = async () => {
    if (!window.bukowskiApp) {
      return;
    }

    setIsSavingUser(true);

    try {
      if (selectedUser) {
        await applyUserMutation(() =>
          window.bukowskiApp!.updateUser({
            workspaceId: activeWorkspaceId,
            userId: selectedUser.id,
            fullName: userDraft.fullName,
            email: userDraft.email,
            phone: userDraft.phone,
            roleId: userDraft.roleId,
            linkedCrewMemberId: userDraft.linkedCrewMemberId || undefined,
          }),
        );
      } else {
        await applyUserMutation(() =>
          window.bukowskiApp!.createUser({
            workspaceId: activeWorkspaceId,
            fullName: userDraft.fullName,
            email: userDraft.email,
            phone: userDraft.phone,
            roleId: userDraft.roleId,
            linkedCrewMemberId: userDraft.linkedCrewMemberId || undefined,
          }),
        );
      }
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleToggleUser = async () => {
    if (!window.bukowskiApp || !selectedUser) {
      return;
    }

    setIsTogglingUser(true);

    try {
      await applyUserMutation(() =>
        window.bukowskiApp!.setUserActive({
          workspaceId: activeWorkspaceId,
          userId: selectedUser.id,
          isActive: !selectedUser.isActive,
        }),
      );
    } finally {
      setIsTogglingUser(false);
    }
  };

  const handleRevokeTelegram = async () => {
    if (!window.bukowskiApp || !selectedUser) {
      return;
    }

    setIsRevokingTelegram(true);

    try {
      await applyUserMutation(() =>
        window.bukowskiApp!.revokeTelegramLink({
          workspaceId: activeWorkspaceId,
          userId: selectedUser.id,
        }),
      );
    } finally {
      setIsRevokingTelegram(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!window.bukowskiApp || !selectedUser) {
      return;
    }

    setIsDeletingUser(true);

    try {
      await applyUserMutation(() =>
        window.bukowskiApp!.deleteUser({
          workspaceId: activeWorkspaceId,
          userId: selectedUser.id,
        }),
      );
      setIsDeleteUserConfirmOpen(false);
    } finally {
      setIsDeletingUser(false);
    }
  };

  const canRequestUserDelete =
    Boolean(selectedUser) &&
    !selectedUser?.isActive &&
    selectedUser?.membershipStatus !== "active" &&
    selectedUser?.telegramLinkStatus !== "linked" &&
    selectedUser?.telegramLinkStatus !== "pending";

  return (
    <div className="page-stack settings-page">
      <SectionHeader title={activeSectionTitle} />

      {error ? <div className="form-inline-error">{error}</div> : null}

      <SettingsLayout>

      {activeSection === "general" ? (
        <div className="page-stack">
          <UserAccountSettings showHeader={false} />
          <SurfaceCard title="Preferences">
            <AutoLogoutSetting />
          </SurfaceCard>
        </div>
      ) : null}

      {activeSection === "team" ? (
        <div className="page-stack">
          <div className="settings-team-metrics">
            {teamSummaryRows.map((row) => (
              <div key={row.label} className="settings-team-metric">
                <span className="summary-label">{row.label}</span>
                <strong>{row.value}</strong>
                <span>{row.detail}</span>
              </div>
            ))}
          </div>

          <SettingsDisclosure
            title="Users"
            summary={`${usersSnapshot.users.length} user${usersSnapshot.users.length === 1 ? "" : "s"} · ${usersSnapshot.users.filter((user) => user.isActive).length} active`}
          >
            <div className="settings-team-layout">
              <SurfaceCard title="Users">
                <button className={`settings-user-row${selectedUserId === "new" ? " is-selected" : ""}`} onClick={() => setSelectedUserId("new")} type="button">
                  <span className="settings-user-create-mark">+</span>
                  <span className="settings-user-row-copy">
                    <span className="settings-user-row-topline">
                      <strong>Create user</strong>
                      <span>Add access</span>
                    </span>
                    <span className="settings-user-row-meta">Name, role and optional channel access.</span>
                  </span>
                </button>

                <div className="settings-user-list">
                  {usersSnapshot.users.map((user) => (
                    <button
                      key={user.id}
                      className={`settings-user-row${selectedUserId === user.id ? " is-selected" : ""}`}
                      onClick={() => setSelectedUserId(user.id)}
                      type="button"
                    >
                      <span
                        aria-label={user.isActive ? "active" : "inactive"}
                        className={`settings-user-status-dot settings-user-status-dot-${user.isActive ? "active" : "inactive"}`}
                      />
                      <span className="settings-user-row-copy">
                        <span className="settings-user-row-topline">
                          <strong>{user.fullName}</strong>
                          <span>{user.roleName ?? "No role"}</span>
                        </span>
                        <span className="settings-user-row-meta">
                          {user.isActive ? "Active" : "Inactive"}
                          {user.linkedCrewLabel ? ` · ${user.linkedCrewLabel}` : ""}
                        </span>
                        <UserChannelDots user={user} />
                      </span>
                    </button>
                  ))}
                </div>
              </SurfaceCard>

              <SurfaceCard
                title={selectedUser ? selectedUser.fullName : "Create user"}
                aside={
                  <span className={`run-status-pill run-status-pill-${selectedUser?.isActive ? "configured" : "disabled"}`}>
                    {selectedUser ? (selectedUser.isActive ? "Active" : "Inactive") : "New"}
                  </span>
                }
              >
                <div className="agent-form-grid">
                  <label className="field-block">
                    <span className="field-label">Full name</span>
                    <input
                      className="field-input"
                      onChange={(event) => setUserDraft((current) => ({ ...current, fullName: event.target.value }))}
                      placeholder="Full name"
                      value={userDraft.fullName}
                    />
                  </label>
                  <label className="field-block">
                    <span className="field-label">Role</span>
                    <select
                      className="field-input"
                      onChange={(event) => {
                        const nextRoleId = event.target.value;
                        setUserDraft((current) => ({ ...current, roleId: nextRoleId }));
                        setRoleDirectoryId(nextRoleId);
                      }}
                      value={userDraft.roleId}
                    >
                      <option value="">Select a role</option>
                      {usersSnapshot.roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-block">
                    <span className="field-label">Email</span>
                    <input
                      className="field-input"
                      onChange={(event) => setUserDraft((current) => ({ ...current, email: event.target.value }))}
                      placeholder="name@studio.com"
                      value={userDraft.email}
                    />
                  </label>
                  <label className="field-block">
                    <span className="field-label">Phone</span>
                    <input
                      className="field-input"
                      onChange={(event) => setUserDraft((current) => ({ ...current, phone: event.target.value }))}
                      placeholder="Optional phone"
                      value={userDraft.phone}
                    />
                  </label>
                  <label className="field-block field-block-span-2">
                    <span className="field-label">Crew member</span>
                    <select
                      className="field-input"
                      onChange={(event) => handleCrewMemberChange(event.target.value)}
                      value={userDraft.linkedCrewMemberId}
                    >
                      <option value="">No linked crew</option>
                      {catalog.crewMembers.map((crewMember) => (
                        <option key={crewMember.id} value={crewMember.id}>
                          {crewMember.fullName}
                          {crewMember.roleLabel ? ` · ${crewMember.roleLabel}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="settings-user-context-grid">
                  <div className="summary-row">
                    <span className="summary-label">Access</span>
                    <span className="summary-value">{selectedRoleCoverage.length ? selectedRoleCoverage.join(", ") : "Choose a role"}</span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">Telegram</span>
                    <span className="summary-value">
                      {selectedUser
                        ? selectedUser.telegramLinkStatus === "linked"
                          ? `${selectedUser.telegramDisplayName ?? selectedUser.fullName}`
                          : selectedUser.telegramLinkStatus === "pending"
                            ? "Pending link"
                            : selectedUser.telegramLinkStatus === "revoked"
                              ? "Revoked"
                              : "Not linked"
                        : "Create user first"}
                    </span>
                  </div>
                </div>

                {selectedUser?.telegramExternalUserId ? (
                  <div className="models-provider-diagnostic">
                    <span className="agent-detail-kicker">Telegram</span>
                    <p>
                      {selectedUser.telegramUsername ? `@${selectedUser.telegramUsername}` : selectedUser.telegramDisplayName ?? selectedUser.fullName}
                      {selectedUser.telegramLastSeenAt ? ` · last seen ${new Date(selectedUser.telegramLastSeenAt).toLocaleString()}` : ""}
                    </p>
                  </div>
                ) : null}

                <div className="action-panel-actions action-panel-actions-start">
                  <button
                    className="action-primary-button"
                    disabled={isSavingUser || !userDraft.fullName.trim() || !userDraft.roleId}
                    onClick={() => void handleSaveUser()}
                    type="button"
                  >
                    {isSavingUser ? "Saving..." : selectedUser ? "Save user" : "Add user"}
                  </button>
                  {selectedUser ? (
                    <button className="ghost-control" disabled={isTogglingUser} onClick={() => void handleToggleUser()} type="button">
                      {isTogglingUser ? "Updating..." : selectedUser.isActive ? "Deactivate" : "Activate"}
                    </button>
                  ) : null}
                  {selectedUser?.telegramLinkStatus === "linked" ? (
                    <button className="ghost-control" disabled={isRevokingTelegram} onClick={() => void handleRevokeTelegram()} type="button">
                      {isRevokingTelegram ? "Revoking..." : "Revoke Telegram"}
                    </button>
                  ) : null}
                  {selectedUser && canRequestUserDelete ? (
                    <button
                      className="ghost-control is-danger"
                      disabled={isDeletingUser}
                      onClick={() => setIsDeleteUserConfirmOpen(true)}
                      type="button"
                    >
                      Remove user
                    </button>
                  ) : null}
                  <button className="ghost-control" onClick={() => navigate("/agents/connectors")} type="button">
                    Channels
                  </button>
                </div>
              </SurfaceCard>
            </div>
          </SettingsDisclosure>

          <SettingsDisclosure
            title="Roles"
            summary={`${usersSnapshot.roles.length} role${usersSnapshot.roles.length === 1 ? "" : "s"} · access presets`}
          >
            <SurfaceCard title="Roles">
              <div className="settings-role-grid">
                {usersSnapshot.roles.map((role) => {
                  const coverageLabels = getRoleCoverageLabels(role.permissionKeys);

                  return (
                    <button
                      key={role.id}
                      className={`settings-role-card${roleDirectoryId === role.id ? " is-selected" : ""}`}
                      onClick={() => setRoleDirectoryId(role.id)}
                      type="button"
                    >
                      <span className="settings-role-card-head">
                        <strong>{role.name}</strong>
                        <span>{role.assignedUserCount} user{role.assignedUserCount === 1 ? "" : "s"}</span>
                      </span>
                      <span className="settings-role-card-copy">{roleUseCaseMap[role.key] ?? role.description}</span>
                      <span className="settings-role-access">{coverageLabels.length ? coverageLabels.join(" · ") : "No access"}</span>
                    </button>
                  );
                })}
              </div>
            </SurfaceCard>
          </SettingsDisclosure>

          <SettingsDisclosure title="Permission matrix" summary="Detailed access by role">
            <SurfaceCard title="Permission matrix">
              <RolesPermissionMatrix roles={usersSnapshot.roles} />
            </SurfaceCard>
          </SettingsDisclosure>
        </div>
      ) : null}

      {activeSection === "data" ? (
        <div className="settings-data-stack">
          <SurfaceCard title="Data health">
            <div className="summary-grid">
              {dataHealthRows.map((row) => (
                <div key={row.label} className="summary-row">
                  <span className="summary-label">{row.label}</span>
                  <span className="summary-value">{row.value}</span>
                </div>
              ))}
            </div>

            <div className="action-panel-actions action-panel-actions-start">
              <button
                className="action-primary-button"
                disabled={isCheckingIntegrity}
                onClick={() => void runAction(() => window.bukowskiApp!.runIntegrityCheck(), setIsCheckingIntegrity)}
                type="button"
              >
                {isCheckingIntegrity ? "Running integrity check..." : "Run integrity check"}
              </button>
              <button
                className="ghost-control"
                disabled={isCreatingBackup}
                onClick={() => void runAction(() => window.bukowskiApp!.createBackup(), setIsCreatingBackup)}
                type="button"
              >
                {isCreatingBackup ? "Creating backup..." : "Create backup now"}
              </button>
              <button
                className="ghost-control"
                disabled={isRunningLocalSync}
                onClick={() => void runAction(() => window.bukowskiApp!.runLocalSync(), setIsRunningLocalSync)}
                type="button"
              >
                {isRunningLocalSync ? "Syncing..." : "Run sync now"}
              </button>
            </div>
          </SurfaceCard>

          <SurfaceCard title="Sync activity">
            <div className="summary-grid">
              {syncHealthRows.map((row) => (
                <div key={row.label} className="summary-row">
                  <span className="summary-label">{row.label}</span>
                  <span className="summary-value">{row.value}</span>
                </div>
              ))}
              <div className="summary-row">
                <span className="summary-label">Visible queue rows</span>
                <span className="summary-value">{syncRows.length}</span>
              </div>
            </div>

            <div className="action-panel-actions action-panel-actions-start">
              <button className="action-primary-button" onClick={() => navigate("/settings/sync")} type="button">
                Open sync activity
              </button>
              <button
                className="ghost-control"
                disabled={!diagnostics.syncOutboxFailedCount || isRunningLocalSync}
                onClick={async () => {
                  if (!window.bukowskiApp) {
                    return;
                  }

                  await runAction(() => window.bukowskiApp!.retryAllFailedSyncOutboxRows(), setIsRunningLocalSync);
                }}
                type="button"
              >
                Retry all failed
              </button>
            </div>
          </SurfaceCard>
        </div>
      ) : null}

      {activeSection === "advanced" ? (
        <div className="settings-advanced-layout">
          <SurfaceCard className="settings-advanced-card settings-advanced-card-wide" title="Support">
            <div className="summary-grid">
              <div className="summary-row">
                <span className="summary-label">Last crash</span>
                <span className="summary-value">{formatSupportEvent(supportSnapshot.lastCrash, "None captured yet")}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Last error</span>
                <span className="summary-value">{formatSupportEvent(supportSnapshot.lastError, "None captured yet")}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Last load issue</span>
                <span className="summary-value">
                  {formatSupportEvent(supportSnapshot.lastLoadFailure, "No load issues captured")}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Log location</span>
                <span className="summary-value">{supportSnapshot.logStorageLabel}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Recent log files</span>
                <span className="summary-value">
                  {supportSnapshot.recentLogFiles.length
                    ? supportSnapshot.recentLogFiles
                        .map((file) => `${file.name} (${formatBytes(file.sizeBytes)})`)
                        .join(", ")
                    : "No log files yet"}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Critical events tracked</span>
                <span className="summary-value">{supportSnapshot.recentCriticalEvents.length}</span>
              </div>
            </div>

            <div className="action-panel-actions action-panel-actions-start">
              <button
                className="action-primary-button"
                disabled={isExportingSupportBundle}
                onClick={() => void runAction(() => window.bukowskiApp!.exportSupportBundle(), setIsExportingSupportBundle)}
                type="button"
              >
                {isExportingSupportBundle ? "Exporting support bundle..." : "Export support bundle"}
              </button>
              <button
                className="ghost-control"
                disabled={isExportingLogs}
                onClick={() => void runAction(() => window.bukowskiApp!.exportRecentLogs(), setIsExportingLogs)}
                type="button"
              >
                {isExportingLogs ? "Exporting logs..." : "Export recent logs"}
              </button>
              <button
                className="ghost-control"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(supportSummaryText);
                    toast.success("Copied", "Diagnostics summary copied.");
                    setError(null);
                  } catch (copyError) {
                    setError(getUserFacingErrorMessage(copyError, "The app could not copy the diagnostics summary."));
                  }
                }}
                type="button"
              >
                Copy diagnostics summary
              </button>
            </div>
          </SurfaceCard>

          <SurfaceCard className="settings-advanced-card" title="Data export">
            <div className="summary-grid">
              <div className="summary-row">
                <span className="summary-label">Format</span>
                <span className="summary-value">JSON</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Scope</span>
                <span className="summary-value">{activeWorkspaceName}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Build files</span>
                <span className="summary-value">
                  {diagnostics.internalBuildArtifacts.length ? diagnostics.internalBuildArtifacts.join(", ") : "Not packaged yet"}
                </span>
              </div>
            </div>

            <div className="action-panel-actions action-panel-actions-start">
              <button
                className="action-primary-button"
                disabled={isExporting}
                onClick={() => void runAction(() => window.bukowskiApp!.exportWorkspaceData(), setIsExporting)}
                type="button"
              >
                {isExporting ? "Exporting..." : "Export workspace JSON"}
              </button>
            </div>
          </SurfaceCard>

          <SurfaceCard className="settings-advanced-card" title="App info">
            <div className="summary-grid">
              <div className="summary-row">
                <span className="summary-label">App</span>
                <span className="summary-value">{appInfo?.appName ?? "bukowskiOS"}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Version</span>
                <span className="summary-value">{appInfo?.version ?? "Unknown"}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Build</span>
                <span className="summary-value">{appInfo?.shellVersion ?? "Unknown"}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Platform</span>
                <span className="summary-value">{appInfo?.platform ?? "Unknown"}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Mode</span>
                <span className="summary-value">{appInfo?.isPackaged ? "Packaged" : "Development"}</span>
              </div>
            </div>
          </SurfaceCard>

        </div>
      ) : null}
      </SettingsLayout>
      <ConfirmDialog
        body={
          selectedUser
            ? `${selectedUser.fullName} will be removed from this workspace. If they still own active assets, open packing slips, open incidents or Telegram access, the app will stop the removal and explain what to fix first.`
            : "This user will be removed from this workspace."
        }
        confirmLabel="Remove user"
        isOpen={isDeleteUserConfirmOpen}
        isSubmitting={isDeletingUser}
        onCancel={() => setIsDeleteUserConfirmOpen(false)}
        onConfirm={handleDeleteUser}
        title="Remove this user?"
        tone="danger"
      />
    </div>
  );
};
