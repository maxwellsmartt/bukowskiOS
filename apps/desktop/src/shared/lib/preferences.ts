export const uiPreferenceKeys = {
  compareTrayState: "compare-tray-state",
  activePackingSlipId: "active-packing-slip-id",
  activeProjectId: "active-project-id",
  lastGlobalRoutePath: "last-global-route-path",
  lastProjectRoutePath: "last-project-route-path",
  lastProjectRouteSection: "last-project-route-section",
  lastRoutePath: "last-route-path",
  assistantChatSidebarCollapsed: "assistant-chat-sidebar-collapsed",
  assistantChatThreadSourceFilter: "assistant-chat-thread-source-filter",
  overviewTimelineAnchorDate: "overview-timeline-anchor-date",
  overviewTimelineExpandedProjects: "overview-timeline-expanded-projects",
  overviewTimelineGridDensity: "overview-timeline-grid-density",
  overviewTimelineRange: "overview-timeline-range",
  overviewTimelineScale: "overview-timeline-scale",
  recentEntityKeys: "recent-entity-keys",
  shellSidebarWidth: "shell-sidebar-width",
  assetOperationSideRailWidth: "asset-operation-side-rail-width",
  catalogSideRailWidth: "catalog-side-rail-width",
  projectsSideRailWidth: "projects-side-rail-width",
  splitSideRailWidth: "split-side-rail-width",
  shellProjectsShowArchived: "shell-projects-show-archived",
  shellProjectsSort: "shell-projects-sort",
  activeWorkspaceId: "active-workspace-id",
  onboardingTourCompletedWorkspaces: "onboarding-tour-completed-workspaces",
  autoLogoutInactivityMinutes: "auto-logout-inactivity-minutes",
} as const;

const buildPreferenceKey = (key: string) => `bukowski:${key}`;

const readRawPreference = (key: string) => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(buildPreferenceKey(key));
  } catch {
    return null;
  }
};

export const readStringPreference = (key: string, fallback: string | null = null) => {
  const value = readRawPreference(key);
  return value ?? fallback;
};

export const readNumberPreference = (key: string, fallback: number) => {
  const rawValue = readRawPreference(key);

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseFloat(rawValue);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
};

export const readJsonPreference = <T>(key: string, fallback: T) => {
  const rawValue = readRawPreference(key);

  if (!rawValue) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
};

export const PREFERENCE_CHANGE_EVENT = "bukowski:preference-changed";

export type PreferenceChangeDetail = {
  key: string;
  value: string | null;
};

const dispatchPreferenceChange = (key: string, value: string | null) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.dispatchEvent(
      new CustomEvent<PreferenceChangeDetail>(PREFERENCE_CHANGE_EVENT, {
        detail: { key, value },
      }),
    );
  } catch {
    // Some environments (older WebViews) may not support CustomEvent — ignore.
  }
};

export const writePreference = (key: string, value: string | null) => {
  if (typeof window === "undefined") {
    return;
  }

  const storageKey = buildPreferenceKey(key);

  try {
    if (value === null) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, value);
    }
  } catch {
    // Keep UI resilient even if localStorage is unavailable.
  }

  dispatchPreferenceChange(key, value);
};

/**
 * Subscribe to preference changes. The handler fires for in-tab updates
 * (via `writePreference`) and for cross-tab updates (via the native
 * `storage` event). Pass a specific `key` to only react to that preference.
 */
export const subscribeToPreferenceChange = (
  key: string,
  handler: (detail: PreferenceChangeDetail) => void,
): (() => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const storageKey = buildPreferenceKey(key);

  const onCustom = (event: Event) => {
    const detail = (event as CustomEvent<PreferenceChangeDetail>).detail;
    if (detail && detail.key === key) {
      handler(detail);
    }
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey) {
      handler({ key, value: event.newValue });
    }
  };

  window.addEventListener(PREFERENCE_CHANGE_EVENT, onCustom);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(PREFERENCE_CHANGE_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
};

export const writeJsonPreference = (key: string, value: unknown) => {
  writePreference(key, JSON.stringify(value));
};
