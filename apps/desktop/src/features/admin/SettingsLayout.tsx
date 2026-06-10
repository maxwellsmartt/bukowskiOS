import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

export type SettingsSectionId =
  | "general"
  | "workspace"
  | "team"
  | "data"
  | "sync"
  | "advanced";

type SettingsNavEntry = {
  id: SettingsSectionId;
  to: string;
};

/**
 * Static structural metadata for the settings nav. Labels are not stored
 * here — they live in the i18n catalogs and are resolved by
 * `useSettingsNavEntries()` at render time so language changes reflect
 * immediately.
 */
export const settingsNavEntries: SettingsNavEntry[] = [
  { id: "general", to: "/settings?section=general" },
  { id: "workspace", to: "/settings/workspace" },
  { id: "team", to: "/settings?section=team" },
  { id: "sync", to: "/settings/sync" },
  { id: "data", to: "/settings?section=data" },
  { id: "advanced", to: "/settings?section=advanced" },
];

/** Resolves localized label + description for a nav id. */
export const useSettingsNavLabels = () => {
  const { t } = useTranslation();
  return (id: SettingsSectionId) => ({
    label: t(`settings.nav.${id}.label`),
    description: t(`settings.nav.${id}.description`),
  });
};

const resolveActiveSection = (pathname: string, search: string): SettingsSectionId => {
  if (pathname === "/settings/workspace") return "workspace";
  if (pathname === "/settings/sync") return "sync";
  // Legacy deep links to the old account page land on Mi cuenta.
  if (pathname === "/settings/account") return "general";

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
  const { t } = useTranslation();
  const labelsFor = useSettingsNavLabels();
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
        aria-label={t("settings.nav.general.label")}
        className="settings-section-nav"
        onKeyDown={handleKeyDown}
        ref={navRef}
      >
        {settingsNavEntries.map((entry) => {
          const labels = labelsFor(entry.id);
          return (
            <button
              key={entry.id}
              className={`settings-section-tab${activeId === entry.id ? " is-active" : ""}`}
              onClick={() => navigate(entry.to)}
              type="button"
            >
              <span>{labels.label}</span>
              <small>{labels.description}</small>
            </button>
          );
        })}
      </nav>

      <div className="settings-content-panel">{children}</div>
    </div>
  );
};

export const useActiveSettingsSection = (): SettingsSectionId => {
  const location = useLocation();
  return resolveActiveSection(location.pathname, location.search);
};
