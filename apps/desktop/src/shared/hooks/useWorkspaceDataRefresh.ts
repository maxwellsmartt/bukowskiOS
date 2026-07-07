import { useEffect, useState } from "react";

export const workspaceDataChangedEvent = "bukowski:workspace-data-changed";
const syncRefreshCoalesceMs = 1_200;

export type WorkspaceDataChangedDetail = {
  source?: "assistant-chat" | "assistant-tool" | "sync" | "manual";
  entities?: string[];
};

type WorkspaceDataRefreshFilter = {
  entities?: string[];
  ignoreSources?: WorkspaceDataChangedDetail["source"][];
};

export const notifyWorkspaceDataChanged = (detail: WorkspaceDataChangedDetail = {}) => {
  window.dispatchEvent(new CustomEvent<WorkspaceDataChangedDetail>(workspaceDataChangedEvent, { detail }));
};

/**
 * Signal that the background pull hooks should fetch remote changes *now*,
 * instead of waiting for their next polling tick. Dispatched by the realtime
 * subscriber whenever Supabase reports a change for the active workspace, so
 * data lands on every machine within a moment instead of up to a poll interval.
 * The pulls are cursor-based and idempotent, so an extra trigger is always safe.
 */
export const immediatePullEvent = "bukowski:request-immediate-pull";

export const requestImmediatePull = () => {
  window.dispatchEvent(new Event(immediatePullEvent));
};

export const useWorkspaceDataRefreshVersion = (filter: WorkspaceDataRefreshFilter = {}) => {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let syncRefreshTimer: number | null = null;
    let syncRefreshQueued = false;

    const bumpVersion = () => setVersion((current) => current + 1);

    const handleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceDataChangedDetail>).detail ?? {};
      if (filter.ignoreSources?.includes(detail.source)) {
        return;
      }

      if (filter.entities?.length && detail.entities?.length) {
        const matchesEntity = detail.entities.some((entity) => filter.entities?.includes(entity));
        if (!matchesEntity) {
          return;
        }
      }

      if (detail.source === "sync") {
        syncRefreshQueued = true;
        if (syncRefreshTimer != null) {
          return;
        }

        syncRefreshTimer = window.setTimeout(() => {
          syncRefreshTimer = null;
          if (!syncRefreshQueued) {
            return;
          }
          syncRefreshQueued = false;
          bumpVersion();
        }, syncRefreshCoalesceMs);
        return;
      }

      bumpVersion();
    };

    window.addEventListener(workspaceDataChangedEvent, handleRefresh);
    return () => {
      if (syncRefreshTimer != null) {
        window.clearTimeout(syncRefreshTimer);
      }
      window.removeEventListener(workspaceDataChangedEvent, handleRefresh);
    };
  }, [filter.entities?.join("|"), filter.ignoreSources?.join("|")]);

  return version;
};
