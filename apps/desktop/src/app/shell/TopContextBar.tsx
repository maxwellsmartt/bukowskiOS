import { CloudCog, Search, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { HelpMenu } from "@features/onboarding/HelpMenu";
import { useConnectivity } from "@shared/hooks/useConnectivity";
import { useShellContext } from "@shared/hooks/useShellContext";
import { useVisiblePolling } from "@shared/hooks/useVisiblePolling";
import { resolveProjectColor } from "@shared/lib/projectColors";
import type { AppDiagnosticsSnapshot } from "@contracts";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { NotificationsButton } from "./NotificationsTray";

type TopContextBarProps = {
  onOpenSearch: () => void;
};

export const TopContextBar = ({ onOpenSearch }: TopContextBarProps) => {
  const { activeProject, scopeChipLabel } = useShellContext();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isOnline = useConnectivity();
  const [diagnostics, setDiagnostics] = useState<AppDiagnosticsSnapshot | null>(null);
  const [syncPopoverOpen, setSyncPopoverOpen] = useState(false);
  const [isRunningSync, setIsRunningSync] = useState(false);
  const [syncActionError, setSyncActionError] = useState<string | null>(null);
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

  useVisiblePolling(
    async () => {
      if (!window.bukowskiApp) {
        return;
      }

      try {
        const nextDiagnostics = await window.bukowskiApp.getDiagnostics();
        if (isMountedRef.current) {
          setDiagnostics(nextDiagnostics);
        }
      } catch {
        if (isMountedRef.current) {
          setDiagnostics(null);
        }
      }
    },
    { intervalMs: 15_000 },
  );

  const syncState = useMemo(() => {
    if (!diagnostics) {
      return {
        label: t("shell.topBar.syncIdle"),
        className: "sync-control-idle",
        badge: null as number | null,
      };
    }

    if (diagnostics.syncOutboxFailedCount > 0 || diagnostics.lastSyncStatus === "failed") {
      return {
        label:
          diagnostics.syncOutboxFailedCount > 0
            ? t("shell.topBar.syncFailedWithCount", { count: diagnostics.syncOutboxFailedCount })
            : t("shell.topBar.syncFailed"),
        className: "sync-control-failed",
        badge: diagnostics.syncOutboxFailedCount,
      };
    }

    const queuedCount = diagnostics.syncOutboxPendingCount + diagnostics.syncOutboxProcessingCount;

    if (queuedCount > 0) {
      return {
        label: t("shell.topBar.syncing", { count: queuedCount }),
        className: "sync-control-active",
        badge: queuedCount,
      };
    }

    return {
      label: t("shell.topBar.upToDate"),
      className: "sync-control-healthy",
      badge: null as number | null,
    };
  }, [diagnostics, t]);

  const formatSyncDate = (value: string | null | undefined) => {
    if (!value) {
      return t("common.never", { defaultValue: "Nunca" });
    }

    return new Date(value).toLocaleString();
  };

  const handleRunSync = async () => {
    if (!window.bukowskiApp || isRunningSync) {
      return;
    }

    setIsRunningSync(true);
    setSyncActionError(null);

    try {
      const result = await window.bukowskiApp.runLocalSync();
      if (isMountedRef.current) {
        setDiagnostics(result.diagnostics);
      }
    } catch {
      if (isMountedRef.current) {
        setSyncActionError(t("shell.topBar.syncPopover.syncFailed", { defaultValue: "No se pudo sincronizar ahora." }));
      }
    } finally {
      if (isMountedRef.current) {
        setIsRunningSync(false);
      }
    }
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
              setSyncPopoverOpen((current) => !current);
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
                  <span className="sync-popover-kicker">{t("shell.topBar.syncPopover.title", { defaultValue: "Sincronización" })}</span>
                  <strong>{syncState.label}</strong>
                </div>
                <span className={`sync-popover-status ${syncState.className}`} />
              </div>

              <div className="sync-popover-grid">
                <span>{t("shell.topBar.syncPopover.pending", { defaultValue: "Pendientes" })}</span>
                <strong>{diagnostics?.syncOutboxPendingCount ?? 0}</strong>
                <span>{t("shell.topBar.syncPopover.processing", { defaultValue: "Procesando" })}</span>
                <strong>{diagnostics?.syncOutboxProcessingCount ?? 0}</strong>
                <span>{t("shell.topBar.syncPopover.failed", { defaultValue: "Fallidas" })}</span>
                <strong>{diagnostics?.syncOutboxFailedCount ?? 0}</strong>
                <span>{t("shell.topBar.syncPopover.lastRun", { defaultValue: "Última pasada" })}</span>
                <strong>{formatSyncDate(diagnostics?.lastSyncRunAt)}</strong>
              </div>

              {diagnostics?.lastSyncSummary ? <p className="sync-popover-summary">{diagnostics.lastSyncSummary}</p> : null}
              {syncActionError ? <p className="sync-popover-error">{syncActionError}</p> : null}

              <div className="sync-popover-actions">
                <button className="ghost-control" disabled={isRunningSync} onClick={() => void handleRunSync()} type="button">
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
