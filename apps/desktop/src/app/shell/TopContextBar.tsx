import { AlertTriangle, CheckCircle2, CloudCog, CloudOff, RefreshCw, Search, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { HelpMenu } from "@features/onboarding/HelpMenu";
import { useConnectivity } from "@shared/hooks/useConnectivity";
import { useShellContext } from "@shared/hooks/useShellContext";
import { useVisiblePolling } from "@shared/hooks/useVisiblePolling";
import { requestImmediatePull } from "@shared/hooks/useWorkspaceDataRefresh";
import { useLocale } from "@shared/hooks/useLocale";
import { resolveProjectColor } from "@shared/lib/projectColors";
import type { AppDiagnosticsSnapshot, AppSyncPullCursorRow } from "@contracts";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { NotificationsButton } from "./NotificationsTray";

type TopContextBarProps = {
  onOpenSearch: () => void;
};

const syncSnapshotTimeoutMs = 3_500;
const runSyncTimeoutMs = 5_000;

export const TopContextBar = ({ onOpenSearch }: TopContextBarProps) => {
  const { activeProject, scopeChipLabel } = useShellContext();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { formatDateTime } = useLocale();
  const isOnline = useConnectivity();
  const [diagnostics, setDiagnostics] = useState<AppDiagnosticsSnapshot | null>(null);
  const [pullCursors, setPullCursors] = useState<AppSyncPullCursorRow[]>([]);
  const [syncPopoverOpen, setSyncPopoverOpen] = useState(false);
  const [isRunningSync, setIsRunningSync] = useState(false);
  const [syncActionError, setSyncActionError] = useState<string | null>(null);
  const [syncActionNotice, setSyncActionNotice] = useState<string | null>(null);
  const [hasLoadedSyncSnapshot, setHasLoadedSyncSnapshot] = useState(false);
  const [isLoadingSyncSnapshot, setIsLoadingSyncSnapshot] = useState(false);
  const isMountedRef = useRef(true);
  const syncPopoverRef = useRef<HTMLDivElement | null>(null);
  const projectChipStyle = useMemo(
    () =>
      activeProject
        ? ({
            "--project-chip-color": resolveProjectColor(activeProject.colorKey),
          } as CSSProperties)
        : undefined,
    [activeProject],
  );

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!syncPopoverOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!syncPopoverRef.current?.contains(event.target as Node)) {
        setSyncPopoverOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSyncPopoverOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [syncPopoverOpen]);

  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) => {
    let timeoutId = 0;
    const timeout = new Promise<T>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const loadSyncSnapshot = async ({ showLoading = false } = {}) => {
    if (!window.bukowskiApp) {
      return false;
    }

    if (showLoading && isMountedRef.current) {
      setIsLoadingSyncSnapshot(true);
    }

    try {
      const [diagnosticsResult, cursorsResult] = await Promise.allSettled([
        withTimeout(window.bukowskiApp.getDiagnostics(), syncSnapshotTimeoutMs, "sync-snapshot-timeout"),
        withTimeout(window.bukowskiApp.getSyncPullCursors(), syncSnapshotTimeoutMs, "sync-cursors-timeout"),
      ]);

      const nextDiagnostics = diagnosticsResult.status === "fulfilled" ? diagnosticsResult.value : null;
      const nextPullCursors = cursorsResult.status === "fulfilled" ? cursorsResult.value : null;

      if (isMountedRef.current) {
        if (nextDiagnostics) {
          setDiagnostics(nextDiagnostics);
        }
        if (nextPullCursors) {
          setPullCursors(nextPullCursors);
        }
        if (nextDiagnostics || nextPullCursors) {
          setHasLoadedSyncSnapshot(true);
        }
      }

      return Boolean(nextDiagnostics || nextPullCursors);
    } finally {
      if (isMountedRef.current) {
        setIsLoadingSyncSnapshot(false);
      }
    }
  };

  useVisiblePolling(
    () => {
      void loadSyncSnapshot();
    },
    { intervalMs: 15_000 },
  );

  const inboundFailedCount = pullCursors.filter((cursor) => cursor.lastError).length;
  const latestInboundCheck = pullCursors[0]?.updatedAt ?? null;
  const latestSyncActivity = diagnostics?.lastSyncRunAt ?? latestInboundCheck;

  const syncState = useMemo(() => {
    if (!hasLoadedSyncSnapshot) {
      return {
        label: t("shell.topBar.syncPopover.checking", { defaultValue: "Revisando sync" }),
        className: "sync-control-review",
        icon: RefreshCw,
        badge: null as number | null,
      };
    }

    const outboundFailedCount = diagnostics?.syncOutboxFailedCount ?? 0;
    const lastSyncStatus = diagnostics?.lastSyncStatus ?? "idle";

    if (outboundFailedCount > 0 || lastSyncStatus === "failed" || inboundFailedCount > 0) {
      const failedCount = outboundFailedCount + inboundFailedCount;
      return {
        label:
          failedCount > 0
            ? t("shell.topBar.syncFailedWithCount", { count: failedCount })
            : t("shell.topBar.syncFailed"),
        className: "sync-control-review",
        icon: AlertTriangle,
        badge: failedCount,
      };
    }

    const queuedCount = (diagnostics?.syncOutboxPendingCount ?? 0) + (diagnostics?.syncOutboxProcessingCount ?? 0);

    if (queuedCount > 0) {
      return {
        label: t("shell.topBar.syncing", { count: queuedCount }),
        className: "sync-control-review",
        icon: AlertTriangle,
        badge: queuedCount,
      };
    }

    if (!latestSyncActivity) {
      return {
        label: t("shell.topBar.syncPopover.noSync", { defaultValue: "Sin sync confirmado" }),
        className: "sync-control-missing",
        icon: CloudOff,
        badge: null as number | null,
      };
    }

    return {
      label: t("shell.topBar.upToDate"),
      className: "sync-control-healthy",
      icon: CheckCircle2,
      badge: null as number | null,
    };
  }, [diagnostics, hasLoadedSyncSnapshot, inboundFailedCount, latestSyncActivity, t]);
  const SyncStatusIcon = syncState.icon;

  const refreshDiagnostics = () => loadSyncSnapshot({ showLoading: true });

  const formatSyncDate = (value: string | null | undefined) => {
    if (!value) {
      return t("common.never", { defaultValue: "Nunca" });
    }

    return formatDateTime(value) || value;
  };

  const handleRunSync = async () => {
    if (!window.bukowskiApp || isRunningSync) {
      return;
    }

    setIsRunningSync(true);
    setSyncActionError(null);
    setSyncActionNotice(null);

    try {
      const result = await withTimeout(window.bukowskiApp.runLocalSync(), runSyncTimeoutMs, "sync-timeout");
      requestImmediatePull();
      if (isMountedRef.current) {
        setDiagnostics(result.diagnostics);
        setHasLoadedSyncSnapshot(true);
        setSyncActionNotice(t("shell.topBar.syncPopover.syncComplete", { defaultValue: "Sincronización revisada." }));
      }
      window.setTimeout(() => void refreshDiagnostics(), 800);
    } catch (error) {
      if (isMountedRef.current) {
        if (error instanceof Error && error.message === "sync-timeout") {
          requestImmediatePull();
          setSyncActionNotice(
            t("shell.topBar.syncPopover.syncStillRunning", {
              defaultValue: "Solicitud enviada. Revisaremos el estado en unos segundos.",
            }),
          );
          window.setTimeout(() => void refreshDiagnostics(), 600);
          window.setTimeout(() => void refreshDiagnostics(), 2_500);
        } else {
          setSyncActionError(t("shell.topBar.syncPopover.syncFailed", { defaultValue: "No se pudo sincronizar ahora." }));
        }
        void refreshDiagnostics();
      }
    } finally {
      if (isMountedRef.current) {
        setIsRunningSync(false);
      }
    }
  };

  const renderMetric = (value: number | string) => (hasLoadedSyncSnapshot ? value : "...");
  const renderLastRun = () => {
    if (!hasLoadedSyncSnapshot) {
      return isLoadingSyncSnapshot
        ? t("shell.topBar.syncPopover.checkingShort", { defaultValue: "Revisando..." })
        : t("common.notAvailable", { defaultValue: "No disponible" });
    }
    return formatSyncDate(latestSyncActivity);
  };

  return (
    <div className="top-context-bar">
      <div className="top-context-group top-context-group-primary">
        <WorkspaceSwitcher />
      </div>

      {scopeChipLabel ? (
        <div className="top-context-group top-context-group-center">
          <div className="context-chip context-chip-project" style={projectChipStyle}>
            {activeProject ? <span aria-hidden="true" className="context-chip-project-dot" /> : null}
            <span>{scopeChipLabel}</span>
          </div>
        </div>
      ) : null}

      <div className="top-context-group top-context-group-end">
        <button className="ghost-control search-control" onClick={onOpenSearch} type="button">
          <Search size={13} />
          <span>{t("shell.topBar.search")}</span>
          <kbd>⌘K</kbd>
        </button>
        <NotificationsButton />
        <HelpMenu />
        <span
          aria-label={isOnline ? t("shell.topBar.online") : t("shell.topBar.offlineTooltip")}
          className={`icon-ghost-control connectivity-indicator ${isOnline ? "is-online" : "is-offline"}`}
          data-tooltip={isOnline ? t("shell.topBar.online") : t("shell.topBar.offlineTooltip")}
          role="status"
        >
          {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
        </span>
        <div className="sync-popover-anchor" ref={syncPopoverRef}>
          <button
            aria-expanded={syncPopoverOpen}
            aria-label={syncState.label}
            className={`icon-ghost-control sync-control ${syncState.className}`}
            data-tooltip={syncPopoverOpen ? undefined : syncState.label}
            onClick={() => {
              setSyncPopoverOpen((current) => {
                if (!current) {
                  void refreshDiagnostics();
                }
                return !current;
              });
              setSyncActionError(null);
            }}
            type="button"
          >
            <CloudCog size={17} />
            {syncState.badge ? <span className="sync-control-badge">{syncState.badge}</span> : null}
          </button>

          {syncPopoverOpen ? (
            <div className="sync-popover" role="dialog" aria-label={t("shell.topBar.syncPopover.title", { defaultValue: "Sincronización" })}>
              <div className="sync-popover-header">
                <div>
                  <strong>{syncState.label}</strong>
                </div>
                <span className={`sync-popover-status ${syncState.className}`}>
                  <SyncStatusIcon size={17} />
                </span>
              </div>

              <div className="sync-popover-grid">
                <span>{t("shell.topBar.syncPopover.pending", { defaultValue: "Pendientes" })}</span>
                <strong>{renderMetric(diagnostics?.syncOutboxPendingCount ?? 0)}</strong>
                <span>{t("shell.topBar.syncPopover.processing", { defaultValue: "Procesando" })}</span>
                <strong>{renderMetric(diagnostics?.syncOutboxProcessingCount ?? 0)}</strong>
                <span>{t("shell.topBar.syncPopover.failed", { defaultValue: "Fallidas" })}</span>
                <strong>{renderMetric(diagnostics?.syncOutboxFailedCount ?? 0)}</strong>
                <span>{t("shell.topBar.syncPopover.inbound", { defaultValue: "Entrantes" })}</span>
                <strong>
                  {renderMetric(
                    inboundFailedCount
                      ? t("shell.topBar.syncPopover.inboundErrors", { defaultValue: "{{count}} con error", count: inboundFailedCount })
                      : pullCursors.length,
                  )}
                </strong>
                <span>{t("shell.topBar.syncPopover.lastRun", { defaultValue: "Última pasada" })}</span>
                <strong>{renderLastRun()}</strong>
              </div>

              {diagnostics?.lastSyncSummary ? <p className="sync-popover-summary">{diagnostics.lastSyncSummary}</p> : null}
              {syncActionNotice ? <p className="sync-popover-success">{syncActionNotice}</p> : null}
              {syncActionError ? <p className="sync-popover-error">{syncActionError}</p> : null}

              <div className="sync-popover-actions">
                <button className="action-primary-button sync-popover-sync-button" disabled={isRunningSync} onClick={() => void handleRunSync()} type="button">
                  <RefreshCw size={13} className={isRunningSync ? "is-spinning" : undefined} />
                  {isRunningSync
                    ? t("shell.topBar.syncPopover.syncing", { defaultValue: "Sincronizando" })
                    : t("shell.topBar.syncPopover.syncNow", { defaultValue: "Sincronizar" })}
                </button>
                <button
                  className="action-primary-button"
                  onClick={() => {
                    setSyncPopoverOpen(false);
                    navigate("/settings/sync");
                  }}
                  type="button"
                >
                  {t("shell.topBar.syncPopover.details", { defaultValue: "Ver detalles" })}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
