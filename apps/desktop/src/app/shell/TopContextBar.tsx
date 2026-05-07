import { RefreshCcw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { HelpMenu } from "@features/onboarding/HelpMenu";
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
        label: "Sync",
        className: "sync-control-idle",
        badge: null as number | null,
      };
    }

    if (diagnostics.syncOutboxFailedCount > 0 || diagnostics.lastSyncStatus === "failed") {
      return {
        label: diagnostics.syncOutboxFailedCount > 0 ? `Sync needs attention · ${diagnostics.syncOutboxFailedCount} failed` : "Sync needs attention",
        className: "sync-control-failed",
        badge: diagnostics.syncOutboxFailedCount,
      };
    }

    const queuedCount = diagnostics.syncOutboxPendingCount + diagnostics.syncOutboxProcessingCount;

    if (queuedCount > 0) {
      return {
        label: `Syncing · ${queuedCount} queued`,
        className: "sync-control-active",
        badge: queuedCount,
      };
    }

    return {
      label: "Up to date",
      className: "sync-control-healthy",
      badge: null as number | null,
    };
  }, [diagnostics]);

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
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <NotificationsButton />
        <HelpMenu />
        <button
          aria-label={syncState.label}
          className={`icon-ghost-control sync-control ${syncState.className}`}
          data-tooltip={syncState.label}
          onClick={() => navigate("/settings/sync")}
          type="button"
        >
          <RefreshCcw size={14} />
          {syncState.badge ? <span className="sync-control-badge">{syncState.badge}</span> : null}
        </button>
      </div>
    </div>
  );
};
