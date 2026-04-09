import { Bell, RefreshCcw, Search } from "lucide-react";

import { useShellContext } from "@shared/hooks/useShellContext";

export const TopContextBar = () => {
  const { projectScope, syncLabel, workspaceName } = useShellContext();

  return (
    <div className="top-context-bar">
      <div className="top-context-group top-context-group-primary">
        <div className="context-meta-stack">
          <span className="context-meta-label">Workspace</span>
          <span className="context-meta-value">{workspaceName}</span>
        </div>
      </div>

      <div className="top-context-group top-context-group-end">
        <button className="ghost-control search-control" type="button">
          <Search size={13} />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="context-chip">
          <span>{projectScope}</span>
        </div>
        <button className="ghost-control sync-control" type="button">
          <RefreshCcw size={13} />
          <span>{syncLabel}</span>
        </button>
        <button className="icon-control" type="button" aria-label="Alerts">
          <Bell size={14} />
        </button>
      </div>
    </div>
  );
};
