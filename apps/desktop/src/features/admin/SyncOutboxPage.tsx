import { AlertTriangle, CheckCircle2, ChevronDown, CloudDownload, CloudUpload, RefreshCw, Search } from "lucide-react";
import type { AppActionResult, AppDiagnosticsSnapshot, AppSyncOutboxRow, AppSyncPullCursorRow } from "@contracts";
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { DataTable } from "@shared/components/DataTable";
import { ResizableSideRailLayout } from "@shared/components/ResizableSideRailLayout";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useLocale } from "@shared/hooks/useLocale";
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

const syncOutboxStatusLabel = (status: string, t: ReturnType<typeof useTranslation>["t"]) =>
  t(`settings.sync.filters.${status}`, { defaultValue: getSyncOutboxStatusLabel(status) });

type SyncFilter = "all" | "pending" | "processing" | "failed" | "sent";
type SyncEntityFilter = "all" | string;

type SyncDisclosureProps = {
  children: ReactNode;
  defaultOpen?: boolean;
  summary: string;
  title: string;
};

const SyncDisclosure = ({ children, defaultOpen = false, summary, title }: SyncDisclosureProps) => {
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

const SYNC_FILTER_VALUES: SyncFilter[] = ["all", "pending", "processing", "failed", "sent"];

const INBOUND_COVERAGE = [
  "asset_snapshots",
  "asset_categories",
  "locations",
  "clients",
  "manufacturers",
  "production_companies",
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
] as const;

type InboundCoverageId = (typeof INBOUND_COVERAGE)[number];

/** Returns a stable status descriptor with i18n keys. Translation happens at render time. */
const resolveOutboundStatus = (diagnostics: AppDiagnosticsSnapshot) => {
  if (diagnostics.syncOutboxFailedCount > 0) {
    return {
      tone: "critical" as const,
      labelKey: "settings.sync.outbound.needsAttention",
      detailKey: "settings.sync.outbound.needsAttentionDetail",
      detailCount: diagnostics.syncOutboxFailedCount,
    };
  }

  if (diagnostics.syncOutboxProcessingCount > 0) {
    return {
      tone: "info" as const,
      labelKey: "settings.sync.outbound.uploading",
      detailKey: "settings.sync.outbound.uploadingDetail",
      detailCount: diagnostics.syncOutboxProcessingCount,
    };
  }

  if (diagnostics.syncOutboxPendingCount > 0) {
    return {
      tone: "warning" as const,
      labelKey: "settings.sync.outbound.waiting",
      detailKey: "settings.sync.outbound.waitingDetail",
      detailCount: diagnostics.syncOutboxPendingCount,
    };
  }

  return {
    tone: "success" as const,
    labelKey: "settings.sync.outbound.upToDate",
    detailKey: "settings.sync.outbound.upToDateDetail",
    detailCount: 0,
  };
};

const resolveInboundStatus = (pullCursors: AppSyncPullCursorRow[]) => {
  const failed = pullCursors.filter((row) => row.lastError);
  const activeCursors = pullCursors.filter((row) => !row.lastError);
  const latest = activeCursors[0]?.updatedAt ?? pullCursors[0]?.updatedAt ?? null;

  if (failed.length > 0) {
    return {
      tone: "critical" as const,
      labelKey: "settings.sync.inbound.needsAttention",
      detailKey: "settings.sync.inbound.needsAttentionDetail",
      detailCount: failed.length,
      latest,
    };
  }

  if (pullCursors.length > 0) {
    return {
      tone: "success" as const,
      labelKey: "settings.sync.inbound.active",
      detailKey: "settings.sync.inbound.activeDetail",
      detailCount: pullCursors.length,
      latest,
    };
  }

  return {
    tone: "warning" as const,
    labelKey: "settings.sync.inbound.waiting",
    detailKey: "settings.sync.inbound.waitingDetail",
    detailCount: 0,
    latest: null as string | null,
  };
};

const formatSyncStatusTone = (status: AppSyncOutboxRow["status"]) => {
  if (status === "sent") return "success" as const;
  if (status === "failed") return "critical" as const;
  if (status === "processing") return "info" as const;
  return "warning" as const;
};

const normalizeText = (value: string) => value.trim().toLowerCase();

const resolveEntityNavigationPath = (row: AppSyncOutboxRow) => {
  if (row.entityType === "asset_event") return `/assets/${row.entityId}`;
  if (row.entityType === "packing_slip") return `/packing-slips?focus=${row.entityId}`;
  if (row.entityType === "incident") return `/incidents?focus=${row.entityId}`;
  if (row.entityType === "financial_entry") return `/finance/entries?focus=${row.entityId}`;
  return null;
};

const formatEntityLabel = (value: string) =>
  value
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");

export const SyncOutboxPage = () => {
  const navigate = useNavigate();
  const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
  const toast = useToast();
  const { t } = useTranslation();
  const { formatDateTime } = useLocale();
  const formatDateLabel = (value: string | null) => {
    if (!value) return t("common.never");
    return formatDateTime(value) || value;
  };
  const [diagnostics, setDiagnostics] = useState<AppDiagnosticsSnapshot>(emptyDiagnostics);
  const [rows, setRows] = useState<AppSyncOutboxRow[]>([]);
  const [pullCursors, setPullCursors] = useState<AppSyncPullCursorRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SyncFilter>("all");
  const [entityFilter, setEntityFilter] = useState<SyncEntityFilter>("all");
  const [search, setSearch] = useState("");
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [retryingRowId, setRetryingRowId] = useState<string | null>(null);
  const [isRetryingAllFailed, setIsRetryingAllFailed] = useState(false);
  const [isRetryingVisible, setIsRetryingVisible] = useState(false);
  const [isRunningLocalSync, setIsRunningLocalSync] = useState(false);
  const [isBackfillingOperational, setIsBackfillingOperational] = useState(false);
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
      setError(getUserFacingErrorMessage(nextError, t("settings.sync.couldNotLoad")));
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

  const summarizeSelection = (row: AppSyncOutboxRow | null) => {
    if (!row) return t("settings.sync.detailSelectPrompt");
    return `${row.entityType} · ${row.operationType}`;
  };

  const runAction = async (action: () => Promise<AppActionResult>, setPending: (value: boolean) => void) => {
    try {
      setPending(true);
      const result = await action();
      toast.success(t("settings.sync.toasts.actionComplete"), result.summary);
      setDiagnostics(result.diagnostics);
      setError(null);
      const nextRows = await window.bukowskiApp!.getSyncOutboxRows();
      setRows(nextRows);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("settings.sync.couldNotCompleteAction")));
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
      toast.success(t("settings.sync.toasts.rowQueued"), result.summary);
      setDiagnostics(result.diagnostics);
      setError(null);
      const nextRows = await window.bukowskiApp.getSyncOutboxRows();
      setRows(nextRows);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("settings.sync.couldNotRetryRow")));
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
        toast.success(
          t("settings.sync.toasts.rowsQueuedTitle"),
          t("settings.sync.toasts.rowsQueuedBody", { count: visibleRetryableRows.length }),
        );
        setDiagnostics(lastResult.diagnostics);
      }
      setError(null);
      const nextRows = await window.bukowskiApp.getSyncOutboxRows();
      setRows(nextRows);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("settings.sync.couldNotRetryVisible")));
    } finally {
      setIsRetryingVisible(false);
    }
  };

  const backfillOperationalSnapshots = async () => {
    if (!window.bukowskiApp || !isWorkspaceReady || !activeWorkspaceId) {
      return;
    }

    try {
      setIsBackfillingOperational(true);
      const result = await window.bukowskiApp.backfillOperationalSnapshots({
        workspaceId: activeWorkspaceId,
      });
      toast.success(t("settings.sync.toasts.backfillComplete"), result.summary);
      setDiagnostics(result.diagnostics);
      setError(null);
      const [nextRows, nextPullCursors] = await Promise.all([
        window.bukowskiApp.getSyncOutboxRows(),
        window.bukowskiApp.getSyncPullCursors().catch(() => pullCursors),
      ]);
      setRows(nextRows);
      setPullCursors(nextPullCursors);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("settings.sync.couldNotBackfill")));
    } finally {
      setIsBackfillingOperational(false);
    }
  };

  const isInboundCoverageId = (value: string): value is InboundCoverageId =>
    (INBOUND_COVERAGE as readonly string[]).includes(value);

  return (
    <div className="page-stack settings-page">
      <SectionHeader title={t("settings.sync.title")} />

      {error ? <div className="form-inline-error">{error}</div> : null}

      <SettingsLayout>
      <div className="sync-overview-grid">
        <SurfaceCard className="sync-direction-card" title={t("settings.sync.outbound.cardTitle")}>
          <div className="sync-direction-head">
            <span className={`sync-direction-icon sync-direction-icon-${outboundStatus.tone}`}>
              <CloudUpload size={18} />
            </span>
            <div>
              <StatusBadge tone={outboundStatus.tone}>{t(outboundStatus.labelKey)}</StatusBadge>
              <p>{t(outboundStatus.detailKey, { count: outboundStatus.detailCount })}</p>
            </div>
          </div>
          <div className="sync-metric-row">
            <span><strong>{diagnostics.syncOutboxPendingCount}</strong> {t("settings.sync.outbound.metrics.pending")}</span>
            <span><strong>{diagnostics.syncOutboxProcessingCount}</strong> {t("settings.sync.outbound.metrics.uploading")}</span>
            <span><strong>{diagnostics.syncOutboxFailedCount}</strong> {t("settings.sync.outbound.metrics.failed")}</span>
          </div>
          <small>{t("settings.sync.outbound.lastPass", { value: formatDateLabel(diagnostics.lastSyncRunAt) })}</small>
        </SurfaceCard>

        <SurfaceCard className="sync-direction-card" title={t("settings.sync.inbound.cardTitle")}>
          <div className="sync-direction-head">
            <span className={`sync-direction-icon sync-direction-icon-${inboundStatus.tone}`}>
              <CloudDownload size={18} />
            </span>
            <div>
              <StatusBadge tone={inboundStatus.tone}>{t(inboundStatus.labelKey)}</StatusBadge>
              <p>{t(inboundStatus.detailKey, { count: inboundStatus.detailCount })}</p>
            </div>
          </div>
          <div className="sync-metric-row">
            <span><strong>{pullCursors.length}</strong> {t("settings.sync.inbound.metrics.sources")}</span>
            <span><strong>{pullCursors.reduce((sum, row) => sum + row.lastPulledCount, 0)}</strong> {t("settings.sync.inbound.metrics.latest")}</span>
            <span><strong>{pullCursors.filter((row) => row.lastError).length}</strong> {t("settings.sync.inbound.metrics.errors")}</span>
          </div>
          <small>{t("settings.sync.inbound.lastCheck", { value: formatDateLabel(inboundStatus.latest) })}</small>
        </SurfaceCard>
      </div>

      <SyncDisclosure
        title={t("settings.sync.actionsDisclosure.title")}
        summary={
          diagnostics.syncOutboxFailedCount
            ? t("settings.sync.actionsDisclosure.summaryWithFailed", { count: diagnostics.syncOutboxFailedCount })
            : t("settings.sync.actionsDisclosure.summaryDefault")
        }
      >
        <div className="sync-action-row">
          <button
            className="action-primary-button"
            disabled={isRunningLocalSync}
            onClick={() => void runAction(() => window.bukowskiApp!.runLocalSync(), setIsRunningLocalSync)}
            type="button"
          >
            <RefreshCw size={14} />
            <span>{isRunningLocalSync ? t("settings.sync.actions.running") : t("settings.sync.actions.runUpload")}</span>
          </button>
          <button
            className="ghost-control"
            disabled={!diagnostics.syncOutboxFailedCount || isRetryingAllFailed}
            onClick={() => void runAction(() => window.bukowskiApp!.retryAllFailedSyncOutboxRows(), setIsRetryingAllFailed)}
            type="button"
          >
            {isRetryingAllFailed ? t("settings.sync.actions.retryingFailed") : t("settings.sync.actions.retryFailed")}
          </button>
          <button
            className="ghost-control"
            disabled={!visibleRetryableRows.length || isRetryingVisible}
            onClick={() => void retryVisibleRows()}
            type="button"
          >
            {isRetryingVisible
              ? t("settings.sync.actions.retryingVisible")
              : t("settings.sync.actions.retryVisible", { count: visibleRetryableRows.length })}
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
      </SyncDisclosure>

      <SyncDisclosure
        title={t("settings.sync.coverageDisclosure.title")}
        summary={t("settings.sync.coverageDisclosure.summary", {
          count: INBOUND_COVERAGE.length,
          errors: pullCursors.filter((row) => row.lastError).length,
        })}
      >
        <SurfaceCard title={t("settings.sync.coverageCard")}>
          <div className="sync-coverage-grid">
            {INBOUND_COVERAGE.map((entityType) => {
              const cursor = pullCursorByEntity.get(entityType);
              const isActive = true;
              const hasError = Boolean(cursor?.lastError);
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
                        : t("settings.sync.coverageBadge.planned")}
                  </StatusBadge>
                </div>
              );
            })}
          </div>
        </SurfaceCard>
      </SyncDisclosure>

      <SyncDisclosure
        title={t("settings.sync.queueDisclosure.title")}
        summary={t("settings.sync.queueDisclosure.summary", { visible: visibleRows.length, total: rows.length })}
      >
        <ResizableSideRailLayout className="split-layout" defaultWidth={420} maxWidth={680} minWidth={320} storageKey="sync-outbox-side-rail-width">
          <SurfaceCard title={t("settings.sync.queueCardTitle")}>
            <div className="sync-outbox-toolbar">
              <div className="sync-outbox-filter-grid">
                <label className="compact-filter-field">
                  <span>{t("settings.sync.queueToolbar.statusLabel")}</span>
                  <select
                    className="compact-filter-select"
                    onChange={(event) => setFilter(event.target.value as SyncFilter)}
                    value={filter}
                  >
                    {SYNC_FILTER_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {t(`settings.sync.filters.${value}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="compact-filter-field">
                  <span>{t("settings.sync.queueToolbar.entityLabel")}</span>
                  <select
                    className="compact-filter-select"
                    onChange={(event) => setEntityFilter(event.target.value)}
                    value={entityFilter}
                  >
                    {entityFilters.map((item) => (
                      <option key={item} value={item}>
                        {item === "all"
                          ? t("settings.sync.filters.allEntities")
                          : isInboundCoverageId(item)
                            ? t(`settings.sync.coverage.${item}.label`)
                            : formatEntityLabel(item)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="list-toolbar-search sync-outbox-search" aria-label={t("settings.sync.queueToolbar.searchAria")}>
                <Search aria-hidden size={14} />
                <input
                  className="list-toolbar-search-input"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("settings.sync.queueToolbar.searchPlaceholder")}
                  type="search"
                  value={search}
                />
              </label>
            </div>

            <DataTable
              activeRowId={activeRowId}
              getRowId={(row) => row.id}
              onRowClick={(row) => setActiveRowId(row.id)}
              persistKey="sync-outbox"
              columns={[
                {
                  key: "status",
                  label: t("settings.sync.queueColumns.status"),
                  render: (row) => <StatusBadge tone={formatSyncStatusTone(row.status)}>{syncOutboxStatusLabel(row.status, t)}</StatusBadge>,
                },
                { key: "entityType", label: t("settings.sync.queueColumns.entity"), render: (row) => row.entityType },
                { key: "entityId", label: t("settings.sync.queueColumns.entityId"), render: (row) => row.entityId },
                { key: "operationType", label: t("settings.sync.queueColumns.operation"), render: (row) => row.operationType },
                { key: "attemptCount", label: t("settings.sync.queueColumns.attempts"), align: "right", render: (row) => row.attemptCount },
                { key: "updatedAt", label: t("settings.sync.queueColumns.updated"), render: (row) => formatDateLabel(row.updatedAt) },
              ]}
              emptyMessage={t("settings.sync.queueEmpty")}
              rows={visibleRows}
            />
          </SurfaceCard>

          <SurfaceCard title={t("settings.sync.detailCardTitle")} subtitle={summarizeSelection(activeRow)}>
            {!activeRow ? (
              <div className="empty-state">{t("settings.sync.detailEmpty")}</div>
            ) : (
              <div className="sync-outbox-detail-stack">
                <div className="summary-grid">
                  <div className="summary-row">
                    <span className="summary-label">{t("settings.sync.detail.status")}</span>
                    <span className="summary-value">{syncOutboxStatusLabel(activeRow.status, t)}</span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">{t("settings.sync.detail.entity")}</span>
                    <span className="summary-value">{activeRow.entityType}</span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">{t("settings.sync.detail.entityId")}</span>
                    <span className="summary-value">{activeRow.entityId}</span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">{t("settings.sync.detail.operation")}</span>
                    <span className="summary-value">{activeRow.operationType}</span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">{t("settings.sync.detail.attempts")}</span>
                    <span className="summary-value">{activeRow.attemptCount}</span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">{t("settings.sync.detail.nextRetry")}</span>
                    <span className="summary-value">{formatDateLabel(activeRow.nextRetryAt)}</span>
                  </div>
                </div>

                {activeRow.lastError ? (
                  <div className="form-inline-error">{t("settings.sync.detail.lastError", { message: activeRow.lastError })}</div>
                ) : null}

                <div className="action-panel-actions action-panel-actions-start">
                  <button
                    className="ghost-control"
                    disabled={retryingRowId === activeRow.id || (activeRow.status !== "failed" && activeRow.status !== "processing")}
                    onClick={() => void retrySingleRow(activeRow.id)}
                    type="button"
                  >
                    {retryingRowId === activeRow.id ? t("settings.sync.detail.retrying") : t("settings.sync.detail.retry")}
                  </button>
                  {resolveEntityNavigationPath(activeRow) ? (
                    <button
                      className="ghost-control"
                      onClick={() => navigate(resolveEntityNavigationPath(activeRow)!)}
                      type="button"
                    >
                      {t("settings.sync.detail.openEntity")}
                    </button>
                  ) : null}
                </div>

                <div className="sync-outbox-payload-block">
                  <span className="summary-label">{t("settings.sync.detail.payload")}</span>
                  <pre className="sync-outbox-payload">{activeRow.payloadJson}</pre>
                </div>
              </div>
            )}
          </SurfaceCard>
        </ResizableSideRailLayout>
      </SyncDisclosure>
      </SettingsLayout>
    </div>
  );
};
