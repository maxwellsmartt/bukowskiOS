import { AlertTriangle, CheckCircle2, CloudDownload, CloudUpload, RefreshCw } from "lucide-react";
import type { AppActionResult, AppDiagnosticsSnapshot, AppSyncOutboxRow, AppSyncPullCursorRow } from "@contracts";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DataTable } from "@shared/components/DataTable";
import { ResizableSideRailLayout } from "@shared/components/ResizableSideRailLayout";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useVisiblePolling } from "@shared/hooks/useVisiblePolling";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { getSyncOutboxStatusLabel } from "@shared/labels/statusLabels";

import { SettingsLayout } from "./SettingsLayout";

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

type SyncFilter = "all" | "pending" | "processing" | "failed" | "sent";
type SyncEntityFilter = "all" | string;

const syncFilters: Array<{ value: SyncFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
  { value: "sent", label: "Sent" },
];

const inboundCoverage = [
  { entityType: "asset_snapshots", label: "Assets", detail: "Inventory and current stock state", status: "active" },
  { entityType: "asset_categories", label: "Categories", detail: "Asset categories", status: "active" },
  { entityType: "locations", label: "Locations", detail: "Warehouses and operational locations", status: "active" },
  { entityType: "clients", label: "Clients", detail: "Client catalog", status: "active" },
  { entityType: "manufacturers", label: "Manufacturers", detail: "Manufacturer catalog", status: "active" },
  { entityType: "production_companies", label: "Production companies", detail: "Production company catalog", status: "active" },
  { entityType: "projects", label: "Projects", detail: "Needs remote snapshot tables", status: "planned" },
  { entityType: "packing_slips", label: "Packing slips", detail: "Needs remote snapshot tables", status: "planned" },
  { entityType: "incidents", label: "Incidents", detail: "Needs remote snapshot tables", status: "planned" },
  { entityType: "rma_cases", label: "RMAs", detail: "Needs remote snapshot tables", status: "planned" },
] as const;

const formatDateLabel = (value: string | null) => {
  if (!value) {
    return "Never";
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? value : parsedDate.toLocaleString();
};

const formatEntityLabel = (value: string) =>
  value
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");

const resolveOutboundStatus = (diagnostics: AppDiagnosticsSnapshot) => {
  if (diagnostics.syncOutboxFailedCount > 0) {
    return {
      tone: "critical" as const,
      label: "Needs attention",
      detail: `${diagnostics.syncOutboxFailedCount} upload${diagnostics.syncOutboxFailedCount === 1 ? "" : "s"} failed.`,
    };
  }

  if (diagnostics.syncOutboxProcessingCount > 0) {
    return {
      tone: "info" as const,
      label: "Uploading",
      detail: `${diagnostics.syncOutboxProcessingCount} change${diagnostics.syncOutboxProcessingCount === 1 ? "" : "s"} in progress.`,
    };
  }

  if (diagnostics.syncOutboxPendingCount > 0) {
    return {
      tone: "warning" as const,
      label: "Waiting to upload",
      detail: `${diagnostics.syncOutboxPendingCount} change${diagnostics.syncOutboxPendingCount === 1 ? "" : "s"} queued.`,
    };
  }

  return {
    tone: "success" as const,
    label: "Up to date",
    detail: "No local changes waiting for cloud upload.",
  };
};

const resolveInboundStatus = (pullCursors: AppSyncPullCursorRow[]) => {
  const failed = pullCursors.filter((row) => row.lastError);
  const activeCursors = pullCursors.filter((row) => !row.lastError);
  const latest = activeCursors[0]?.updatedAt ?? pullCursors[0]?.updatedAt ?? null;

  if (failed.length > 0) {
    return {
      tone: "critical" as const,
      label: "Download needs attention",
      detail: `${failed.length} inbound source${failed.length === 1 ? "" : "s"} reported an error.`,
      latest,
    };
  }

  if (pullCursors.length > 0) {
    return {
      tone: "success" as const,
      label: "Downloads active",
      detail: `${pullCursors.length} inbound source${pullCursors.length === 1 ? "" : "s"} checked.`,
      latest,
    };
  }

  return {
    tone: "warning" as const,
    label: "Waiting for first download",
    detail: "Open a remote workspace and the app will start pulling supported data.",
    latest: null,
  };
};

const formatSyncStatusTone = (status: AppSyncOutboxRow["status"]) => {
  if (status === "sent") {
    return "success" as const;
  }

  if (status === "failed") {
    return "critical" as const;
  }

  if (status === "processing") {
    return "info" as const;
  }

  return "warning" as const;
};

const normalizeText = (value: string) => value.trim().toLowerCase();

const resolveEntityNavigationPath = (row: AppSyncOutboxRow) => {
  if (row.entityType === "asset_event") {
    return `/assets/${row.entityId}`;
  }

  if (row.entityType === "packing_slip") {
    return `/packing-slips?focus=${row.entityId}`;
  }

  if (row.entityType === "incident") {
    return `/incidents?focus=${row.entityId}`;
  }

  if (row.entityType === "financial_entry") {
    return `/finance/entries?focus=${row.entityId}`;
  }

  return null;
};

const summarizeSelection = (row: AppSyncOutboxRow | null) => {
  if (!row) {
    return "Select a row to inspect it.";
  }

  return `${row.entityType} · ${row.operationType}`;
};

export const SyncOutboxPage = () => {
  const navigate = useNavigate();
  const [diagnostics, setDiagnostics] = useState<AppDiagnosticsSnapshot>(emptyDiagnostics);
  const [rows, setRows] = useState<AppSyncOutboxRow[]>([]);
  const [pullCursors, setPullCursors] = useState<AppSyncPullCursorRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [filter, setFilter] = useState<SyncFilter>("all");
  const [entityFilter, setEntityFilter] = useState<SyncEntityFilter>("all");
  const [search, setSearch] = useState("");
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [retryingRowId, setRetryingRowId] = useState<string | null>(null);
  const [isRetryingAllFailed, setIsRetryingAllFailed] = useState(false);
  const [isRetryingVisible, setIsRetryingVisible] = useState(false);
  const [isRunningLocalSync, setIsRunningLocalSync] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const load = async () => {
    if (!window.bukowskiApp) {
      return;
    }

    try {
      const [nextDiagnostics, nextRows] = await Promise.all([
        window.bukowskiApp.getDiagnostics(),
        window.bukowskiApp.getSyncOutboxRows(),
      ]);
      const nextPullCursors = await window.bukowskiApp.getSyncPullCursors().catch(() => []);
      setDiagnostics(nextDiagnostics);
      setRows(nextRows);
      setPullCursors(nextPullCursors);
      setError(null);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "The app could not load sync activity."));
    }
  };

  useVisiblePolling(
    () => {
      void load();
    },
    { intervalMs: 10_000 },
  );

  useEffect(() => {
    if (!rows.length) {
      setActiveRowId(null);
      return;
    }

    if (activeRowId && rows.some((row) => row.id === activeRowId)) {
      return;
    }

    setActiveRowId(rows[0]?.id ?? null);
  }, [activeRowId, rows]);

  const entityFilters = useMemo(
    () => ["all", ...Array.from(new Set(rows.map((row) => row.entityType))).sort()],
    [rows],
  );

  const visibleRows = useMemo(() => {
    const query = normalizeText(deferredSearch);

    return rows.filter((row) => {
      if (filter !== "all" && row.status !== filter) {
        return false;
      }

      if (entityFilter !== "all" && row.entityType !== entityFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [row.entityType, row.entityId, row.operationType, row.lastError ?? "", row.payloadJson]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [deferredSearch, entityFilter, filter, rows]);

  const activeRow = useMemo(() => visibleRows.find((row) => row.id === activeRowId) ?? null, [activeRowId, visibleRows]);
  const outboundStatus = useMemo(() => resolveOutboundStatus(diagnostics), [diagnostics]);
  const inboundStatus = useMemo(() => resolveInboundStatus(pullCursors), [pullCursors]);
  const pullCursorByEntity = useMemo(
    () => new Map(pullCursors.map((cursor) => [cursor.entityType, cursor])),
    [pullCursors],
  );
  const visibleRetryableRows = useMemo(
    () => visibleRows.filter((row) => row.status === "failed" || row.status === "processing"),
    [visibleRows],
  );

  const runAction = async (action: () => Promise<AppActionResult>, setPending: (value: boolean) => void) => {
    try {
      setPending(true);
      const result = await action();
      setFeedback(result.summary);
      setDiagnostics(result.diagnostics);
      setError(null);
      const nextRows = await window.bukowskiApp!.getSyncOutboxRows();
      setRows(nextRows);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "The app could not complete that local sync action."));
    } finally {
      setPending(false);
    }
  };

  const retrySingleRow = async (rowId: string) => {
    if (!window.bukowskiApp) {
      return;
    }

    try {
      setRetryingRowId(rowId);
      const result = await window.bukowskiApp.retrySyncOutboxRow(rowId);
      setFeedback(result.summary);
      setDiagnostics(result.diagnostics);
      setError(null);
      const nextRows = await window.bukowskiApp.getSyncOutboxRows();
      setRows(nextRows);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "The app could not retry that local sync row."));
    } finally {
      setRetryingRowId(null);
    }
  };

  const retryVisibleRows = async () => {
    if (!window.bukowskiApp || !visibleRetryableRows.length) {
      return;
    }

    try {
      setIsRetryingVisible(true);
      let lastResult: AppActionResult | null = null;

      for (const row of visibleRetryableRows) {
        lastResult = await window.bukowskiApp.retrySyncOutboxRow(row.id);
      }

      if (lastResult) {
        setFeedback(`${visibleRetryableRows.length} visible rows queued again.`);
        setDiagnostics(lastResult.diagnostics);
      }
      setError(null);
      const nextRows = await window.bukowskiApp.getSyncOutboxRows();
      setRows(nextRows);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, "The app could not retry the visible local sync rows."));
    } finally {
      setIsRetryingVisible(false);
    }
  };

  return (
    <div className="page-stack settings-page">
      <SectionHeader
        eyebrow="Settings"
        title="Sync activity"
      />

      {error ? <div className="form-inline-error">{error}</div> : null}
      {feedback ? <div className="action-feedback action-feedback-success">{feedback}</div> : null}

      <SettingsLayout>
      <div className="sync-overview-grid">
        <SurfaceCard className="sync-direction-card" title="Upload to cloud">
          <div className="sync-direction-head">
            <span className={`sync-direction-icon sync-direction-icon-${outboundStatus.tone}`}>
              <CloudUpload size={18} />
            </span>
            <div>
              <StatusBadge tone={outboundStatus.tone}>{outboundStatus.label}</StatusBadge>
              <p>{outboundStatus.detail}</p>
            </div>
          </div>
          <div className="sync-metric-row">
            <span><strong>{diagnostics.syncOutboxPendingCount}</strong> pending</span>
            <span><strong>{diagnostics.syncOutboxProcessingCount}</strong> uploading</span>
            <span><strong>{diagnostics.syncOutboxFailedCount}</strong> failed</span>
          </div>
          <small>Last upload pass: {formatDateLabel(diagnostics.lastSyncRunAt)}</small>
        </SurfaceCard>

        <SurfaceCard className="sync-direction-card" title="Download from cloud">
          <div className="sync-direction-head">
            <span className={`sync-direction-icon sync-direction-icon-${inboundStatus.tone}`}>
              <CloudDownload size={18} />
            </span>
            <div>
              <StatusBadge tone={inboundStatus.tone}>{inboundStatus.label}</StatusBadge>
              <p>{inboundStatus.detail}</p>
            </div>
          </div>
          <div className="sync-metric-row">
            <span><strong>{pullCursors.length}</strong> sources</span>
            <span><strong>{pullCursors.reduce((sum, row) => sum + row.lastPulledCount, 0)}</strong> latest rows</span>
            <span><strong>{pullCursors.filter((row) => row.lastError).length}</strong> errors</span>
          </div>
          <small>Last download check: {formatDateLabel(inboundStatus.latest)}</small>
        </SurfaceCard>
      </div>

      <div className="sync-action-row">
        <button
          className="action-primary-button"
          disabled={isRunningLocalSync}
          onClick={() => void runAction(() => window.bukowskiApp!.runLocalSync(), setIsRunningLocalSync)}
          type="button"
        >
          <RefreshCw size={14} />
          <span>{isRunningLocalSync ? "Syncing..." : "Run upload sync"}</span>
        </button>
        <button
          className="ghost-control"
          disabled={!diagnostics.syncOutboxFailedCount || isRetryingAllFailed}
          onClick={() => void runAction(() => window.bukowskiApp!.retryAllFailedSyncOutboxRows(), setIsRetryingAllFailed)}
          type="button"
        >
          {isRetryingAllFailed ? "Retrying failed..." : "Retry failed uploads"}
        </button>
        <button
          className="ghost-control"
          disabled={!visibleRetryableRows.length || isRetryingVisible}
          onClick={() => void retryVisibleRows()}
          type="button"
        >
          {isRetryingVisible ? "Retrying visible..." : `Retry visible (${visibleRetryableRows.length})`}
        </button>
      </div>

      <SurfaceCard title="Download coverage">
        <div className="sync-coverage-grid">
          {inboundCoverage.map((item) => {
            const cursor = pullCursorByEntity.get(item.entityType);
            const isActive = item.status === "active";
            const hasError = Boolean(cursor?.lastError);
            return (
              <div className={`sync-coverage-item${isActive ? "" : " is-planned"}`} key={item.entityType}>
                <span className={`sync-coverage-icon${hasError ? " is-error" : isActive ? " is-active" : ""}`}>
                  {hasError ? <AlertTriangle size={14} /> : isActive ? <CheckCircle2 size={14} /> : <CloudDownload size={14} />}
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <small>{hasError ? cursor?.lastError : cursor ? `${cursor.lastPulledCount} rows in latest pull` : item.detail}</small>
                </div>
                <StatusBadge tone={hasError ? "critical" : isActive ? "success" : "neutral"}>
                  {hasError ? "Error" : isActive ? "Active" : "Planned"}
                </StatusBadge>
              </div>
            );
          })}
        </div>
      </SurfaceCard>

      <ResizableSideRailLayout className="split-layout" defaultWidth={420} maxWidth={680} minWidth={320} storageKey="sync-outbox-side-rail-width">
        <SurfaceCard title="Upload queue">
          <div className="sync-outbox-toolbar">
            <div className="sync-outbox-filter-row">
              {syncFilters.map((item) => (
                <button
                  key={item.value}
                  className={`filter-chip${filter === item.value ? " active" : ""}`}
                  onClick={() => setFilter(item.value)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="sync-outbox-filter-row">
              {entityFilters.map((item) => (
                <button
                  key={item}
                  className={`filter-chip${entityFilter === item ? " active" : ""}`}
                  onClick={() => setEntityFilter(item)}
                  type="button"
                >
                  {item === "all" ? "All entities" : formatEntityLabel(item)}
                </button>
              ))}
            </div>
            <input
              className="text-input sync-outbox-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search upload, operation, payload or error"
              type="search"
              value={search}
            />
          </div>

          <DataTable
            activeRowId={activeRowId}
            getRowId={(row) => row.id}
            maxHeight="min(60vh, 680px)"
            onRowClick={(row) => setActiveRowId(row.id)}
            persistKey="sync-outbox"
            columns={[
              {
                key: "status",
                label: "Status",
                render: (row) => <StatusBadge tone={formatSyncStatusTone(row.status)}>{getSyncOutboxStatusLabel(row.status)}</StatusBadge>,
              },
              { key: "entityType", label: "Entity", render: (row) => row.entityType },
              { key: "entityId", label: "Entity ID", render: (row) => row.entityId },
              { key: "operationType", label: "Operation", render: (row) => row.operationType },
              { key: "attemptCount", label: "Attempts", align: "right", render: (row) => row.attemptCount },
              { key: "updatedAt", label: "Updated", render: (row) => formatDateLabel(row.updatedAt) },
            ]}
            emptyMessage="No upload rows match the current filter."
            rows={visibleRows}
          />
        </SurfaceCard>

        <SurfaceCard title="Upload detail" subtitle={summarizeSelection(activeRow)}>
          {!activeRow ? (
            <div className="empty-state">Select an upload row to inspect it.</div>
          ) : (
            <div className="sync-outbox-detail-stack">
              <div className="summary-grid">
                <div className="summary-row">
                  <span className="summary-label">Status</span>
                  <span className="summary-value">{getSyncOutboxStatusLabel(activeRow.status)}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Entity</span>
                  <span className="summary-value">{activeRow.entityType}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Entity ID</span>
                  <span className="summary-value">{activeRow.entityId}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Operation</span>
                  <span className="summary-value">{activeRow.operationType}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Attempts</span>
                  <span className="summary-value">{activeRow.attemptCount}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Next retry</span>
                  <span className="summary-value">{formatDateLabel(activeRow.nextRetryAt)}</span>
                </div>
              </div>

              {activeRow.lastError ? (
                <div className="form-inline-error">Last error: {activeRow.lastError}</div>
              ) : null}

              <div className="action-panel-actions action-panel-actions-start">
                <button
                  className="ghost-control"
                  disabled={retryingRowId === activeRow.id || (activeRow.status !== "failed" && activeRow.status !== "processing")}
                  onClick={() => void retrySingleRow(activeRow.id)}
                  type="button"
                >
                  {retryingRowId === activeRow.id ? "Retrying row..." : "Retry row"}
                </button>
                {resolveEntityNavigationPath(activeRow) ? (
                  <button
                    className="ghost-control"
                    onClick={() => navigate(resolveEntityNavigationPath(activeRow)!)}
                    type="button"
                  >
                    Open entity
                  </button>
                ) : null}
              </div>

              <div className="sync-outbox-payload-block">
                <span className="summary-label">Payload</span>
                <pre className="sync-outbox-payload">{activeRow.payloadJson}</pre>
              </div>
            </div>
          )}
        </SurfaceCard>
      </ResizableSideRailLayout>
      </SettingsLayout>
    </div>
  );
};
