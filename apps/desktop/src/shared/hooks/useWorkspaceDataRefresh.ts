import { useEffect, useState } from "react";

export const workspaceDataChangedEvent = "bukowski:workspace-data-changed";

export type WorkspaceDataChangedDetail = {
  source?: "assistant-chat" | "assistant-tool" | "sync" | "manual";
  entities?: string[];
};

export const notifyWorkspaceDataChanged = (detail: WorkspaceDataChangedDetail = {}) => {
  window.dispatchEvent(new CustomEvent<WorkspaceDataChangedDetail>(workspaceDataChangedEvent, { detail }));
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
