import { CloudCog, Search, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { HelpMenu } from "@features/onboarding/HelpMenu";
import { useConnectivity } from "@shared/hooks/useConnectivity";
import { useShellContext } from "@shared/hooks/useShellContext";
import { useVisiblePolling } from "@shared/hooks/useVisiblePolling";
import type { AppDiagnosticsSnapshot } from "@contracts";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { NotificationsButton } from "./NotificationsTray";

type TopContextBarProps = {
  onOpenSearch: () => void;
};

export const TopContextBar = ({ onOpenSearch }: TopContextBarProps) => {
  const { scopeChipLabel } = useShellContext();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isOnline = useConnectivity();
  const [diagnostics, setDiagnostics] = useState<AppDiagnosticsSnapshot | null>(null);
  const isMountedRef = useRef(true);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

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

  return (
    <div className="top-context-bar">
      <div className="top-context-group top-context-group-primary">
        <WorkspaceSwitcher />
      </div>

      {scopeChipLabel ? (
        <div className="top-context-group top-context-group-center">
          <div className="context-chip context-chip-project">
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
        <button
          aria-label={syncState.label}
          className={`icon-ghost-control sync-control ${syncState.className}`}
          data-tooltip={syncState.label}
          onClick={() => navigate("/settings/sync")}
          type="button"
        >
          <CloudCog size={17} />
          {syncState.badge ? <span className="sync-control-badge">{syncState.badge}</span> : null}
        </button>
      </div>
    </div>
  );
};
