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
import { DEFAULT_WORKSPACE_ID } from "@contracts";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useShellContext } from "@shared/hooks/useShellContext";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { getRenderFidelityAuditSummary, renderFidelityAudit } from "@shared/lib/renderFidelityAudit";
import { useCatalogData } from "@features/projects/useProjectsData";

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

type SettingsSectionKey = "overview" | "users" | "operations" | "advanced";

const settingsSections: Array<{ key: SettingsSectionKey; label: string; description: string }> = [
  { key: "overview", label: "General", description: "Quick health and access status." },
  { key: "users", label: "Team", description: "People, roles and channel readiness." },
  { key: "operations", label: "Data & Sync", description: "Database, backups and sync." },
  { key: "advanced", label: "Advanced", description: "Diagnostics, exports and internal tools." },
];

const permissionLabelMap: Record<string, string> = {
  "assets.read": "Read assets",
  "assets.manage": "Manage assets",
  "incidents.read": "Read incidents",
  "incidents.create": "Create incidents",
  "rma.read": "Read RMAs",
  "rma.create": "Create RMAs",
  "packing-slips.read": "Read packing slips",
  "packing-slips.create": "Create packing slips",
  "finance.read": "Read finance",
};

const roleCoverageGroups = [
  { label: "Assets", keys: ["assets.read", "assets.manage"] },
  { label: "Incidents", keys: ["incidents.read", "incidents.create"] },
  { label: "RMA", keys: ["rma.read", "rma.create"] },
  { label: "Packing", keys: ["packing-slips.read", "packing-slips.create"] },
  { label: "Finance", keys: ["finance.read"] },
] as const;

const roleUseCaseMap: Record<string, string> = {
  admin: "Best for workspace admins who need full operational control across teams.",
  supervisor: "Best for people coordinating the floor, supervising incidents and keeping approvals moving.",
  operations_supervisor: "Best for operations leads handling incidents, RMAs and packing without finance access.",
  vtr_operator: "Best for set operators who report equipment issues and need RMA-related follow-up.",
  logistics_operator: "Best for dispatch and returns flows, packing slips and asset movement.",
  maintenance_operator: "Best for repair workflows, incident follow-up and manufacturer cases.",
  finance_viewer: "Best for people who only need visibility into finance status and exposure.",
};

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
  roleId: user?.roleId ?? roles[0]?.id ?? "",
  linkedCrewMemberId: user?.linkedCrewId ?? "",
});

export const SettingsPage = () => {
  const { appInfo } = useShellContext();
  const { data: catalog } = useCatalogData();
  const navigate = useNavigate();
  const [diagnostics, setDiagnostics] = useState<AppDiagnosticsSnapshot>(emptyDiagnostics);
  const [supportSnapshot, setSupportSnapshot] = useState<AppSupportSnapshot>(emptySupportSnapshot);
  const [usersSnapshot, setUsersSnapshot] = useState<AppUsersSnapshot>(emptyUsersSnapshot);
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>("overview");
  const [roleDirectoryId, setRoleDirectoryId] = useState<string>("");
  const [selectedUserId, setSelectedUserId] = useState<string>("new");
  const [userDraft, setUserDraft] = useState<UserEditorDraft>(buildUserDraft(null, []));
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isRunningLocalSync, setIsRunningLocalSync] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingSupportBundle, setIsExportingSupportBundle] = useState(false);
  const [isExportingLogs, setIsExportingLogs] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [isTogglingUser, setIsTogglingUser] = useState(false);
  const [isRevokingTelegram, setIsRevokingTelegram] = useState(false);
  const [syncRows, setSyncRows] = useState<AppSyncOutboxRow[]>([]);
  const fidelityAuditSummary = useMemo(() => getRenderFidelityAuditSummary(), []);

  const loadDiagnostics = async () => {
    if (!window.bukowskiApp) {
      return;
    }

    try {
      const [nextDiagnostics, nextSupportSnapshot, nextSyncRows, nextUsersSnapshot] = await Promise.all([
        window.bukowskiApp.getDiagnostics(),
        window.bukowskiApp.getSupportSnapshot(),
        window.bukowskiApp.getSyncOutboxRows(),
        window.bukowskiApp.getUsersSnapshot(),
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
  }, []);

  const runAction = async (
    action: () => Promise<AppActionResult | AppExportResult>,
    stateSetter: (value: boolean) => void,
  ) => {
    try {
      stateSetter(true);
      const result = await action();
      setFeedback(result.summary);
      setError(null);

      if ("diagnostics" in result) {
        setDiagnostics(result.diagnostics);
        if (window.bukowskiApp) {
          const [nextSyncRows, nextSupportSnapshot, nextUsersSnapshot] = await Promise.all([
            window.bukowskiApp.getSyncOutboxRows(),
            window.bukowskiApp.getSupportSnapshot(),
            window.bukowskiApp.getUsersSnapshot(),
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

  const summaryRows = useMemo(
    () => [
      {
        label: "Database file",
        value: diagnostics.databaseExists ? formatBytes(diagnostics.databaseSizeBytes) : "Not created yet",
      },
      {
        label: "Backup file",
        value: diagnostics.backupExists ? formatBytes(diagnostics.backupSizeBytes) : "No backup available yet",
      },
      {
        label: "Last backup",
        value: formatDateLabel(diagnostics.lastBackupAt),
      },
      {
        label: "Integrity status",
        value: resolveIntegrityLabel(diagnostics.lastIntegrityCheckStatus),
      },
      {
        label: "Last integrity check",
        value: formatDateLabel(diagnostics.lastIntegrityCheckAt),
      },
      {
        label: "Last retention pass",
        value: formatDateLabel(diagnostics.lastRetentionRunAt),
      },
      {
        label: "Retention result",
        value: diagnostics.lastRetentionSummary ?? "No retention pass has run yet",
      },
      {
        label: "Last local sync pass",
        value: formatDateLabel(diagnostics.lastSyncRunAt),
      },
      {
        label: "Local sync status",
        value:
          diagnostics.lastSyncStatus === "healthy"
            ? "Healthy"
            : diagnostics.lastSyncStatus === "failed"
              ? "Failed"
              : "Not run yet",
      },
      {
        label: "Local sync result",
        value: diagnostics.lastSyncSummary ?? "No local sync pass has run yet",
      },
      {
        label: "Outbox pending",
        value: String(diagnostics.syncOutboxPendingCount),
      },
      {
        label: "Outbox processing",
        value: String(diagnostics.syncOutboxProcessingCount),
      },
      {
        label: "Outbox failed",
        value: String(diagnostics.syncOutboxFailedCount),
      },
      {
        label: "Secure local encryption",
        value: diagnostics.encryptionAvailable ? "Available" : "Unavailable on this device",
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
    () =>
      selectedRole
        ? roleCoverageGroups
            .filter((group) => group.keys.some((key) => selectedRole.permissionKeys.includes(key)))
            .map((group) => group.label)
        : [],
    [selectedRole],
  );

  const focusedRole = useMemo(
    () => usersSnapshot.roles.find((role) => role.id === roleDirectoryId) ?? selectedRole ?? usersSnapshot.roles[0] ?? null,
    [roleDirectoryId, selectedRole, usersSnapshot.roles],
  );

  const focusedRoleCoverage = useMemo(
    () =>
      focusedRole
        ? roleCoverageGroups
            .map((group) => ({
              label: group.label,
              permissions: group.keys.filter((key) => focusedRole.permissionKeys.includes(key)).map((key) => permissionLabelMap[key] ?? key),
            }))
            .filter((group) => group.permissions.length > 0)
        : [],
    [focusedRole],
  );

  const userSummaryRows = useMemo(
    () => [
      { label: "Users", value: usersSnapshot.users.length },
      { label: "Active", value: usersSnapshot.users.filter((user) => user.isActive).length },
      { label: "Ready for Telegram", value: usersSnapshot.users.filter((user) => user.readyForTelegram).length },
      { label: "Linked on Telegram", value: usersSnapshot.users.filter((user) => user.telegramLinkStatus === "linked").length },
    ],
    [usersSnapshot.users],
  );

  const overviewRows = useMemo(
    () => [
      { label: "App", value: `${appInfo?.appName ?? "bukowskiOS"} ${appInfo?.version ?? "Unknown"}` },
      { label: "Platform", value: appInfo?.platform ?? "Unknown" },
      { label: "Active users", value: usersSnapshot.users.filter((user) => user.isActive).length },
      { label: "Telegram ready", value: usersSnapshot.users.filter((user) => user.readyForTelegram).length },
      { label: "Integrity", value: resolveIntegrityLabel(diagnostics.lastIntegrityCheckStatus) },
      { label: "Failed sync rows", value: diagnostics.syncOutboxFailedCount },
    ],
    [appInfo?.appName, appInfo?.platform, appInfo?.version, diagnostics.lastIntegrityCheckStatus, diagnostics.syncOutboxFailedCount, usersSnapshot.users],
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
      setFeedback(result.summary);
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
            workspaceId: DEFAULT_WORKSPACE_ID,
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
            workspaceId: DEFAULT_WORKSPACE_ID,
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
          workspaceId: DEFAULT_WORKSPACE_ID,
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
          workspaceId: DEFAULT_WORKSPACE_ID,
          userId: selectedUser.id,
        }),
      );
    } finally {
      setIsRevokingTelegram(false);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader title="Settings" />

      {error ? <div className="form-inline-error">{error}</div> : null}
      {feedback ? <div className="action-feedback action-feedback-success">{feedback}</div> : null}

      <SurfaceCard title="Sections">
        <div className="settings-subnav-grid">
          {settingsSections.map((section) => (
            <button
              key={section.key}
              className={`settings-subnav-button${activeSection === section.key ? " is-active" : ""}`}
              onClick={() => setActiveSection(section.key)}
              type="button"
            >
              <strong>{section.label}</strong>
              <span>{section.description}</span>
            </button>
          ))}
        </div>
      </SurfaceCard>

      {activeSection === "overview" ? (
        <>
          <SurfaceCard title="General">
            <div className="summary-grid">
              {overviewRows.map((row) => (
                <div key={row.label} className="summary-row">
                  <span className="summary-label">{row.label}</span>
                  <span className="summary-value">{row.value}</span>
                </div>
              ))}
            </div>

            <div className="action-panel-actions action-panel-actions-start">
              <button className="action-primary-button" onClick={() => setActiveSection("users")} type="button">
                Open team
              </button>
              <button className="ghost-control" onClick={() => setActiveSection("operations")} type="button">
                Open data & sync
              </button>
              <button className="ghost-control" onClick={() => setActiveSection("advanced")} type="button">
                Open advanced
              </button>
            </div>
          </SurfaceCard>
        </>
      ) : null}

      {activeSection === "users" ? (
        <SurfaceCard title="Team">
          <div className="summary-grid">
            {userSummaryRows.map((row) => (
              <div key={row.label} className="summary-row">
                <span className="summary-label">{row.label}</span>
                <span className="summary-value">{row.value}</span>
              </div>
            ))}
          </div>

          <div className="users-admin-layout">
            <div className="users-admin-list">
              <button
                className={`models-provider-row${selectedUserId === "new" ? " is-selected" : ""}`}
                onClick={() => setSelectedUserId("new")}
                type="button"
              >
                <div className="models-provider-row-copy">
                  <div className="models-provider-row-topline">
                    <strong className="provider-heading">
                      <span>New user</span>
                    </strong>
                    <span className="subtle-pill">Create</span>
                  </div>
                  <div className="agent-detail-row">
                    <span>Add a new internal user</span>
                    <span>Users & roles</span>
                  </div>
                </div>
              </button>

              <div className="models-provider-list">
                {usersSnapshot.users.map((user) => (
                  <button
                    key={user.id}
                    className={`models-provider-row${selectedUserId === user.id ? " is-selected" : ""}${
                      user.isActive ? " is-active-provider" : " is-inactive-provider"
                    }`}
                    onClick={() => setSelectedUserId(user.id)}
                    type="button"
                  >
                    <span
                      aria-label={user.isActive ? "active" : "inactive"}
                      className={`agent-live-dot agent-live-dot-${user.isActive ? "green" : "red"}`}
                    />
                    <div className="models-provider-row-copy">
                      <div className="models-provider-row-topline">
                        <strong className="provider-heading">
                          <span>{user.fullName}</span>
                        </strong>
                        <span className="subtle-pill">{user.roleName ?? "No role"}</span>
                      </div>
                      <div className="agent-detail-row">
                        <span>{user.membershipStatus === "active" ? "Workspace active" : "Workspace blocked"}</span>
                        <span>{user.telegramLinkStatus === "linked" ? "Telegram linked" : user.telegramLinkStatus === "pending" ? "Telegram pending" : "No Telegram"}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="users-admin-editor">
              <div className="agent-detail-row">
                <span className={`run-status-pill run-status-pill-${selectedUser?.isActive ? "configured" : "disabled"}`}>
                  {selectedUser ? (selectedUser.isActive ? "active" : "inactive") : "create"}
                </span>
                <span className="subtle-pill">
                  {selectedUser ? `Membership: ${selectedUser.membershipStatus}` : "A new user gets an active membership"}
                </span>
              </div>

              <div className="agent-form-grid">
                <label className="field-block">
                  <span className="field-label">Full name</span>
                  <input
                    className="field-input"
                    onChange={(event) => setUserDraft((current) => ({ ...current, fullName: event.target.value }))}
                    placeholder="Daniel VTR"
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
                        {role.name} · {role.description}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-block">
                  <span className="field-label">Email</span>
                  <input
                    className="field-input"
                    onChange={(event) => setUserDraft((current) => ({ ...current, email: event.target.value }))}
                    placeholder="optional@metadata.cine"
                    value={userDraft.email}
                  />
                </label>
                <label className="field-block">
                  <span className="field-label">Phone</span>
                  <input
                    className="field-input"
                    onChange={(event) => setUserDraft((current) => ({ ...current, phone: event.target.value }))}
                    placeholder="+1 809 ..."
                    value={userDraft.phone}
                  />
                </label>
                <label className="field-block field-block-span-2">
                  <span className="field-label">Linked crew member</span>
                  <select
                    className="field-input"
                    onChange={(event) => setUserDraft((current) => ({ ...current, linkedCrewMemberId: event.target.value }))}
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

              <div className="models-provider-diagnostic">
                <span className="agent-detail-kicker">Selected role</span>
                <p>
                  {selectedRole ? `${selectedRole.name} · ${selectedRole.description}` : "Choose the main role for this user."}
                </p>
              </div>

              <div className="summary-grid">
                <div className="summary-row">
                  <span className="summary-label">Role permissions</span>
                  <span className="summary-value">
                    {selectedRole?.permissionKeys.length
                      ? selectedRole.permissionKeys.map((permission) => permissionLabelMap[permission] ?? permission).join(", ")
                      : "No permissions on this role"}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Role coverage</span>
                  <span className="summary-value">{selectedRoleCoverage.length ? selectedRoleCoverage.join(", ") : "No access areas yet"}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Crew link</span>
                  <span className="summary-value">{selectedUser?.linkedCrewLabel ?? "No linked crew yet"}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Telegram</span>
                  <span className="summary-value">
                    {selectedUser
                      ? selectedUser.telegramLinkStatus === "linked"
                        ? `${selectedUser.telegramDisplayName ?? selectedUser.fullName} linked`
                        : selectedUser.telegramLinkStatus === "pending"
                          ? "Pending link"
                          : selectedUser.telegramLinkStatus === "revoked"
                            ? "Revoked"
                            : "Not linked"
                      : "Create the user first"}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Ready for Telegram</span>
                  <span className="summary-value">{selectedUser ? (selectedUser.readyForTelegram ? "Yes" : "No") : "Will be checked after save"}</span>
                </div>
              </div>

              {selectedUser?.telegramExternalUserId ? (
                <div className="models-provider-diagnostic">
                  <span className="agent-detail-kicker">Telegram identity</span>
                  <p>
                    {selectedUser.telegramDisplayName ?? selectedUser.fullName}
                    {selectedUser.telegramUsername ? ` · @${selectedUser.telegramUsername}` : ""}
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
                  {isSavingUser ? "Saving user..." : selectedUser ? "Save user" : "Create user"}
                </button>
                {selectedUser ? (
                  <button className="ghost-control" disabled={isTogglingUser} onClick={() => void handleToggleUser()} type="button">
                    {isTogglingUser ? "Updating state..." : selectedUser.isActive ? "Deactivate user" : "Activate user"}
                  </button>
                ) : null}
                {selectedUser?.telegramLinkStatus === "linked" ? (
                  <button className="ghost-control" disabled={isRevokingTelegram} onClick={() => void handleRevokeTelegram()} type="button">
                    {isRevokingTelegram ? "Revoking..." : "Revoke Telegram"}
                  </button>
                ) : null}
                <button className="ghost-control" onClick={() => navigate("/agents/connectors")} type="button">
                  Open channels
                </button>
              </div>
            </div>
          </div>

          <div className="roles-directory">
            <div className="surface-card-header">
              <div>
                <h3 className="surface-card-title">Role directory</h3>
                <p className="surface-card-subtitle">
                  Roles stay simple in v1: one main role per user, with permissions inherited from the role instead of custom per-user overrides.
                </p>
              </div>
            </div>

            <div className="roles-directory-layout">
              <div className="roles-directory-list">
                {usersSnapshot.roles.map((role) => (
                  <button
                    key={role.id}
                    className={`role-directory-row${focusedRole?.id === role.id ? " is-selected" : ""}`}
                    onClick={() => setRoleDirectoryId(role.id)}
                    type="button"
                  >
                    <div className="role-directory-row-topline">
                      <strong>{role.name}</strong>
                      <span className="subtle-pill">{role.assignedUserCount} assigned</span>
                    </div>
                    <span>{role.description}</span>
                  </button>
                ))}
              </div>

              <div className="role-detail-card">
                {focusedRole ? (
                  <>
                    <div className="role-card-header">
                      <strong>{focusedRole.name}</strong>
                      <span className="subtle-pill">{focusedRole.assignedUserCount} assigned</span>
                    </div>

                    <p className="role-card-description">{roleUseCaseMap[focusedRole.key] ?? focusedRole.description}</p>

                    <div className="summary-grid">
                      <div className="summary-row">
                        <span className="summary-label">Role purpose</span>
                        <span className="summary-value">{focusedRole.description}</span>
                      </div>
                      <div className="summary-row">
                        <span className="summary-label">Access areas</span>
                        <span className="summary-value">
                          {focusedRoleCoverage.length ? focusedRoleCoverage.map((group) => group.label).join(", ") : "No access yet"}
                        </span>
                      </div>
                      <div className="summary-row">
                        <span className="summary-label">Permission count</span>
                        <span className="summary-value">{focusedRole.permissionKeys.length}</span>
                      </div>
                      <div className="summary-row">
                        <span className="summary-label">System role</span>
                        <span className="summary-value">{focusedRole.isSystemRole ? "Yes" : "No"}</span>
                      </div>
                    </div>

                    <div className="role-detail-sections">
                      <div className="role-detail-block">
                        <span className="agent-detail-kicker">Can do</span>
                        <div className="role-card-permissions">
                          {focusedRole.permissionKeys.map((permission) => (
                            <span key={`${focusedRole.id}-${permission}`} className="role-permission-chip">
                              {permissionLabelMap[permission] ?? permission}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="role-detail-block">
                        <span className="agent-detail-kicker">Coverage by area</span>
                        <div className="role-coverage-list">
                          {focusedRoleCoverage.map((group) => (
                            <div key={`${focusedRole.id}-${group.label}`} className="role-coverage-row">
                              <strong>{group.label}</strong>
                              <span>{group.permissions.join(", ")}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="catalog-crew-support-empty">No roles available yet.</div>
                )}
              </div>
            </div>
          </div>
        </SurfaceCard>
      ) : null}

      {activeSection === "operations" ? (
        <>
          <SurfaceCard title="Database">
            <div className="summary-grid">
              {summaryRows.map((row) => (
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

          <SurfaceCard title="Sync">
            <div className="summary-grid">
              <div className="summary-row">
                <span className="summary-label">Visible rows</span>
                <span className="summary-value">{syncRows.length}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Failed rows</span>
                <span className="summary-value">{diagnostics.syncOutboxFailedCount}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Pending rows</span>
                <span className="summary-value">{diagnostics.syncOutboxPendingCount}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Processing rows</span>
                <span className="summary-value">{diagnostics.syncOutboxProcessingCount}</span>
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
        </>
      ) : null}

      {activeSection === "advanced" ? (
        <>
          <SurfaceCard title="App Info">
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
                <span className="summary-label">Desktop build</span>
                <span className="summary-value">{appInfo?.shellVersion ?? "Unknown"}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Platform</span>
                <span className="summary-value">{appInfo?.platform ?? "Unknown"}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Build type</span>
                <span className="summary-value">{appInfo?.isPackaged ? "Packaged" : "Development"}</span>
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard title="Visual Audit">
            <div className="summary-grid">
              <div className="summary-row">
                <span className="summary-label">Total audited</span>
                <span className="summary-value">{fidelityAuditSummary.total}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Vector candidates</span>
                <span className="summary-value">{fidelityAuditSummary.vectorCandidates}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Raster keepers</span>
                <span className="summary-value">{fidelityAuditSummary.rasterItems}</span>
              </div>
              {renderFidelityAudit.map((item) => (
                <div key={item.id} className="summary-row">
                  <span className="summary-label">{item.label}</span>
                  <span className="summary-value">{`${item.currentKind} to ${item.recommendedKind}`}</span>
                </div>
              ))}
            </div>
          </SurfaceCard>

          <SurfaceCard title="Data Export">
            <div className="summary-grid">
              <div className="summary-row">
                <span className="summary-label">Build artifacts</span>
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
                {isExporting ? "Exporting..." : "Export all data as JSON"}
              </button>
            </div>
          </SurfaceCard>

          <SurfaceCard title="Support">
            <div className="summary-grid">
              <div className="summary-row">
                <span className="summary-label">Last crash</span>
                <span className="summary-value">{formatSupportEvent(supportSnapshot.lastCrash, "None captured yet")}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Last strong error</span>
                <span className="summary-value">{formatSupportEvent(supportSnapshot.lastError, "None captured yet")}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Last load failure</span>
                <span className="summary-value">
                  {formatSupportEvent(supportSnapshot.lastLoadFailure, "No did-fail-load or render-process-gone yet")}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Logs</span>
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
                    setFeedback("Copied the diagnostics summary.");
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
        </>
      ) : null}
    </div>
  );
};
