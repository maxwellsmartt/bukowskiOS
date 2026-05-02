import type { AppActionResult, AppDiagnosticsSnapshot, AppSyncOutboxRow } from "@contracts";
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

const formatDateLabel = (value: string | null) => {
  if (!value) {
    return "Never";
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? value : parsedDate.toLocaleString();
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
      setDiagnostics(nextDiagnostics);
      setRows(nextRows);
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
        body="Track local changes still on their way to the cloud, retry failed rows and inspect outbox state."
        titleTone="accent"
      />

      {error ? <div className="form-inline-error">{error}</div> : null}
      {feedback ? <div className="action-feedback action-feedback-success">{feedback}</div> : null}

      <SettingsLayout>
      <div className="chip-row">
        <StatusBadge tone={diagnostics.syncOutboxFailedCount ? "critical" : "success"}>
          {diagnostics.syncOutboxFailedCount ? `${diagnostics.syncOutboxFailedCount} failed` : "Up to date"}
        </StatusBadge>
        <StatusBadge tone="warning">{`${diagnostics.syncOutboxPendingCount} pending`}</StatusBadge>
        <StatusBadge tone="info">{`${diagnostics.syncOutboxProcessingCount} processing`}</StatusBadge>
        <StatusBadge>{`${visibleRows.length} visible`}</StatusBadge>
        <StatusBadge>{formatDateLabel(diagnostics.lastSyncRunAt)}</StatusBadge>
      </div>

      <div className="action-panel-actions action-panel-actions-start">
        <button
          className="action-primary-button"
          disabled={isRunningLocalSync}
          onClick={() => void runAction(() => window.bukowskiApp!.runLocalSync(), setIsRunningLocalSync)}
          type="button"
        >
          {isRunningLocalSync ? "Syncing..." : "Run sync now"}
        </button>
        <button
          className="ghost-control"
          disabled={!diagnostics.syncOutboxFailedCount || isRetryingAllFailed}
          onClick={() => void runAction(() => window.bukowskiApp!.retryAllFailedSyncOutboxRows(), setIsRetryingAllFailed)}
          type="button"
        >
          {isRetryingAllFailed ? "Retrying failed rows..." : "Retry all failed"}
        </button>
        <button
          className="ghost-control"
          disabled={!visibleRetryableRows.length || isRetryingVisible}
          onClick={() => void retryVisibleRows()}
          type="button"
        >
          {isRetryingVisible ? "Retrying visible rows..." : `Retry visible (${visibleRetryableRows.length})`}
        </button>
      </div>

      <ResizableSideRailLayout className="split-layout" defaultWidth={420} maxWidth={680} minWidth={320} storageKey="sync-outbox-side-rail-width">
        <SurfaceCard title="Rows">
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
                  {item === "all" ? "All entities" : item}
                </button>
              ))}
            </div>
            <input
              className="text-input sync-outbox-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search entity, operation, payload or error"
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
            emptyMessage="No outbox rows match the current filter."
            rows={visibleRows}
          />
        </SurfaceCard>

        <SurfaceCard title="Row Detail" subtitle={summarizeSelection(activeRow)}>
          {!activeRow ? (
            <div className="empty-state">Select any outbox row to inspect it.</div>
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
