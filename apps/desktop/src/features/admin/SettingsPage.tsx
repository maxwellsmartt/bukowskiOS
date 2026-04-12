import type {
  AppActionResult,
  AppDiagnosticsSnapshot,
  AppExportResult,
  AppSupportEventSummary,
  AppSupportSnapshot,
  AppSyncOutboxRow,
} from "@contracts";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useShellContext } from "@shared/hooks/useShellContext";

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

export const SettingsPage = () => {
  const { appInfo } = useShellContext();
  const navigate = useNavigate();
  const [diagnostics, setDiagnostics] = useState<AppDiagnosticsSnapshot>(emptyDiagnostics);
  const [supportSnapshot, setSupportSnapshot] = useState<AppSupportSnapshot>(emptySupportSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isRunningLocalSync, setIsRunningLocalSync] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingSupportBundle, setIsExportingSupportBundle] = useState(false);
  const [isExportingLogs, setIsExportingLogs] = useState(false);
  const [syncRows, setSyncRows] = useState<AppSyncOutboxRow[]>([]);

  const loadDiagnostics = async () => {
    if (!window.bukowskiApp) {
      return;
    }

    try {
      const [nextDiagnostics, nextSupportSnapshot, nextSyncRows] = await Promise.all([
        window.bukowskiApp.getDiagnostics(),
        window.bukowskiApp.getSupportSnapshot(),
        window.bukowskiApp.getSyncOutboxRows(),
      ]);
      setDiagnostics(nextDiagnostics);
      setSupportSnapshot(nextSupportSnapshot);
      setSyncRows(nextSyncRows);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Settings are unavailable right now.");
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
          const [nextSyncRows, nextSupportSnapshot] = await Promise.all([
            window.bukowskiApp.getSyncOutboxRows(),
            window.bukowskiApp.getSupportSnapshot(),
          ]);
          setSyncRows(nextSyncRows);
          setSupportSnapshot(nextSupportSnapshot);
        }
      } else {
        await loadDiagnostics();
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The app could not complete that settings action.");
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

  return (
    <div className="page-stack">
      <SectionHeader
        title="Settings"
        body="Check the desktop build, database health, backups, and export tools from one place."
      />

      {error ? <div className="form-inline-error">{error}</div> : null}
      {feedback ? <div className="action-feedback action-feedback-success">{feedback}</div> : null}

      <SurfaceCard title="About" subtitle="Build identity for this local BukowskiOS installation.">
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
            <span className="summary-label">Shell version</span>
            <span className="summary-value">{appInfo?.shellVersion ?? "Unknown"}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Platform</span>
            <span className="summary-value">{appInfo?.platform ?? "Unknown"}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Build type</span>
            <span className="summary-value">{appInfo?.isPackaged ? "Packaged build" : "Development build"}</span>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Database" subtitle="Health checks and backups for the local-first workspace.">
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
            {isRunningLocalSync ? "Running local sync..." : "Run local sync now"}
          </button>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Data export" subtitle="Export the full local workspace as a JSON snapshot.">
        <div className="summary-grid">
          <div className="summary-row">
            <span className="summary-label">Internal alpha package</span>
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

      <SurfaceCard title="Support" subtitle="Export diagnostics and recent logs when an internal alpha build needs debugging.">
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
                setFeedback("Copied the diagnostics summary to your clipboard.");
                setError(null);
              } catch (copyError) {
                setError(copyError instanceof Error ? copyError.message : "The app could not copy the diagnostics summary.");
              }
            }}
            type="button"
          >
            Copy diagnostics summary
          </button>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Local sync queue" subtitle="Open the dedicated outbox view to inspect failures, retry rows and drill into related entities.">
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
            Open local sync queue
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
  );
};
