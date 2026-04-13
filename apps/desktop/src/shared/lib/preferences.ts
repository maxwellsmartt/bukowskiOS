export const uiPreferenceKeys = {
  compareTrayState: "compare-tray-state",
  activePackingSlipId: "active-packing-slip-id",
  activeProjectId: "active-project-id",
  lastGlobalRoutePath: "last-global-route-path",
  lastProjectRoutePath: "last-project-route-path",
  lastProjectRouteSection: "last-project-route-section",
  lastRoutePath: "last-route-path",
  overviewTimelineAnchorDate: "overview-timeline-anchor-date",
  overviewTimelineExpandedProjects: "overview-timeline-expanded-projects",
  overviewTimelineGridDensity: "overview-timeline-grid-density",
  overviewTimelineRange: "overview-timeline-range",
  overviewTimelineScale: "overview-timeline-scale",
  recentEntityKeys: "recent-entity-keys",
  shellSidebarWidth: "shell-sidebar-width",
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

export const writePreference = (key: string, value: string | null) => {
  if (typeof window === "undefined") {
    return;
  }

  const storageKey = buildPreferenceKey(key);

  try {
    if (value === null) {
      window.localStorage.removeItem(storageKey);
      return;
    }

    window.localStorage.setItem(storageKey, value);
  } catch {
    // Keep UI resilient even if localStorage is unavailable.
  }
};

export const writeJsonPreference = (key: string, value: unknown) => {
  writePreference(key, JSON.stringify(value));
};
