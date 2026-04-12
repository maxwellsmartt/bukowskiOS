import type { AppActionResult, AppDiagnosticsSnapshot, AppExportResult, AppSyncOutboxRow } from "@contracts";
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
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isRunningLocalSync, setIsRunningLocalSync] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [syncRows, setSyncRows] = useState<AppSyncOutboxRow[]>([]);

  const loadDiagnostics = async () => {
    if (!window.bukowskiApp) {
      return;
    }

    try {
      const [nextDiagnostics, nextSyncRows] = await Promise.all([
        window.bukowskiApp.getDiagnostics(),
        window.bukowskiApp.getSyncOutboxRows(),
      ]);
      setDiagnostics(nextDiagnostics);
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
          const nextSyncRows = await window.bukowskiApp.getSyncOutboxRows();
          setSyncRows(nextSyncRows);
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
