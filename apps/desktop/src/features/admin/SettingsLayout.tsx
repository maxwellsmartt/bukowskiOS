import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export type SettingsSectionId =
  | "general"
  | "account"
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
  { id: "general", label: "General", description: "Profile & preferences", to: "/settings?section=general" },
  { id: "workspace", label: "Workspace", description: "Company setup", to: "/settings/workspace" },
  { id: "team", label: "Team", description: "Users & access", to: "/settings?section=team" },
  { id: "data", label: "Data", description: "Backups & exports", to: "/settings?section=data" },
  { id: "sync", label: "Sync", description: "Cloud status", to: "/settings/sync" },
  { id: "advanced", label: "Advanced", description: "Support tools", to: "/settings?section=advanced" },
];

const resolveActiveSection = (pathname: string, search: string): SettingsSectionId => {
  if (pathname === "/settings/workspace") return "workspace";
  if (pathname === "/settings/sync") return "sync";
  if (pathname === "/settings/account") return "account";

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
  const navRef = useRef<HTMLDivElement | null>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const buttons = navRef.current?.querySelectorAll<HTMLButtonElement>("button.settings-section-tab");
    if (!buttons || buttons.length === 0) return;

    const current = document.activeElement as HTMLElement | null;
    const list = Array.from(buttons);
    const index = list.findIndex((btn) => btn === current);
    const start = index === -1 ? list.findIndex((btn) => btn.classList.contains("is-active")) : index;
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (start + delta + list.length) % list.length;
    list[nextIndex]?.focus();
  };

  return (
    <div className="settings-shell-layout">
      <nav
        aria-label="Settings sections"
        className="settings-section-nav"
        onKeyDown={handleKeyDown}
        ref={navRef}
      >
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
