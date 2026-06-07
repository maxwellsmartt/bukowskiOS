import { useEffect, useState } from "react";

export const workspaceDataChangedEvent = "bukowski:workspace-data-changed";

export type WorkspaceDataChangedDetail = {
  source?: "assistant-chat" | "assistant-tool" | "sync" | "manual";
  entities?: string[];
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

export const useWorkspaceDataRefreshVersion = () => {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handleRefresh = () => {
      setVersion((current) => current + 1);
    };

    window.addEventListener(workspaceDataChangedEvent, handleRefresh);
    return () => {
      window.removeEventListener(workspaceDataChangedEvent, handleRefresh);
    };
  }, []);

  return version;
};
