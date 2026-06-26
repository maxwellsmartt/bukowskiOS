import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Cloud,
  CloudDownload,
  CloudOff,
  CloudUpload,
  FileText,
  GitMerge,
  Package,
  Receipt,
  RefreshCw,
  Search,
  Wifi,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type {
  AppActionResult,
  AppDiagnosticsSnapshot,
  AppSyncConflictResolution,
  AppSyncConflictRow,
  AppSyncOutboxRow,
  AppSyncPullCursorRow,
} from "@contracts";
import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useLocale } from "@shared/hooks/useLocale";
import { useVisiblePolling } from "@shared/hooks/useVisiblePolling";
import { useSyncConnectionState } from "@shared/hooks/useSyncConnectionState";
import { requestImmediatePull } from "@shared/hooks/useWorkspaceDataRefresh";
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
  databaseEncrypted: false,
  encryptionAvailable: false,
  internalBuildArtifacts: [],
};

type SyncFilter = "all" | "pending" | "processing" | "failed" | "sent";

const SYNC_FILTER_VALUES: SyncFilter[] = ["all", "pending", "processing", "failed", "sent"];

const INBOUND_COVERAGE = [
  "asset_snapshots",
  "asset_categories",
  "locations",
  "clients",
  "manufacturers",
  "production_companies",
  "crew_members",
  "departments",
  "projects",
  "packing_slips",
  "incidents",
  "rma_cases",
  "bank_accounts",
  "bank_transactions",
  "transaction_annotations",
  "invoices",
  "quotes",
  "collaborator_fees",
  "financial_entries",
  "currency_settings",
  "workspace_files",
  "sync_tombstones",
] as const;

// The operational-snapshot pull keys its cursor by the singular entity_type
// ("project", "packing_slip", "incident", "rma_case"), while the coverage tiles
// and their i18n labels use the plural family name. Without bridging the two,
// an inbound error on those entities (e.g. a project snapshot foreign-key
// failure) is silently invisible in this page even though it shows in the
// header sync popover.
const COVERAGE_KEY_BY_CURSOR_ENTITY: Record<string, string> = {
  project: "projects",
  packing_slip: "packing_slips",
  incident: "incidents",
  rma_case: "rma_cases",
};

const coverageKeyForCursor = (entityType: string) => COVERAGE_KEY_BY_CURSOR_ENTITY[entityType] ?? entityType;

/** Friendly icon per outbox entity family. Falls back to the upload glyph. */
const entityIcon = (entityType: string): LucideIcon => {
  if (entityType.startsWith("asset")) return Boxes;
  if (entityType.startsWith("packing")) return Package;
  if (entityType === "incident") return AlertTriangle;
  if (entityType.startsWith("rma")) return Wrench;
  if (entityType.startsWith("workspace_file")) return FileText;
  if (
    entityType.startsWith("invoice") ||
    entityType.startsWith("quote") ||
    entityType.startsWith("financial") ||
    entityType.startsWith("bank") ||
    entityType.startsWith("transaction") ||
    entityType.startsWith("collaborator") ||
    entityType.startsWith("currency")
  ) {
    return Receipt;
  }
  return CloudUpload;
};

const formatEntityLabel = (value: string) =>
  value
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");

const resolveEntityNavigationPath = (row: AppSyncOutboxRow) => {
  if (row.entityType === "asset_event") return `/assets/${row.entityId}`;
  if (row.entityType === "packing_slip") return `/packing-slips?focus=${row.entityId}`;
  if (row.entityType === "incident") return `/incidents?focus=${row.entityId}`;
  if (row.entityType === "financial_entry") return `/finance/entries?focus=${row.entityId}`;
  return null;
};

const formatSyncStatusTone = (status: AppSyncOutboxRow["status"]) => {
  if (status === "sent") return "success" as const;
  if (status === "failed") return "critical" as const;
  if (status === "processing") return "info" as const;
  return "warning" as const;
};

const normalizeText = (value: string) => value.trim().toLowerCase();

const prettyJson = (value: string | null) => {
  if (!value) return "";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
};

const formatBytes = (bytes: number) => {
  if (!bytes || bytes < 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

/** Determinate fill (%) for a per-file transfer bar, by outbox status. */
const transferFillPercent = (status: AppSyncOutboxRow["status"]) => {
  if (status === "sent") return 100;
  if (status === "failed") return 100;
  if (status === "processing") return 65;
  return 8;
};

export const SyncOutboxPage = () => {
  const navigate = useNavigate();
  const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
  const { status: sessionStatus, isLocalFallback } = useSession();
  const toast = useToast();
  const { t } = useTranslation();
  const { formatDateTime } = useLocale();
  const connection = useSyncConnectionState();
  // Inbound pulls only run when the session can actually reach the cloud. When it
  // can't (offline / local-only / signed out), "stale" cursors are expected, not
  // errors — so we never raise them as problems.
  const canCloudSync = connection.isOnline && sessionStatus === "authenticated" && !isLocalFallback;

  const formatDateLabel = (value: string | null) => {
    if (!value) return t("common.never");
    return formatDateTime(value) || value;
  };

  const [diagnostics, setDiagnostics] = useState<AppDiagnosticsSnapshot>(emptyDiagnostics);
  const [rows, setRows] = useState<AppSyncOutboxRow[]>([]);
  const [pullCursors, setPullCursors] = useState<AppSyncPullCursorRow[]>([]);
  const [conflicts, setConflicts] = useState<AppSyncConflictRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SyncFilter>("all");
  const [search, setSearch] = useState("");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [expandedConflictId, setExpandedConflictId] = useState<string | null>(null);
  const [retryingRowId, setRetryingRowId] = useState<string | null>(null);
  const [resolvingConflictId, setResolvingConflictId] = useState<string | null>(null);
  const [isRunningLocalSync, setIsRunningLocalSync] = useState(false);
  const [isBackfillingOperational, setIsBackfillingOperational] = useState(false);
  const [isFindingChanges, setIsFindingChanges] = useState(false);
  const [retryProgress, setRetryProgress] = useState<{ done: number; total: number } | null>(null);
  const [direction, setDirection] = useState<"up" | "down">("up");
  const deferredSearch = useDeferredValue(search);

  const load = async () => {
    if (!window.bukowskiApp) return;
    try {
      const [nextSyncStatus, nextRows] = await Promise.all([
        window.bukowskiApp.getSyncStatusSnapshot(),
        window.bukowskiApp.getSyncOutboxRows(),
      ]);
      setDiagnostics(nextSyncStatus.diagnostics);
      setRows(nextRows);
      setPullCursors(nextSyncStatus.pullCursors);
      if (activeWorkspaceId) {
        try {
          setConflicts(await window.bukowskiApp.getSyncConflicts(activeWorkspaceId));
        } catch {
          /* conflicts are best-effort; keep the rest of the dashboard alive */
        }
      } else {
        setConflicts([]);
      }
      setError(null);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("settings.sync.couldNotLoad")));
    }
  };

  useVisiblePolling(
    () => {
      void load();
    },
    { intervalMs: 2_500 },
  );

  const workspacePullCursors = useMemo(
    () => pullCursors.filter((cursor) => !activeWorkspaceId || cursor.workspaceId === activeWorkspaceId),
    [activeWorkspaceId, pullCursors],
  );

  // A pull cursor is only a *problem* when it carries a real error. A cursor that
  // simply has not received new rows in a while is healthy ("no news"), not stale —
  // its updatedAt only advances when rows are applied, so age means quiet, not broken.
  const inboundErrorCount = useMemo(
    () => workspacePullCursors.filter((row) => row.lastError).length,
    [workspacePullCursors],
  );
  const pullCursorByEntity = useMemo(
    () => new Map(workspacePullCursors.map((cursor) => [coverageKeyForCursor(cursor.entityType), cursor])),
    [workspacePullCursors],
  );
  const inboundErrorCursors = useMemo(
    () => workspacePullCursors.filter((cursor) => cursor.lastError),
    [workspacePullCursors],
  );

  const visibleRows = useMemo(() => {
    const query = normalizeText(deferredSearch);
    return rows.filter((row) => {
      if (filter !== "all" && row.status !== filter) return false;
      if (!query) return true;
      return [row.entityType, row.entityId, row.operationType, row.lastError ?? "", row.payloadJson]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [deferredSearch, filter, rows]);

  const retryableRows = useMemo(
    () => rows.filter((row) => row.status === "failed" || row.status === "processing"),
    [rows],
  );

  // File transfers carry real byte sizes — drive the torrent-style aggregate bar.
  const uploadBytes = useMemo(() => {
    const files = rows.filter((row) => row.byteSize != null);
    const total = files.reduce((sum, row) => sum + (row.byteSize ?? 0), 0);
    const done = files
      .filter((row) => row.status === "sent")
      .reduce((sum, row) => sum + (row.byteSize ?? 0), 0);
    return { total, done, count: files.length, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [rows]);

  // Upload lane summary.
  const outboundLane = useMemo(() => {
    if (diagnostics.syncOutboxFailedCount > 0) return { tone: "critical" as const, key: "needsAttention" };
    if (diagnostics.syncOutboxProcessingCount > 0) return { tone: "info" as const, key: "uploading" };
    if (diagnostics.syncOutboxPendingCount > 0) return { tone: "warning" as const, key: "waiting" };
    return { tone: "success" as const, key: "upToDate" };
  }, [diagnostics]);

  // Download lane summary — paused (not an error) when the cloud is unreachable.
  const inboundLane = useMemo(() => {
    if (!canCloudSync) return { tone: "neutral" as const, key: "paused" };
    if (inboundErrorCount > 0) return { tone: "critical" as const, key: "needsAttention" };
    if (workspacePullCursors.length > 0) return { tone: "success" as const, key: "active" };
    return { tone: "warning" as const, key: "waiting" };
  }, [canCloudSync, inboundErrorCount, workspacePullCursors.length]);

  // One-sentence health verdict + the most useful action for it.
  const health = useMemo(() => {
    const realFailures = diagnostics.syncOutboxFailedCount + inboundErrorCount;
    if (conflicts.length > 0) return { tone: "critical" as const, key: "conflicts", count: conflicts.length };
    if (realFailures > 0) return { tone: "critical" as const, key: "failed", count: realFailures };
    if (diagnostics.syncOutboxProcessingCount + diagnostics.syncOutboxPendingCount > 0) {
      return { tone: "info" as const, key: "syncing", count: diagnostics.syncOutboxProcessingCount + diagnostics.syncOutboxPendingCount };
    }
    if (!canCloudSync) return { tone: "neutral" as const, key: "paused", count: 0 };
    return { tone: "success" as const, key: "upToDate", count: 0 };
  }, [canCloudSync, conflicts.length, diagnostics, inboundErrorCount]);

  const runAction = async (action: () => Promise<AppActionResult>, setPending: (value: boolean) => void) => {
    try {
      setPending(true);
      const result = await action();
      toast.success(t("settings.sync.toasts.actionComplete"), result.summary);
      setDiagnostics(result.diagnostics);
      setError(null);
      await load();
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("settings.sync.couldNotCompleteAction")));
    } finally {
      setPending(false);
    }
  };

  const retrySingleRow = async (rowId: string) => {
    if (!window.bukowskiApp) return;
    try {
      setRetryingRowId(rowId);
      const result = await window.bukowskiApp.retrySyncOutboxRow(rowId);
      toast.success(t("settings.sync.toasts.rowQueued"), result.summary);
      setDiagnostics(result.diagnostics);
      setError(null);
      setRows(await window.bukowskiApp.getSyncOutboxRows());
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("settings.sync.couldNotRetryRow")));
    } finally {
      setRetryingRowId(null);
    }
  };

  // Retry every retryable outbox row with visible progress.
  const retryAllRetryable = async () => {
    if (!window.bukowskiApp || !retryableRows.length) return;
    const total = retryableRows.length;
    try {
      setRetryProgress({ done: 0, total });
      let lastResult: AppActionResult | null = null;
      for (let index = 0; index < retryableRows.length; index += 1) {
        lastResult = await window.bukowskiApp.retrySyncOutboxRow(retryableRows[index]!.id);
        setRetryProgress({ done: index + 1, total });
      }
      if (lastResult) {
        toast.success(t("settings.sync.toasts.rowsQueuedTitle"), t("settings.sync.toasts.rowsQueuedBody", { count: total }));
        setDiagnostics(lastResult.diagnostics);
      }
      setError(null);
      await load();
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("settings.sync.couldNotRetryVisible")));
    } finally {
      setRetryProgress(null);
    }
  };

  // Ask the background pull hooks to fetch remote changes now, then reload.
  const findChanges = async () => {
    if (!canCloudSync) return;
    try {
      setIsFindingChanges(true);
      requestImmediatePull();
      await new Promise((resolve) => setTimeout(resolve, 1800));
      await load();
      setError(null);
    } finally {
      setIsFindingChanges(false);
    }
  };

  // Banner action for real failures: retry failed uploads AND refresh inbound.
  const resolveFailures = async () => {
    requestImmediatePull();
    if (retryableRows.length) {
      await retryAllRetryable();
    } else {
      await findChanges();
    }
  };

  const resolveConflict = async (conflictId: string, resolution: AppSyncConflictResolution) => {
    if (!window.bukowskiApp) return;
    try {
      setResolvingConflictId(conflictId);
      const result = await window.bukowskiApp.resolveSyncConflict({ conflictId, resolution });
      toast.success(t("settings.sync.conflicts.resolvedTitle"), result.summary);
      setDiagnostics(result.diagnostics);
      setError(null);
      await load();
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("settings.sync.conflicts.couldNotResolve")));
    } finally {
      setResolvingConflictId(null);
    }
  };

  const backfillOperationalSnapshots = async () => {
    if (!window.bukowskiApp || !isWorkspaceReady || !activeWorkspaceId) return;
    try {
      setIsBackfillingOperational(true);
      const result = await window.bukowskiApp.backfillOperationalSnapshots({ workspaceId: activeWorkspaceId });
      toast.success(t("settings.sync.toasts.backfillComplete"), result.summary);
      setDiagnostics(result.diagnostics);
      setError(null);
      await load();
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("settings.sync.couldNotBackfill")));
    } finally {
      setIsBackfillingOperational(false);
    }
  };

  const describeEntity = (entityType: string) =>
    t(`settings.sync.entityNames.${entityType}`, { defaultValue: formatEntityLabel(entityType) });
  const describeOperation = (operation: string) =>
    t(`settings.sync.operations.${operation}`, { defaultValue: operation });

  const pillTone =
    connection.tone === "offline" ? "offline" : !canCloudSync ? "paused" : connection.tone;
  const connectionLabel =
    pillTone === "paused"
      ? isLocalFallback
        ? t("settings.sync.connection.localOnly")
        : t("settings.sync.connection.paused")
      : t(`settings.sync.connection.${pillTone}`);
  const ConnectionIcon = pillTone === "offline" ? CloudOff : pillTone === "paused" ? Cloud : pillTone === "live" ? Wifi : CloudUpload;

  const syncOutboxStatusLabel = (status: string) =>
    t(`settings.sync.filters.${status}`, { defaultValue: getSyncOutboxStatusLabel(status) });

  return (
    <div className="page-stack settings-page sync-mc">
      <SectionHeader title={t("settings.sync.title")} />

      {error ? <div className="form-inline-error">{error}</div> : null}

      <SettingsLayout>
        <div className="sync-mc-topbar">
          <span className={`sync-conn-pill sync-conn-${pillTone}`}>
            <span className="sync-conn-dot" aria-hidden="true" />
            <ConnectionIcon size={14} />
            <span>{connectionLabel}</span>
          </span>
          <small className="sync-mc-lastpass">{t("settings.sync.outbound.lastPass", { value: formatDateLabel(diagnostics.lastSyncRunAt) })}</small>
        </div>

        <div className={`sync-health-banner sync-health-${health.tone}`}>
          <span className="sync-health-icon">
            {health.tone === "success" ? (
              <CheckCircle2 size={20} />
            ) : health.tone === "info" ? (
              <RefreshCw size={20} />
            ) : health.tone === "neutral" ? (
              <Cloud size={20} />
            ) : (
              <AlertTriangle size={20} />
            )}
          </span>
          <div className="sync-health-text">
            <strong>{t(`settings.sync.health.${health.key}.title`, { count: health.count })}</strong>
            <p>{t(`settings.sync.health.${health.key}.detail`, { count: health.count })}</p>
          </div>
          {health.key === "failed" ? (
            <button className="action-primary-button" disabled={Boolean(retryProgress) || isFindingChanges} onClick={() => void resolveFailures()} type="button">
              <RefreshCw size={14} className={retryProgress || isFindingChanges ? "is-spinning" : undefined} />
              <span>
                {retryProgress ? t("settings.sync.actions.retryingProgress", { done: retryProgress.done, total: retryProgress.total }) : t("settings.sync.health.failed.action")}
              </span>
            </button>
          ) : null}
        </div>

        <div className="sync-actions-bar">
          <button
            className="action-primary-button"
            disabled={isRunningLocalSync}
            onClick={() => void runAction(() => window.bukowskiApp!.runLocalSync(), setIsRunningLocalSync)}
            type="button"
          >
            <RefreshCw size={14} className={isRunningLocalSync ? "is-spinning" : undefined} />
            <span>{isRunningLocalSync ? t("settings.sync.actions.running") : t("settings.sync.actions.runUpload")}</span>
          </button>
          <button className="ghost-control" disabled={!canCloudSync || isFindingChanges} onClick={() => void findChanges()} type="button">
            <CloudDownload size={14} />
            <span>{isFindingChanges ? t("settings.sync.actions.findingChanges") : t("settings.sync.actions.findChanges")}</span>
          </button>
          <button
            className="ghost-control"
            disabled={!isWorkspaceReady || !activeWorkspaceId || isBackfillingOperational || isRunningLocalSync}
            onClick={() => void backfillOperationalSnapshots()}
            type="button"
          >
            {isBackfillingOperational ? t("settings.sync.actions.backfilling") : t("settings.sync.actions.backfill")}
          </button>
        </div>

        {conflicts.length > 0 ? (
          <SurfaceCard
            className="sync-conflicts-card"
            title={t("settings.sync.conflicts.title")}
            subtitle={t("settings.sync.conflicts.subtitle", { count: conflicts.length })}
          >
            <div className="sync-conflict-list">
              {conflicts.map((conflict) => {
                const isOpen = expandedConflictId === conflict.id;
                const isResolving = resolvingConflictId === conflict.id;
                return (
                  <div className="sync-conflict-row" key={conflict.id}>
                    <div className="sync-conflict-head">
                      <span className="sync-conflict-icon"><GitMerge size={16} /></span>
                      <div className="sync-conflict-info">
                        <strong>{describeEntity(conflict.entityType)}</strong>
                        <small>{t("settings.sync.conflicts.explainer")}</small>
                      </div>
                    </div>
                    <div className="sync-conflict-actions">
                      <button className="ghost-control" disabled={isResolving} onClick={() => void resolveConflict(conflict.id, "keep_local")} type="button">
                        {t("settings.sync.conflicts.keepMine")}
                      </button>
                      <button className="action-primary-button" disabled={isResolving} onClick={() => void resolveConflict(conflict.id, "take_remote")} type="button">
                        {t("settings.sync.conflicts.takeCloud")}
                      </button>
                      <button className="ghost-control" onClick={() => setExpandedConflictId(isOpen ? null : conflict.id)} type="button">
                        {isOpen ? t("settings.sync.conflicts.hideDiff") : t("settings.sync.conflicts.viewDiff")}
                      </button>
                    </div>
                    {isOpen ? (
                      <div className="sync-conflict-diff">
                        <div>
                          <span className="summary-label">{t("settings.sync.conflicts.mineLabel")}</span>
                          <pre className="sync-outbox-payload">{prettyJson(conflict.localSnapshotJson)}</pre>
                        </div>
                        <div>
                          <span className="summary-label">{t("settings.sync.conflicts.cloudLabel")}</span>
                          <pre className="sync-outbox-payload">{prettyJson(conflict.remoteSnapshotJson)}</pre>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </SurfaceCard>
        ) : null}

        <SurfaceCard className="sync-transfers-card" title={t("settings.sync.transfers.title")}>
          {inboundErrorCursors.length > 0 ? (
            <div className="sync-inbound-attention" role="alert">
              <p className="sync-inbound-attention-head">
                <AlertTriangle size={15} aria-hidden="true" />
                <span>
                  {t("settings.sync.inboundErrors.title", {
                    defaultValue: "Descargas con error · {{count}}",
                    count: inboundErrorCursors.length,
                  })}
                </span>
              </p>
              <div className="sync-coverage-grid">
                {inboundErrorCursors.map((cursor) => {
                  const coverageKey = coverageKeyForCursor(cursor.entityType);
                  const label = t(`settings.sync.coverage.${coverageKey}.label`, {
                    defaultValue: formatEntityLabel(cursor.entityType),
                  });
                  return (
                    <div className="sync-coverage-item is-error" key={cursor.entityType}>
                      <span className="sync-coverage-icon is-error"><AlertTriangle size={14} /></span>
                      <div>
                        <strong>{label}</strong>
                        <small>{cursor.lastError}</small>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="sync-xfer-toggle" role="tablist" aria-label={t("settings.sync.transfers.title")}>
            <button
              type="button"
              role="tab"
              aria-selected={direction === "up"}
              className={`sync-xfer-tab${direction === "up" ? " is-active" : ""}`}
              onClick={() => setDirection("up")}
            >
              <span className={`sync-xfer-tab-icon sync-direction-icon-${outboundLane.tone}`}><CloudUpload size={16} /></span>
              <span className="sync-xfer-tab-text">
                <strong>{t("settings.sync.transfers.uploadsTab")}</strong>
                <small>{t(`settings.sync.outbound.${outboundLane.key}`)}</small>
              </span>
              <span className="sync-xfer-count">{rows.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={direction === "down"}
              className={`sync-xfer-tab${direction === "down" ? " is-active" : ""}`}
              onClick={() => setDirection("down")}
            >
              <span className={`sync-xfer-tab-icon sync-direction-icon-${inboundLane.tone === "neutral" ? "info" : inboundLane.tone}`}><CloudDownload size={16} /></span>
              <span className="sync-xfer-tab-text">
                <strong>{t("settings.sync.transfers.downloadsTab")}</strong>
                <small>{t(`settings.sync.inbound.${inboundLane.key}`)}</small>
              </span>
              <span className="sync-xfer-count">{workspacePullCursors.length}</span>
            </button>
          </div>

          {direction === "up" ? (
            <div className="sync-xfer-panel">
              {uploadBytes.count > 0 ? (
                <div className="sync-xfer-aggregate">
                  <div className="sync-xfer-aggregate-head">
                    <span>{t("settings.sync.transfers.filesProgress", { done: formatBytes(uploadBytes.done), total: formatBytes(uploadBytes.total), count: uploadBytes.count })}</span>
                    <strong>{uploadBytes.pct}%</strong>
                  </div>
                  <div className="sync-xfer-track"><span className="sync-xfer-fill" style={{ width: `${uploadBytes.pct}%` }} /></div>
                </div>
              ) : null}

              <div className="sync-feed-toolbar">
                <label className="list-toolbar-search sync-feed-search" aria-label={t("settings.sync.queueToolbar.searchAria")}>
                  <Search aria-hidden size={14} />
                  <input
                    className="list-toolbar-search-input"
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("settings.sync.queueToolbar.searchPlaceholder")}
                    type="search"
                    value={search}
                  />
                </label>
                <label className="compact-filter-field sync-feed-filter">
                  <span>{t("settings.sync.queueToolbar.statusLabel")}</span>
                  <select className="compact-filter-select" onChange={(event) => setFilter(event.target.value as SyncFilter)} value={filter}>
                    {SYNC_FILTER_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {t(`settings.sync.filters.${value}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {visibleRows.length === 0 ? (
                <div className="empty-state">{t("settings.sync.queueEmpty")}</div>
              ) : (
                <div className="sync-feed-list">
                  {visibleRows.map((row) => {
                    const Icon = entityIcon(row.entityType);
                    const isOpen = expandedRowId === row.id;
                    const navPath = resolveEntityNavigationPath(row);
                    const canRetry = row.status === "failed" || row.status === "processing";
                    const isFile = row.byteSize != null;
                    const title = row.fileName || describeEntity(row.entityType);
                    return (
                      <div className={`sync-feed-row${isOpen ? " is-open" : ""}`} key={row.id}>
                        <button className="sync-feed-row-main" onClick={() => setExpandedRowId(isOpen ? null : row.id)} type="button">
                          <span className="sync-feed-row-icon"><Icon size={18} /></span>
                          <span className="sync-feed-row-text">
                            <strong>{title}</strong>
                            <small>{`${describeOperation(row.operationType)} · ${formatDateLabel(row.updatedAt)}`}</small>
                          </span>
                          {isFile ? <span className="sync-feed-size">{formatBytes(row.byteSize ?? 0)}</span> : null}
                          <StatusBadge tone={formatSyncStatusTone(row.status)}>{syncOutboxStatusLabel(row.status)}</StatusBadge>
                          <ChevronDown className="sync-feed-row-caret" size={16} aria-hidden="true" />
                        </button>
                        {isFile ? (
                          <div className="sync-xfer-rowbar">
                            <span className={`sync-xfer-fill is-${row.status}`} style={{ width: `${transferFillPercent(row.status)}%` }} />
                          </div>
                        ) : null}
                        {isOpen ? (
                          <div className="sync-feed-row-detail">
                            <div className="summary-grid">
                              <div className="summary-row">
                                <span className="summary-label">{t("settings.sync.detail.attempts")}</span>
                                <span className="summary-value">{row.attemptCount}</span>
                              </div>
                              <div className="summary-row">
                                <span className="summary-label">{t("settings.sync.detail.nextRetry")}</span>
                                <span className="summary-value">{formatDateLabel(row.nextRetryAt)}</span>
                              </div>
                              <div className="summary-row">
                                <span className="summary-label">{t("settings.sync.queueColumns.entityId")}</span>
                                <span className="summary-value">{row.entityId}</span>
                              </div>
                            </div>
                            {row.lastError ? (
                              <div className="form-inline-error">{t("settings.sync.detail.lastError", { message: row.lastError })}</div>
                            ) : null}
                            <div className="action-panel-actions action-panel-actions-start">
                              {canRetry ? (
                                <button className="ghost-control" disabled={retryingRowId === row.id} onClick={() => void retrySingleRow(row.id)} type="button">
                                  {retryingRowId === row.id ? t("settings.sync.detail.retrying") : t("settings.sync.detail.retry")}
                                </button>
                              ) : null}
                              {navPath ? (
                                <button className="ghost-control" onClick={() => navigate(navPath)} type="button">
                                  {t("settings.sync.detail.openEntity")}
                                </button>
                              ) : null}
                            </div>
                            <details className="sync-feed-tech">
                              <summary>{t("settings.sync.feed.technical")}</summary>
                              <pre className="sync-outbox-payload">{prettyJson(row.payloadJson)}</pre>
                            </details>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="sync-xfer-panel">
              <p className="sync-xfer-note">{t("settings.sync.transfers.downloadNote")}</p>
              <div className="sync-coverage-grid">
                {INBOUND_COVERAGE.map((entityType) => {
                  const cursor = pullCursorByEntity.get(entityType);
                  const hasError = Boolean(cursor?.lastError);
                  const isPaused = !canCloudSync && Boolean(cursor) && !hasError;
                  const isActive = canCloudSync && Boolean(cursor) && !hasError;
                  const label = t(`settings.sync.coverage.${entityType}.label`);
                  const detail = t(`settings.sync.coverage.${entityType}.detail`);
                  return (
                    <div className="sync-coverage-item" key={entityType}>
                      <span className={`sync-coverage-icon${hasError ? " is-error" : isActive ? " is-active" : ""}`}>
                        {hasError ? <AlertTriangle size={14} /> : isActive ? <CheckCircle2 size={14} /> : <CloudDownload size={14} />}
                      </span>
                      <div>
                        <strong>{label}</strong>
                        <small>
                          {hasError
                            ? cursor?.lastError
                            : isPaused
                              ? t("settings.sync.coveragePaused", { value: formatDateLabel(cursor?.updatedAt ?? null) })
                              : cursor
                                ? t("settings.sync.coverageRowsLatest", { count: cursor.lastPulledCount })
                                : detail}
                        </small>
                      </div>
                      <StatusBadge tone={hasError ? "critical" : isActive ? "success" : "neutral"}>
                        {hasError
                          ? t("settings.sync.coverageBadge.error")
                          : isActive
                            ? t("settings.sync.coverageBadge.active")
                            : isPaused
                              ? t("settings.sync.coverageBadge.paused")
                              : t("settings.sync.coverageBadge.ready")}
                      </StatusBadge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </SurfaceCard>
      </SettingsLayout>
    </div>
  );
};
