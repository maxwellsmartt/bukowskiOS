import { Bell, Command, RefreshCcw, Search } from "lucide-react";

import { useShellContext } from "@shared/hooks/useShellContext";

type TopContextBarProps = {
  domainLabel: string;
};

export const TopContextBar = ({ domainLabel }: TopContextBarProps) => {
  const { appInfo, projectScope, syncLabel, workspaceName } = useShellContext();

  return (
    <div className="top-context-bar">
      <div className="top-context-group">
        <div className="context-pill">
          <span className="context-pill-label">Workspace</span>
          <span>{workspaceName}</span>
        </div>
        <div className="context-pill">
          <span className="context-pill-label">Scope</span>
          <span>{projectScope}</span>
        </div>
        <div className="context-pill">
          <span className="context-pill-label">Domain</span>
          <span>{domainLabel}</span>
        </div>
      </div>

      <div className="top-context-group top-context-group-end">
        <button className="ghost-control" type="button">
          <Search size={14} />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <button className="ghost-control" type="button">
          <Command size={14} />
          <span>Quick Action</span>
        </button>
        <button className="ghost-control" type="button">
          <RefreshCcw size={14} />
          <span>{syncLabel}</span>
        </button>
        <button className="icon-control" type="button" aria-label="Alerts">
          <Bell size={14} />
        </button>
        <div className="context-pill subtle-pill">
          <span className="context-pill-label">Shell</span>
          <span>{appInfo?.shellVersion ?? "preview"}</span>
        </div>
      </div>
    </div>
  );
};
