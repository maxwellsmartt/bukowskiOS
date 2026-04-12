import type { AppActionResult, AppDiagnosticsSnapshot, AppExportResult, AppSyncOutboxRow } from "@contracts";
import { useEffect, useMemo, useState } from "react";

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

const formatSyncRowStatus = (status: AppSyncOutboxRow["status"]) => {
  if (status === "sent") {
    return "Sent";
  }

  if (status === "failed") {
    return "Failed";
  }

  if (status === "processing") {
    return "Processing";
  }

  return "Pending";
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
  const [diagnostics, setDiagnostics] = useState<AppDiagnosticsSnapshot>(emptyDiagnostics);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isRunningLocalSync, setIsRunningLocalSync] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [syncRows, setSyncRows] = useState<AppSyncOutboxRow[]>([]);
  const [retryingRowId, setRetryingRowId] = useState<string | null>(null);

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

  const retrySyncRow = async (id: string) => {
    if (!window.bukowskiApp) {
      return;
    }

    try {
      setRetryingRowId(id);
      const result = await window.bukowskiApp.retrySyncOutboxRow(id);
      setFeedback(result.summary);
      setDiagnostics(result.diagnostics);
      setError(null);
      const nextRows = await window.bukowskiApp.getSyncOutboxRows();
      setSyncRows(nextRows);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The app could not retry that local sync row.");
    } finally {
      setRetryingRowId(null);
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

      <SurfaceCard
        title="Local sync queue"
        subtitle="Review pending or failed outbox rows before the future remote transport layer is introduced."
      >
        {!syncRows.length ? (
          <div className="empty-state">The local sync queue is empty right now.</div>
        ) : (
          <div className="sync-outbox-list">
            {syncRows.map((row) => (
              <div key={row.id} className="sync-outbox-row">
                <div className="sync-outbox-row-main">
                  <div className="sync-outbox-row-head">
                    <span className={`sync-outbox-status sync-outbox-status-${row.status}`}>
                      {formatSyncRowStatus(row.status)}
                    </span>
                    <span className="sync-outbox-entity">
                      {row.entityType} · {row.entityId}
                    </span>
                  </div>
                  <div className="sync-outbox-row-meta">
                    <span>Operation: {row.operationType}</span>
                    <span>Attempts: {row.attemptCount}</span>
                    <span>Updated: {formatDateLabel(row.updatedAt)}</span>
                    <span>Next retry: {formatDateLabel(row.nextRetryAt)}</span>
                  </div>
                  {row.lastError ? <div className="sync-outbox-error">{row.lastError}</div> : null}
                </div>
                <div className="sync-outbox-row-actions">
                  <button
                    className="ghost-control"
                    disabled={retryingRowId === row.id || (row.status !== "failed" && row.status !== "processing")}
                    onClick={() => void retrySyncRow(row.id)}
                    type="button"
                  >
                    {retryingRowId === row.id ? "Retrying..." : "Retry row"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};
