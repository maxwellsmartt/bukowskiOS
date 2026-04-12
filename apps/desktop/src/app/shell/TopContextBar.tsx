import { Bell, RefreshCcw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useShellContext } from "@shared/hooks/useShellContext";
import { useVisiblePolling } from "@shared/hooks/useVisiblePolling";
import type { AppDiagnosticsSnapshot } from "@contracts";

type TopContextBarProps = {
  onOpenSearch: () => void;
};

export const TopContextBar = ({ onOpenSearch }: TopContextBarProps) => {
  const { scopeChipLabel, syncLabel, workspaceName } = useShellContext();
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
        label: syncLabel,
        className: "sync-control-idle",
        badge: null as number | null,
      };
    }

    if (diagnostics.syncOutboxFailedCount > 0 || diagnostics.lastSyncStatus === "failed") {
      return {
        label: `Local sync needs attention · ${diagnostics.syncOutboxFailedCount} failed`,
        className: "sync-control-failed",
        badge: diagnostics.syncOutboxFailedCount,
      };
    }

    const queuedCount = diagnostics.syncOutboxPendingCount + diagnostics.syncOutboxProcessingCount;

    if (queuedCount > 0) {
      return {
        label: `Local sync queue active · ${queuedCount} queued`,
        className: "sync-control-active",
        badge: queuedCount,
      };
    }

    return {
      label: `${syncLabel} · queue healthy`,
      className: "sync-control-healthy",
      badge: null as number | null,
    };
  }, [diagnostics, syncLabel]);

  return (
    <div className="top-context-bar">
      <div className="top-context-group top-context-group-primary">
        <div className="context-meta-stack">
          <span className="context-meta-label">Workspace</span>
          <span className="context-meta-value">{workspaceName}</span>
        </div>
      </div>

      <div className="top-context-group top-context-group-end">
        <button className="ghost-control search-control" onClick={onOpenSearch} type="button">
          <Search size={13} />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        {scopeChipLabel ? (
          <div className="context-chip">
            <span>{scopeChipLabel}</span>
          </div>
        ) : null}
        <button
          aria-label={syncState.label}
          className={`icon-ghost-control sync-control ${syncState.className}`}
          onClick={() => navigate("/settings/sync")}
          title={syncState.label}
          type="button"
        >
          <RefreshCcw size={14} />
          {syncState.badge ? <span className="sync-control-badge">{syncState.badge}</span> : null}
        </button>
        <button aria-label="Alerts" className="icon-ghost-control" type="button">
          <Bell size={14} />
        </button>
      </div>
    </div>
  );
};
