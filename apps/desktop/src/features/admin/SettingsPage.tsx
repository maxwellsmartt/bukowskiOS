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
import { useTranslation } from "react-i18next";

import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useCatalogData } from "@features/projects/useProjectsData";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useConfirmDialog } from "@shared/hooks/useConfirmDialog";
import { useLocale } from "@shared/hooks/useLocale";
import { useShellContext } from "@shared/hooks/useShellContext";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { notifyExportResult } from "@shared/lib/exportNotifications";

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
  databaseEncrypted: false,
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

import { GeneralSettingsCard } from "./GeneralSettingsCard";
import { SettingsLayout, useActiveSettingsSection, useSettingsNavLabels } from "./SettingsLayout";
import { UserChannelDots } from "./UserChannelDots";
import { UserAccountSettings } from "./UserAccountSettings";

/**
 * Each role-coverage group ships a stable id; the human label lives in
 * the `settings.roleCoverage.*` catalog and is resolved at render time.
 */
const roleCoverageGroups = [
  { id: "assets", keys: ["assets.read", "assets.manage", "licenses.manage"] },
  { id: "incidents", keys: ["incidents.read", "incidents.create"] },
  { id: "rma", keys: ["rma.read", "rma.create"] },
  { id: "packing", keys: ["packing-slips.read", "packing-slips.create"] },
  {
    id: "finance",
    keys: [
      "finance.read",
      "quotes.read",
      "quotes.create",
      "quotes.edit",
      "quotes.export",
      "invoices.read",
      "invoices.create",
      "invoices.record_payment",
      "currency.manage_rates",
      "crew_fees.read",
      "crew_fees.manage",
      "crew_payments.record",
    ],
  },
] as const;

type RoleCoverageId = (typeof roleCoverageGroups)[number]["id"];

const ROLE_USE_CASE_KEYS: Record<string, string> = {
  admin: "settings.roleUseCase.admin",
  crew: "settings.roleUseCase.crew",
  supervisor: "settings.roleUseCase.supervisor",
  finance_viewer: "settings.roleUseCase.finance_viewer",
  maintenance: "settings.roleUseCase.maintenance",
};

const getRoleCoverageIds = (permissionKeys: string[]): RoleCoverageId[] =>
  roleCoverageGroups
    .filter((group) => group.keys.some((key) => permissionKeys.includes(key)))
    .map((group) => group.id);

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

// `formatDateLabel` is now created inside the SettingsPage component so it
// can use the user's synced locale via `useLocale()`. See the call site
// below for the closure.

/** Returns an i18n key suffix (`healthy` / `failed` / …) — translate at call site. */
const integrityLabelKey = (
  status: AppDiagnosticsSnapshot["lastIntegrityCheckStatus"],
): "healthy" | "failed" | "pending" => {
  if (status === "healthy") return "healthy";
  if (status === "failed") return "failed";
  return "pending";
};

type StatTone = "positive" | "warning" | "critical" | "neutral";

type SettingsStat = {
  label: string;
  value: string;
  /** When set, the value renders as a colored status pill. */
  tone?: StatTone;
};

const integrityTone = (status: AppDiagnosticsSnapshot["lastIntegrityCheckStatus"]): StatTone => {
  if (status === "healthy") return "positive";
  if (status === "failed") return "critical";
  return "neutral";
};

const SettingsStatRow = ({ stat }: { stat: SettingsStat }) => (
  <div className="summary-row settings-stat-row">
    <span className="summary-label">{stat.label}</span>
    {stat.tone ? (
      <span className="settings-stat-value-wrap">
        <span className={`settings-stat-pill is-${stat.tone}`}>{stat.value}</span>
      </span>
    ) : (
      <span className="summary-value">{stat.value}</span>
    )}
  </div>
);

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
  "quotes.read": "View quotes",
  "quotes.create": "Create quotes",
  "quotes.edit": "Edit quotes",
  "quotes.export": "Export quotes",
  "invoices.read": "View invoices",
  "invoices.create": "Create invoices",
  "invoices.record_payment": "Record invoice payments",
  "currency.manage_rates": "Manage currency settings",
  "crew_fees.read": "View crew fees",
  "crew_fees.manage": "Manage crew fees",
  "crew_payments.record": "Record crew payments",
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
  if (key.startsWith("quotes.")) return "Finance";
  if (key.startsWith("invoices.")) return "Finance";
  if (key.startsWith("currency.")) return "Finance";
  if (key.startsWith("crew_fees.") || key.startsWith("crew_payments.")) return "Finance";
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
  const { t } = useTranslation();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { formatDateTime } = useLocale();
  const formatDateLabel = (value: string | null) => {
    if (!value) return t("common.never");
    return formatDateTime(value) || value;
  };
  const [diagnostics, setDiagnostics] = useState<AppDiagnosticsSnapshot>(emptyDiagnostics);
  const [supportSnapshot, setSupportSnapshot] = useState<AppSupportSnapshot>(emptySupportSnapshot);
  const [usersSnapshot, setUsersSnapshot] = useState<AppUsersSnapshot>(emptyUsersSnapshot);
  const activeSection = useActiveSettingsSection();
  const navLabelsFor = useSettingsNavLabels();
  const activeSectionTitle = navLabelsFor(activeSection).label;
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
      if ("saved" in result) {
        notifyExportResult(toast, result, {
          successTitle: t("settings.actions.completeTitle"),
          cancelledTitle: t("common.exportCancelled"),
          cancelledBody: t("common.exportCancelledBody"),
        });
      } else {
        toast.success(t("settings.actions.completeTitle"), result.summary);
      }
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
      setError(getUserFacingErrorMessage(nextError, t("settings.actions.couldNotComplete")));
    } finally {
      stateSetter(false);
    }
  };

  const confirmSensitiveExport = async (kind: "workspaceData" | "supportBundle" | "logs") => {
    const exportCopy =
      kind === "workspaceData"
        ? {
            title: t("settings.advanced.dataExport.confirmTitle", { defaultValue: "Exportar datos del workspace" }),
            body: t("settings.advanced.dataExport.confirmBody", {
              defaultValue:
                "Este archivo puede incluir datos operativos y financieros del workspace actual. Úsalo solo para soporte o respaldo controlado.",
            }),
            confirmLabel: t("settings.advanced.dataExport.confirmAction", { defaultValue: "Exportar de todos modos" }),
          }
        : kind === "supportBundle"
          ? {
              title: t("settings.advanced.support.confirmBundleTitle", { defaultValue: "Exportar support bundle" }),
              body: t("settings.advanced.support.confirmBundleBody", {
                defaultValue:
                  "El support bundle puede incluir diagnósticos, errores recientes y metadata local redactada. Compártelo solo con personas de confianza.",
              }),
              confirmLabel: t("settings.advanced.support.confirmBundleAction", { defaultValue: "Exportar bundle" }),
            }
          : {
              title: t("settings.advanced.support.confirmLogsTitle", { defaultValue: "Exportar logs recientes" }),
              body: t("settings.advanced.support.confirmLogsBody", {
                defaultValue:
                  "Los logs salen redactados, pero igual pueden revelar contexto operativo. Verifica el destinatario antes de compartirlos.",
              }),
              confirmLabel: t("settings.advanced.support.confirmLogsAction", { defaultValue: "Exportar logs" }),
            };

    return confirm({
      title: exportCopy.title,
      body: exportCopy.body,
      confirmLabel: exportCopy.confirmLabel,
      details: (
        <div className="summary-grid">
          <div className="summary-row">
            <span className="summary-label">{t("settings.advanced.dataExport.scope", { defaultValue: "Scope" })}</span>
            <span className="summary-value">{activeWorkspaceName}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("settings.advanced.dataExport.format", { defaultValue: "Format" })}</span>
            <span className="summary-value">
              {kind === "workspaceData" ? "JSON" : kind === "supportBundle" ? "Bundle" : "TXT"}
            </span>
          </div>
        </div>
      ),
      tone: "danger",
    });
  };

  const dataHealthRows = useMemo<SettingsStat[]>(
    () => [
      {
        label: t("settings.data.rows.localData"),
        value: diagnostics.databaseExists ? formatBytes(diagnostics.databaseSizeBytes) : t("settings.data.rows.notCreated"),
      },
      {
        label: t("settings.data.rows.latestBackup"),
        value: diagnostics.backupExists ? formatBytes(diagnostics.backupSizeBytes) : t("settings.data.rows.noBackup"),
      },
      {
        label: t("settings.data.rows.lastBackup"),
        value: formatDateLabel(diagnostics.lastBackupAt),
      },
      {
        label: t("settings.data.rows.dataCheck"),
        value: t(`settings.integrity.${integrityLabelKey(diagnostics.lastIntegrityCheckStatus)}`),
        tone: integrityTone(diagnostics.lastIntegrityCheckStatus),
      },
      {
        label: t("settings.data.rows.localDbEncryption"),
        value: diagnostics.databaseEncrypted
          ? t("settings.data.rows.localDbEncrypted")
          : t("settings.data.rows.localDbUnencrypted"),
        tone: diagnostics.databaseEncrypted ? "positive" : "warning",
      },
      {
        label: t("settings.data.rows.lastIntegrityCheck"),
        value: formatDateLabel(diagnostics.lastIntegrityCheckAt),
      },
      {
        label: t("settings.data.rows.deviceSecurity"),
        value: diagnostics.encryptionAvailable
          ? t("settings.data.rows.deviceSecAvailable")
          : t("settings.data.rows.deviceSecUnavailable"),
        tone: diagnostics.encryptionAvailable ? "positive" : "warning",
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [diagnostics, t],
  );

  const syncHealthRows = useMemo<SettingsStat[]>(
    () => [
      {
        label: t("settings.data.rows.maintenance"),
        value: formatDateLabel(diagnostics.lastRetentionRunAt),
      },
      {
        label: t("settings.data.rows.maintenanceResult"),
        value: !diagnostics.lastRetentionSummary
          ? t("settings.data.rows.maintenanceNotRun")
          : diagnostics.lastRetentionSummary === "Nothing to purge in this pass."
            ? t("settings.data.rows.maintenanceClean")
            : diagnostics.lastRetentionSummary,
      },
      {
        label: t("settings.data.rows.lastUpload"),
        value: formatDateLabel(diagnostics.lastSyncRunAt),
      },
      {
        label: t("settings.data.rows.uploadStatus"),
        value:
          diagnostics.lastSyncStatus === "healthy"
            ? t("settings.data.rows.uploadStatusHealthy")
            : diagnostics.lastSyncStatus === "failed"
              ? t("settings.data.rows.uploadStatusFailed")
              : t("settings.data.rows.uploadStatusIdle"),
        tone:
          diagnostics.lastSyncStatus === "healthy"
            ? "positive"
            : diagnostics.lastSyncStatus === "failed"
              ? "critical"
              : "neutral",
      },
      {
        label: t("settings.data.rows.uploadResult"),
        value: !diagnostics.lastSyncRunAt
          ? t("settings.data.rows.uploadResultNone")
          : diagnostics.syncOutboxPendingCount === 0 && diagnostics.syncOutboxFailedCount === 0
            ? t("settings.data.rows.uploadResultClean")
            : t("settings.data.rows.uploadResultCounts", {
                pending: diagnostics.syncOutboxPendingCount,
                failed: diagnostics.syncOutboxFailedCount,
              }),
        tone: diagnostics.syncOutboxFailedCount > 0 ? "critical" : undefined,
      },
      {
        label: t("settings.data.rows.waiting"),
        value: String(diagnostics.syncOutboxPendingCount),
      },
      {
        label: t("settings.data.rows.uploading"),
        value: String(diagnostics.syncOutboxProcessingCount),
      },
      {
        label: t("settings.data.rows.needsAttention"),
        value: String(diagnostics.syncOutboxFailedCount),
        tone: diagnostics.syncOutboxFailedCount > 0 ? "critical" : "positive",
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [diagnostics, t],
  );

  const formatSupportEvent = (event: AppSupportEventSummary | null, emptyLabel: string) =>
    event ? `${event.processLabel} · ${event.errorName} · ${formatDateLabel(event.occurredAt)}` : emptyLabel;

  const supportSummaryText = useMemo(
    () =>
      [
        `${t("settings.advanced.appInfo.app")}: ${supportSnapshot.appInfo.appName} ${supportSnapshot.appInfo.version}`,
        `${t("settings.advanced.appInfo.platform")}: ${supportSnapshot.appInfo.platform}`,
        `${t("settings.advanced.appInfo.build")}: ${supportSnapshot.appInfo.isPackaged ? t("settings.advanced.appInfo.packaged") : t("settings.advanced.appInfo.development")}`,
        `${t("settings.advanced.support.lastCrash")}: ${formatSupportEvent(supportSnapshot.lastCrash, t("settings.advanced.support.noneCaptured"))}`,
        `${t("settings.advanced.support.lastError")}: ${formatSupportEvent(supportSnapshot.lastError, t("settings.advanced.support.noneCaptured"))}`,
        `${t("settings.advanced.support.lastLoadIssue")}: ${formatSupportEvent(supportSnapshot.lastLoadFailure, t("settings.advanced.support.noneCaptured"))}`,
        `${t("settings.advanced.support.recentLogFiles")}: ${supportSnapshot.recentLogFiles.map((file) => file.name).join(", ") || t("common.none")}`,
      ].join("\n"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supportSnapshot, t],
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
        ? getRoleCoverageIds(selectedRole.permissionKeys).map((id) => t(`settings.roleCoverage.${id}`))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedRole, t],
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
        label: t("settings.team.metrics.activeUsers"),
        value: usersSnapshot.users.filter((user) => user.isActive).length,
        detail: t("settings.team.metrics.activeUsersDetail", { count: usersSnapshot.users.length }),
      },
      {
        label: t("settings.team.metrics.telegramLinked"),
        value: usersSnapshot.users.filter((user) => user.telegramLinkStatus === "linked").length,
        detail: t("settings.team.metrics.telegramLinkedDetail", {
          count: usersSnapshot.users.filter((user) => user.readyForTelegram).length,
        }),
      },
      {
        label: t("settings.team.metrics.rolesLabel"),
        value: usersSnapshot.roles.length,
        detail: t("settings.team.metrics.rolesDetail"),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [usersSnapshot.roles.length, usersSnapshot.users, t],
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
      toast.success(t("settings.actions.usersUpdatedTitle"), result.summary);
      setError(null);
      setSelectedUserId(result.userId ?? "new");
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("settings.actions.couldNotUpdateUsers")));
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
          <GeneralSettingsCard />
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
            title={t("settings.team.usersDisclosure.title")}
            summary={t("settings.team.usersDisclosure.summary", {
              count: usersSnapshot.users.length,
              active: usersSnapshot.users.filter((user) => user.isActive).length,
            })}
          >
            <div className="settings-team-layout">
              <SurfaceCard title={t("settings.team.usersCardTitle")}>
                <button className={`settings-user-row${selectedUserId === "new" ? " is-selected" : ""}`} onClick={() => setSelectedUserId("new")} type="button">
                  <span className="settings-user-create-mark">+</span>
                  <span className="settings-user-row-copy">
                    <span className="settings-user-row-topline">
                      <strong>{t("settings.team.createUser")}</strong>
                      <span>{t("settings.team.createUserBadge")}</span>
                    </span>
                    <span className="settings-user-row-meta">{t("settings.team.createUserHelp")}</span>
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
                        aria-label={user.isActive ? t("settings.team.activeStatus") : t("settings.team.inactiveStatus")}
                        className={`settings-user-status-dot settings-user-status-dot-${user.isActive ? "active" : "inactive"}`}
                      />
                      <span className="settings-user-row-copy">
                        <span className="settings-user-row-topline">
                          <strong>{user.fullName}</strong>
                          <span>{user.roleName ?? t("settings.team.noRole")}</span>
                        </span>
                        <span className="settings-user-row-meta">
                          {user.isActive ? t("settings.team.activeStatus") : t("settings.team.inactiveStatus")}
                          {user.linkedCrewLabel ? ` · ${user.linkedCrewLabel}` : ""}
                        </span>
                        <UserChannelDots user={user} />
                      </span>
                    </button>
                  ))}
                </div>
              </SurfaceCard>

              <SurfaceCard
                title={selectedUser ? selectedUser.fullName : t("settings.team.createUser")}
                aside={
                  <span className={`run-status-pill run-status-pill-${selectedUser?.isActive ? "configured" : "disabled"}`}>
                    {selectedUser
                      ? selectedUser.isActive
                        ? t("settings.team.activeStatus")
                        : t("settings.team.inactiveStatus")
                      : t("settings.team.newBadge")}
                  </span>
                }
              >
                <div className="agent-form-grid">
                  <label className="field-block">
                    <span className="field-label">{t("settings.team.editor.fullName")}</span>
                    <input
                      className="field-input"
                      onChange={(event) => setUserDraft((current) => ({ ...current, fullName: event.target.value }))}
                      placeholder={t("settings.team.editor.fullNamePlaceholder")}
                      value={userDraft.fullName}
                    />
                  </label>
                  <label className="field-block">
                    <span className="field-label">{t("settings.team.editor.role")}</span>
                    <select
                      className="field-input"
                      onChange={(event) => {
                        const nextRoleId = event.target.value;
                        setUserDraft((current) => ({ ...current, roleId: nextRoleId }));
                        setRoleDirectoryId(nextRoleId);
                      }}
                      value={userDraft.roleId}
                    >
                      <option value="">{t("settings.team.editor.rolePlaceholder")}</option>
                      {usersSnapshot.roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-block">
                    <span className="field-label">{t("settings.team.editor.email")}</span>
                    <input
                      className="field-input"
                      onChange={(event) => setUserDraft((current) => ({ ...current, email: event.target.value }))}
                      placeholder={t("settings.team.editor.emailPlaceholder")}
                      value={userDraft.email}
                    />
                  </label>
                  <label className="field-block">
                    <span className="field-label">{t("settings.team.editor.phone")}</span>
                    <input
                      className="field-input"
                      onChange={(event) => setUserDraft((current) => ({ ...current, phone: event.target.value }))}
                      placeholder={t("settings.team.editor.phonePlaceholder")}
                      value={userDraft.phone}
                    />
                  </label>
                  <label className="field-block field-block-span-2">
                    <span className="field-label">{t("settings.team.editor.crewMember")}</span>
                    <select
                      className="field-input"
                      onChange={(event) => handleCrewMemberChange(event.target.value)}
                      value={userDraft.linkedCrewMemberId}
                    >
                      <option value="">{t("settings.team.editor.noLinkedCrew")}</option>
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
                    <span className="summary-label">{t("settings.team.editor.access")}</span>
                    <span className="summary-value">{selectedRoleCoverage.length ? selectedRoleCoverage.join(", ") : t("settings.team.editor.chooseRole")}</span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">{t("settings.team.editor.telegram")}</span>
                    <span className="summary-value">
                      {selectedUser
                        ? selectedUser.telegramLinkStatus === "linked"
                          ? `${selectedUser.telegramDisplayName ?? selectedUser.fullName}`
                          : selectedUser.telegramLinkStatus === "pending"
                            ? t("settings.team.editor.telegramPending")
                            : selectedUser.telegramLinkStatus === "revoked"
                              ? t("settings.team.editor.telegramRevoked")
                              : t("settings.team.editor.telegramNotLinked")
                        : t("settings.team.editor.telegramCreateFirst")}
                    </span>
                  </div>
                </div>

                {selectedUser?.telegramExternalUserId ? (
                  <div className="models-provider-diagnostic">
                    <span className="agent-detail-kicker">{t("settings.team.editor.telegram")}</span>
                    <p>
                      {selectedUser.telegramUsername ? `@${selectedUser.telegramUsername}` : selectedUser.telegramDisplayName ?? selectedUser.fullName}
                      {selectedUser.telegramLastSeenAt
                        ? t("settings.team.editor.lastSeen", { value: formatDateTime(selectedUser.telegramLastSeenAt) })
                        : ""}
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
                    {isSavingUser
                      ? t("settings.team.editor.saving")
                      : selectedUser
                        ? t("settings.team.editor.saveUser")
                        : t("settings.team.editor.addUser")}
                  </button>
                  {selectedUser ? (
                    <button className="ghost-control" disabled={isTogglingUser} onClick={() => void handleToggleUser()} type="button">
                      {isTogglingUser
                        ? t("settings.team.editor.updating")
                        : selectedUser.isActive
                          ? t("settings.team.editor.deactivate")
                          : t("settings.team.editor.activate")}
                    </button>
                  ) : null}
                  {selectedUser?.telegramLinkStatus === "linked" ? (
                    <button className="ghost-control" disabled={isRevokingTelegram} onClick={() => void handleRevokeTelegram()} type="button">
                      {isRevokingTelegram
                        ? t("settings.team.editor.revoking")
                        : t("settings.team.editor.revokeTelegram")}
                    </button>
                  ) : null}
                  {selectedUser && canRequestUserDelete ? (
                    <button
                      className="ghost-control is-danger"
                      disabled={isDeletingUser}
                      onClick={() => setIsDeleteUserConfirmOpen(true)}
                      type="button"
                    >
                      {t("settings.team.editor.removeUser")}
                    </button>
                  ) : null}
                  <button className="ghost-control" onClick={() => navigate("/agents/connectors")} type="button">
                    {t("settings.team.editor.channels")}
                  </button>
                </div>
              </SurfaceCard>
            </div>
          </SettingsDisclosure>

          <SettingsDisclosure
            title={t("settings.team.rolesDisclosure.title")}
            summary={t("settings.team.rolesDisclosure.summary", { count: usersSnapshot.roles.length })}
          >
            <SurfaceCard title={t("settings.team.rolesCardTitle")}>
              <div className="settings-role-grid">
                {usersSnapshot.roles.map((role) => {
                  const coverageLabels = getRoleCoverageIds(role.permissionKeys).map((id) =>
                    t(`settings.roleCoverage.${id}`),
                  );
                  const useCase = ROLE_USE_CASE_KEYS[role.key] ? t(ROLE_USE_CASE_KEYS[role.key]!) : role.description;

                  return (
                    <button
                      key={role.id}
                      className={`settings-role-card${roleDirectoryId === role.id ? " is-selected" : ""}`}
                      onClick={() => setRoleDirectoryId(role.id)}
                      type="button"
                    >
                      <span className="settings-role-card-head">
                        <strong>{role.name}</strong>
                        <span>{t("settings.team.rolesCardUsers", { count: role.assignedUserCount })}</span>
                      </span>
                      <span className="settings-role-card-copy">{useCase}</span>
                      <span className="settings-role-access">
                        {coverageLabels.length ? coverageLabels.join(" · ") : t("settings.team.rolesCardNoAccess")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </SurfaceCard>
          </SettingsDisclosure>

          <SettingsDisclosure
            title={t("settings.team.permissionMatrixTitle")}
            summary={t("settings.team.permissionMatrixSummary")}
          >
            <SurfaceCard title={t("settings.team.permissionMatrixTitle")}>
              <RolesPermissionMatrix roles={usersSnapshot.roles} />
            </SurfaceCard>
          </SettingsDisclosure>
        </div>
      ) : null}

      {activeSection === "data" ? (
        <div className="settings-data-stack">
          <SurfaceCard title={t("settings.data.healthTitle")}>
            <div className="summary-grid settings-stat-grid">
              {dataHealthRows.map((row) => (
                <SettingsStatRow key={row.label} stat={row} />
              ))}
            </div>

            <div className="action-panel-actions action-panel-actions-start">
              <button
                className="action-primary-button"
                disabled={isCheckingIntegrity}
                onClick={() => void runAction(() => window.bukowskiApp!.runIntegrityCheck(), setIsCheckingIntegrity)}
                type="button"
              >
                {isCheckingIntegrity ? t("settings.data.actions.runningIntegrity") : t("settings.data.actions.runIntegrity")}
              </button>
              <button
                className="ghost-control"
                disabled={isCreatingBackup}
                onClick={() => void runAction(() => window.bukowskiApp!.createBackup(), setIsCreatingBackup)}
                type="button"
              >
                {isCreatingBackup ? t("settings.data.actions.creatingBackup") : t("settings.data.actions.createBackup")}
              </button>
              <button
                className="ghost-control"
                disabled={isRunningLocalSync}
                onClick={() => void runAction(() => window.bukowskiApp!.runLocalSync(), setIsRunningLocalSync)}
                type="button"
              >
                {isRunningLocalSync ? t("settings.data.actions.syncing") : t("settings.data.actions.runSync")}
              </button>
            </div>
          </SurfaceCard>

          <SurfaceCard title={t("settings.data.syncTitle")}>
            <div className="summary-grid settings-stat-grid">
              {syncHealthRows.map((row) => (
                <SettingsStatRow key={row.label} stat={row} />
              ))}
              <SettingsStatRow
                stat={{ label: t("settings.data.rows.visibleQueue"), value: String(syncRows.length) }}
              />
            </div>

            <div className="action-panel-actions action-panel-actions-start">
              <button className="action-primary-button" onClick={() => navigate("/settings/sync")} type="button">
                {t("settings.data.actions.openSync")}
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
                {t("settings.data.actions.retryFailed")}
              </button>
            </div>
          </SurfaceCard>
        </div>
      ) : null}

      {activeSection === "advanced" ? (
        <div className="settings-advanced-layout">
          <SurfaceCard className="settings-advanced-card settings-advanced-card-wide" title={t("settings.advanced.support.cardTitle")}>
            <div className="summary-grid settings-stat-grid">
              <div className="summary-row">
                <span className="summary-label">{t("settings.advanced.support.lastCrash")}</span>
                <span className="summary-value">{formatSupportEvent(supportSnapshot.lastCrash, t("settings.advanced.support.noneCaptured"))}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("settings.advanced.support.lastError")}</span>
                <span className="summary-value">{formatSupportEvent(supportSnapshot.lastError, t("settings.advanced.support.noneCaptured"))}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("settings.advanced.support.lastLoadIssue")}</span>
                <span className="summary-value">
                  {formatSupportEvent(supportSnapshot.lastLoadFailure, t("settings.advanced.support.noLoadIssues"))}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("settings.advanced.support.logLocation")}</span>
                <span className="summary-value">
                  {supportSnapshot.logStorageLabel === emptySupportSnapshot.logStorageLabel
                    ? t("settings.advanced.support.logLocationValue")
                    : supportSnapshot.logStorageLabel}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("settings.advanced.support.recentLogFiles")}</span>
                <span className="summary-value">
                  {supportSnapshot.recentLogFiles.length
                    ? supportSnapshot.recentLogFiles
                        .map((file) => `${file.name} (${formatBytes(file.sizeBytes)})`)
                        .join(", ")
                    : t("settings.advanced.support.noLogFiles")}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("settings.advanced.support.criticalEventsTracked")}</span>
                <span className="summary-value">{supportSnapshot.recentCriticalEvents.length}</span>
              </div>
            </div>

            <div className="action-panel-actions action-panel-actions-start">
              <button
                className="action-primary-button"
                disabled={isExportingSupportBundle}
                onClick={async () => {
                  const confirmed = await confirmSensitiveExport("supportBundle");
                  if (!confirmed) return;
                  await runAction(() => window.bukowskiApp!.exportSupportBundle(), setIsExportingSupportBundle);
                }}
                type="button"
              >
                {isExportingSupportBundle ? t("settings.advanced.support.exporting") : t("settings.advanced.support.exportBundle")}
              </button>
              <button
                className="ghost-control"
                disabled={isExportingLogs}
                onClick={async () => {
                  const confirmed = await confirmSensitiveExport("logs");
                  if (!confirmed) return;
                  await runAction(() => window.bukowskiApp!.exportRecentLogs(), setIsExportingLogs);
                }}
                type="button"
              >
                {isExportingLogs ? t("settings.advanced.support.exportingLogs") : t("settings.advanced.support.exportLogs")}
              </button>
              <button
                className="ghost-control"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(supportSummaryText);
                    toast.success(t("settings.actions.copiedTitle"), t("settings.actions.diagnosticsCopiedBody"));
                    setError(null);
                  } catch (copyError) {
                    setError(getUserFacingErrorMessage(copyError, t("settings.actions.couldNotCopyDiagnostics")));
                  }
                }}
                type="button"
              >
                {t("settings.advanced.support.copyDiagnostics")}
              </button>
            </div>
          </SurfaceCard>

          <SurfaceCard className="settings-advanced-card" title={t("settings.advanced.dataExport.cardTitle")}>
            <div className="summary-grid settings-stat-grid">
              <div className="summary-row">
                <span className="summary-label">{t("settings.advanced.dataExport.format")}</span>
                <span className="summary-value">JSON</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("settings.advanced.dataExport.scope")}</span>
                <span className="summary-value">{activeWorkspaceName}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("settings.advanced.dataExport.buildFiles")}</span>
                <span className="summary-value">
                  {diagnostics.internalBuildArtifacts.length ? diagnostics.internalBuildArtifacts.join(", ") : t("settings.advanced.dataExport.notPackaged")}
                </span>
              </div>
            </div>

            <div className="action-panel-actions action-panel-actions-start">
              <button
                className="action-primary-button"
                disabled={isExporting}
                onClick={async () => {
                  const confirmed = await confirmSensitiveExport("workspaceData");
                  if (!confirmed) return;
                  await runAction(() => window.bukowskiApp!.exportWorkspaceData(), setIsExporting);
                }}
                type="button"
              >
                {isExporting ? t("settings.advanced.dataExport.exporting") : t("settings.advanced.dataExport.exportJson")}
              </button>
            </div>
          </SurfaceCard>

          <SurfaceCard className="settings-advanced-card" title={t("settings.advanced.appInfo.cardTitle")}>
            <div className="summary-grid settings-stat-grid">
              <div className="summary-row">
                <span className="summary-label">{t("settings.advanced.appInfo.app")}</span>
                <span className="summary-value">{appInfo?.appName ?? "bukowskiOS"}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("settings.advanced.appInfo.version")}</span>
                <span className="summary-value">{appInfo?.version ?? t("settings.advanced.appInfo.unknown")}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("settings.advanced.appInfo.build")}</span>
                <span className="summary-value">{appInfo?.shellVersion ?? t("settings.advanced.appInfo.unknown")}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("settings.advanced.appInfo.platform")}</span>
                <span className="summary-value">{appInfo?.platform ?? t("settings.advanced.appInfo.unknown")}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{t("settings.advanced.appInfo.mode")}</span>
                <span className="summary-value">{appInfo?.isPackaged ? t("settings.advanced.appInfo.packaged") : t("settings.advanced.appInfo.development")}</span>
              </div>
            </div>
          </SurfaceCard>

        </div>
      ) : null}
      </SettingsLayout>
      <ConfirmDialog
        body={
          selectedUser
            ? t("settings.team.deleteDialog.bodyWithName", { name: selectedUser.fullName })
            : t("settings.team.deleteDialog.bodyFallback")
        }
        confirmLabel={t("settings.team.deleteDialog.confirm")}
        isOpen={isDeleteUserConfirmOpen}
        isSubmitting={isDeletingUser}
        onCancel={() => setIsDeleteUserConfirmOpen(false)}
        onConfirm={handleDeleteUser}
        title={t("settings.team.deleteDialog.title")}
        tone="danger"
      />
      {confirmDialog}
    </div>
  );
};
