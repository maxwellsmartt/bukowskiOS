import { useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";

export type SettingsSectionId =
  | "general"
  | "workspace"
  | "team"
  | "data"
  | "sync"
  | "advanced";

type SettingsNavEntry = {
  id: SettingsSectionId;
  label: string;
  description: string;
  to: string;
};

export const settingsNavEntries: SettingsNavEntry[] = [
  { id: "general", label: "General", description: "Workspace status", to: "/settings?section=general" },
  { id: "workspace", label: "Workspace", description: "Identity, members & invites", to: "/settings/workspace" },
  { id: "team", label: "Team", description: "Users and roles", to: "/settings?section=team" },
  { id: "data", label: "Data", description: "Backups and integrity", to: "/settings?section=data" },
  { id: "sync", label: "Sync activity", description: "Outbox & remote status", to: "/settings/sync" },
  { id: "advanced", label: "Advanced", description: "Support tools", to: "/settings?section=advanced" },
];

const resolveActiveSection = (pathname: string, search: string): SettingsSectionId => {
  if (pathname === "/settings/workspace") return "workspace";
  if (pathname === "/settings/sync") return "sync";

  const params = new URLSearchParams(search);
  const fromQuery = params.get("section") as SettingsSectionId | null;
  if (fromQuery && settingsNavEntries.some((entry) => entry.id === fromQuery)) {
    return fromQuery;
  }
  return "general";
};

type SettingsLayoutProps = {
  children: ReactNode;
};

export const SettingsLayout = ({ children }: SettingsLayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const activeId = resolveActiveSection(location.pathname, location.search);

  return (
    <div className="settings-shell-layout">
      <nav aria-label="Settings sections" className="settings-section-nav">
        {settingsNavEntries.map((entry) => (
          <button
            key={entry.id}
            className={`settings-section-tab${activeId === entry.id ? " is-active" : ""}`}
            onClick={() => navigate(entry.to)}
            type="button"
          >
            <span>{entry.label}</span>
            <small>{entry.description}</small>
          </button>
        ))}
      </nav>

      <div className="settings-content-panel">{children}</div>
    </div>
  );
};

export const useActiveSettingsSection = (): SettingsSectionId => {
  const location = useLocation();
  return resolveActiveSection(location.pathname, location.search);
};
