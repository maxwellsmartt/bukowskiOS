import type { AppActionResult, AppDiagnosticsSnapshot, AppExportResult } from "@contracts";
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
  const [diagnostics, setDiagnostics] = useState<AppDiagnosticsSnapshot>(emptyDiagnostics);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const loadDiagnostics = async () => {
    if (!window.bukowskiApp) {
      return;
    }

    try {
      const nextDiagnostics = await window.bukowskiApp.getDiagnostics();
      setDiagnostics(nextDiagnostics);
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
    </div>
  );
};
