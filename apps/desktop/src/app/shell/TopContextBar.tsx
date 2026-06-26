import { AlertTriangle, CheckCircle2, CloudCog, CloudOff, RefreshCw, Search, Wifi, WifiOff, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { HelpMenu } from "@features/onboarding/HelpMenu";
import { useConnectivity } from "@shared/hooks/useConnectivity";
import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useShellContext } from "@shared/hooks/useShellContext";
import { useVisiblePolling } from "@shared/hooks/useVisiblePolling";
import { requestImmediatePull } from "@shared/hooks/useWorkspaceDataRefresh";
import {
  parseRealtimeSyncStatusSnapshot,
  realtimeSyncStatusEvent,
  realtimeSyncStatusKey,
  type RealtimeSyncStatusSnapshot,
} from "@shared/hooks/useRealtimeWorkspaceSync";
import { useLocale } from "@shared/hooks/useLocale";
import { resolveProjectColor } from "@shared/lib/projectColors";
import { parseSyncTimestamp } from "@shared/lib/syncHealth";
import { inboundCursorLabel } from "@shared/lib/syncInbound";
import type { AppDiagnosticsSnapshot, AppSyncPullCursorRow, AppSyncStatusSnapshot } from "@contracts";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { NotificationsButton } from "./NotificationsTray";

type TopContextBarProps = {
  onOpenSearch: () => void;
};

const syncButtonReleaseMs = 5_000;
const INBOUND_POPOVER_DISMISS_KEY = "bukowski:sync-popover-inbound-dismissed";
const realtimeFreshWindowMs = 10 * 60 * 1_000;
const syncFreshWindowMs = 3 * 60 * 1_000;

const isFreshTimestamp = (value: string | null | undefined, windowMs: number) => {
  const timestamp = parseSyncTimestamp(value);
  return timestamp !== null && Date.now() - timestamp <= windowMs;
};

export const TopContextBar = ({ onOpenSearch }: TopContextBarProps) => {
  const { activeProject, scopeChipLabel } = useShellContext();
  const { activeWorkspaceId } = useWorkspace();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { formatDateTime } = useLocale();
  const isOnline = useConnectivity();
  const { status: sessionStatus, isLocalFallback } = useSession();
  // Cloud sync only actually runs when authenticated, online and not on the local
  // fallback. When it can't, quiet/stale cursors are expected, not problems.
  const canCloudSync = isOnline && sessionStatus === "authenticated" && !isLocalFallback;
  const [diagnostics, setDiagnostics] = useState<AppDiagnosticsSnapshot | null>(null);
  const [pullCursors, setPullCursors] = useState<AppSyncPullCursorRow[]>([]);
  const [syncPopoverOpen, setSyncPopoverOpen] = useState(false);
  const [isRunningSync, setIsRunningSync] = useState(false);
  const [syncActionError, setSyncActionError] = useState<string | null>(null);
  const [syncActionNotice, setSyncActionNotice] = useState<string | null>(null);
  const [hasLoadedSyncSnapshot, setHasLoadedSyncSnapshot] = useState(false);
  const [isLoadingSyncSnapshot, setIsLoadingSyncSnapshot] = useState(false);
  const [realtimeSnapshot, setRealtimeSnapshot] = useState<RealtimeSyncStatusSnapshot | null>(() => {
    try {
      return parseRealtimeSyncStatusSnapshot(window.localStorage.getItem(realtimeSyncStatusKey));
    } catch {
      return null;
    }
  });
  const isMountedRef = useRef(true);
  const syncButtonReleaseTimerRef = useRef<number | null>(null);
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

  useEffect(() => {
    // Must re-arm on every mount: under StrictMode (and any remount) the
    // cleanup of the prior mount sets this false, and a ref initialized once to
    // `true` is never restored — leaving every `if (isMountedRef.current)`
    // state guard permanently false (sync snapshot stuck on "…", Sincronizar
    // button stuck on "Sincronizando").
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (syncButtonReleaseTimerRef.current) {
        window.clearTimeout(syncButtonReleaseTimerRef.current);
      }
    };
  }, []);

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

  const readSyncStatusSnapshot = async (): Promise<AppSyncStatusSnapshot> => {
    if (window.bukowskiApp?.getSyncStatusSnapshot) {
      return window.bukowskiApp.getSyncStatusSnapshot();
    }

    const [nextDiagnostics, nextPullCursors] = await Promise.all([
      window.bukowskiApp!.getDiagnostics(),
      window.bukowskiApp!.getSyncPullCursors(),
    ]);

    return {
      diagnostics: nextDiagnostics,
      pullCursors: nextPullCursors,
    };
  };

  const loadSyncSnapshot = async ({ showLoading = false } = {}) => {
    if (!window.bukowskiApp) {
      return false;
    }

    if (showLoading && isMountedRef.current) {
      setIsLoadingSyncSnapshot(true);
    }

    try {
      const nextSnapshot = await readSyncStatusSnapshot();
      if (isMountedRef.current) {
        setDiagnostics(nextSnapshot.diagnostics);
        setPullCursors(nextSnapshot.pullCursors);
        setHasLoadedSyncSnapshot(true);
        setSyncActionError(null);
      }

      return true;
    } catch (error) {
      if (isMountedRef.current && !hasLoadedSyncSnapshot) {
        setSyncActionError(t("shell.topBar.syncPopover.loadFailed", { defaultValue: "No se pudo leer el estado de sync." }));
      }
      return false;
    } finally {
      if (isMountedRef.current) {
        setIsLoadingSyncSnapshot(false);
      }
    }
  };

  useEffect(() => {
    void loadSyncSnapshot({ showLoading: true });
  }, []);

  useEffect(() => {
    const handleRealtimeStatus = (event: Event) => {
      setRealtimeSnapshot((event as CustomEvent<RealtimeSyncStatusSnapshot>).detail);
    };
    window.addEventListener(realtimeSyncStatusEvent, handleRealtimeStatus);
    return () => window.removeEventListener(realtimeSyncStatusEvent, handleRealtimeStatus);
  }, []);

  useVisiblePolling(
    () => {
      void loadSyncSnapshot();
    },
    { intervalMs: 2_500 },
  );

  const workspacePullCursors = pullCursors.filter(
    (cursor) => !activeWorkspaceId || cursor.workspaceId === activeWorkspaceId,
  );
  const erroredPullCursors = workspacePullCursors.filter((cursor) => cursor.lastError);
  const inboundFailedCount = erroredPullCursors.length;
  const latestInboundCheck = workspacePullCursors[0]?.updatedAt ?? null;
  const inboundErrorSignature = erroredPullCursors.map((cursor) => `${cursor.entityType}:${cursor.lastError}`).join("|");
  const [dismissedInboundSignature, setDismissedInboundSignature] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(INBOUND_POPOVER_DISMISS_KEY);
    } catch {
      return null;
    }
  });
  // Dismissal only sticks while the SAME set of errors persists; if a new error
  // appears or one clears, the signature changes and the list resurfaces so it
  // never hides a fresh problem.
  const inboundErrorsDismissed = inboundErrorSignature.length > 0 && dismissedInboundSignature === inboundErrorSignature;
  const dismissInboundErrors = () => {
    setDismissedInboundSignature(inboundErrorSignature);
    try {
      window.localStorage.setItem(INBOUND_POPOVER_DISMISS_KEY, inboundErrorSignature);
    } catch {
      /* storage unavailable */
    }
  };
  const latestSyncActivity = diagnostics?.lastSyncRunAt ?? latestInboundCheck;
  const outboundFailedCount = diagnostics?.syncOutboxFailedCount ?? 0;
  const hasRetryableOutboundFailures = outboundFailedCount > 0;
  const realtimeStatus = realtimeSnapshot?.status ?? null;
  const hasFreshRealtimeEvidence =
    isFreshTimestamp(realtimeSnapshot?.confirmedAt, realtimeFreshWindowMs) ||
    isFreshTimestamp(realtimeSnapshot?.lastEventAt, realtimeFreshWindowMs);
  const hasFreshSyncEvidence =
    isFreshTimestamp(latestSyncActivity, syncFreshWindowMs) ||
    isFreshTimestamp(latestInboundCheck, syncFreshWindowMs);

  const syncState = useMemo(() => {
    if (!hasLoadedSyncSnapshot) {
      return {
        label: t("shell.topBar.syncPopover.checking", { defaultValue: "Revisando sync" }),
        className: "sync-control-review",
        icon: RefreshCw,
        badge: null as number | null,
      };
    }

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

    // No cloud session (offline / local-only / signed out): calm state, no alarm.
    if (!canCloudSync) {
      return {
        label: isOnline
          ? t("shell.topBar.syncPopover.localOnly", { defaultValue: "Trabajando local" })
          : t("shell.topBar.syncPopover.offline", { defaultValue: "Sin conexión" }),
        className: "sync-control-healthy",
        icon: CloudOff,
        badge: null as number | null,
      };
    }

    if (isOnline && (realtimeStatus === "CHANNEL_ERROR" || realtimeStatus === "TIMED_OUT") && !hasFreshRealtimeEvidence) {
      return {
        label: t("shell.topBar.syncPopover.realtimeUnavailable", { defaultValue: "Tiempo real no confirmado" }),
        className: "sync-control-missing",
        icon: CloudOff,
        badge: null as number | null,
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

    if (isOnline && realtimeStatus !== "SUBSCRIBED" && !hasFreshRealtimeEvidence && !hasFreshSyncEvidence) {
      return {
        label: t("shell.topBar.syncPopover.realtimeChecking", { defaultValue: "Verificando tiempo real" }),
        className: "sync-control-review",
        icon: RefreshCw,
        badge: null as number | null,
      };
    }

    return {
      label: t("shell.topBar.upToDate"),
      className: "sync-control-healthy",
      icon: CheckCircle2,
      badge: null as number | null,
    };
  }, [
    canCloudSync,
    diagnostics,
    hasFreshRealtimeEvidence,
    hasFreshSyncEvidence,
    hasLoadedSyncSnapshot,
    inboundFailedCount,
    isOnline,
    latestSyncActivity,
    outboundFailedCount,
    realtimeStatus,
    t,
  ]);
  const SyncStatusIcon = syncState.icon;

  const refreshDiagnostics = () => loadSyncSnapshot({ showLoading: true });

  const releaseSyncButton = () => {
    if (syncButtonReleaseTimerRef.current) {
      window.clearTimeout(syncButtonReleaseTimerRef.current);
      syncButtonReleaseTimerRef.current = null;
    }
    if (isMountedRef.current) {
      setIsRunningSync(false);
    }
  };

  const formatSyncDate = (value: string | null | undefined) => {
    if (!value) {
      return t("common.never", { defaultValue: "Nunca" });
    }

    return formatDateTime(value) || value;
  };

  const handleRunSync = () => {
    if (!window.bukowskiApp || isRunningSync) {
      return;
    }

    setIsRunningSync(true);
    setSyncActionError(null);
    setSyncActionNotice(null);

    requestImmediatePull();

    syncButtonReleaseTimerRef.current = window.setTimeout(() => {
      releaseSyncButton();
      if (isMountedRef.current) {
        setSyncActionNotice(
          t("shell.topBar.syncPopover.syncStillRunning", {
            defaultValue: "Solicitud enviada. Revisando estado...",
          }),
        );
        void refreshDiagnostics();
      }
    }, syncButtonReleaseMs);

    const action = hasRetryableOutboundFailures
      ? window.bukowskiApp.retryAllFailedSyncOutboxRows()
      : window.bukowskiApp.runLocalSync();

    action
      .then(async (result) => {
        if (isMountedRef.current) {
          setDiagnostics(result.diagnostics);
          setHasLoadedSyncSnapshot(true);
          setSyncActionNotice(
            result.summary ||
              t("shell.topBar.syncPopover.syncComplete", {
                defaultValue: "Sincronización revisada.",
              }),
          );
          setSyncActionError(null);
        }

        await refreshDiagnostics();
      })
      .catch(() => {
        if (isMountedRef.current) {
          setSyncActionError(t("shell.topBar.syncPopover.syncFailed", { defaultValue: "No se pudo sincronizar ahora." }));
        }
      })
      .finally(() => {
        releaseSyncButton();
        requestImmediatePull();
        window.setTimeout(() => void refreshDiagnostics(), 600);
        window.setTimeout(() => void refreshDiagnostics(), 2_500);
      });
  };

  useEffect(() => {
    if (!isRunningSync && syncButtonReleaseTimerRef.current) {
      window.clearTimeout(syncButtonReleaseTimerRef.current);
      syncButtonReleaseTimerRef.current = null;
    }
  }, [isRunningSync]);

  const renderMetric = (value: number | string) => {
    if (!hasLoadedSyncSnapshot) {
      if (isLoadingSyncSnapshot) {
        return "...";
      }
      return t("common.notAvailableShort", { defaultValue: "N/D" });
    }
    return value;
  };
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
                  <SyncStatusIcon size={14} />
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

              {erroredPullCursors.length > 0 && !inboundErrorsDismissed ? (
                <div className="sync-popover-errors">
                  <div className="sync-popover-errors-head">
                    <span>
                      <AlertTriangle size={12} aria-hidden="true" />
                      {t("shell.topBar.syncPopover.inboundErrorsTitle", { defaultValue: "Descargas con error" })}
                    </span>
                    <button
                      type="button"
                      className="sync-popover-errors-close"
                      aria-label={t("common.close", { defaultValue: "Cerrar" })}
                      onClick={dismissInboundErrors}
                    >
                      <X size={12} />
                    </button>
                  </div>
                  {erroredPullCursors.map((cursor) => (
                    <div className="sync-popover-error-item" key={cursor.entityType}>
                      <strong>{inboundCursorLabel(t, cursor.entityType)}</strong>
                      <span>{cursor.lastError}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {diagnostics?.lastSyncSummary ? <p className="sync-popover-summary">{diagnostics.lastSyncSummary}</p> : null}
              {syncActionNotice ? <p className="sync-popover-success">{syncActionNotice}</p> : null}
              {syncActionError ? <p className="sync-popover-error">{syncActionError}</p> : null}

              <div className="sync-popover-actions">
                <button className="action-primary-button sync-popover-sync-button" disabled={isRunningSync} onClick={() => void handleRunSync()} type="button">
                  <RefreshCw size={12} className={isRunningSync ? "is-spinning" : undefined} />
                  {isRunningSync
                    ? t("shell.topBar.syncPopover.syncing", { defaultValue: "Sincronizando" })
                    : hasRetryableOutboundFailures
                      ? t("shell.topBar.syncPopover.retryFailed", { defaultValue: "Reintentar sync" })
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
