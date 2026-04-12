import { Bell, RefreshCcw, Search } from "lucide-react";

import { useShellContext } from "@shared/hooks/useShellContext";

type TopContextBarProps = {
  onOpenSearch: () => void;
};

export const TopContextBar = ({ onOpenSearch }: TopContextBarProps) => {
  const { scopeChipLabel, syncLabel, workspaceName } = useShellContext();

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
        <button aria-label={syncLabel} className="icon-ghost-control sync-control" title={syncLabel} type="button">
          <RefreshCcw size={14} />
        </button>
        <button aria-label="Alerts" className="icon-ghost-control" type="button">
          <Bell size={14} />
        </button>
      </div>
    </div>
  );
};
