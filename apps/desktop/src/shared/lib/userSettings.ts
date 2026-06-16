/**
 * User settings client — synced, cross-device preferences.
 *
 * Differences vs. `preferences.ts`:
 *   - `preferences.ts` is per-device UI state (panel widths, last route, …).
 *   - `userSettings.ts` is the user's chosen configuration (auto-logout
 *     timeout, future: theme, language, date format, …). Persisted in
 *     Supabase (`public.user_settings.settings` jsonb) so it follows the
 *     user across machines.
 *
 * Design notes:
 *   - In-memory store + localStorage cache keyed by user id so the UI can
 *     render instantly on cold start without waiting for the network.
 *   - Writes are optimistic: the in-memory store is updated first, then
 *     the upsert is fired. On failure the previous value is restored and a
 *     `failure` event is dispatched so callers can surface a toast.
 *   - Subscribers are notified for every successful (or rolled-back) change
 *     so React hooks can re-render naturally.
 *   - Realtime/multi-device live sync is not wired here yet. A second pass
 *     can subscribe to `postgres_changes` on `user_settings` filtered by
 *     the current user id and call `applyRemoteSettings(...)`.
 */

import type { BukowskiSupabaseClient } from "@bukowski/supabase-client";
import type { NativeNotificationPreferences, NotificationCategory } from "@contracts";

export const userSettingKeys = {
  autoLogoutInactivityMinutes: "autoLogoutInactivityMinutes",
  /** BCP-47 language tag — drives `Intl.*` and UI string catalogs. */
  language: "language",
  /**
   * How to render dates.
   *   - "locale": follow the `language` setting (default).
   *   - "iso": 2026-05-11.
   *   - "us":  5/11/2026.
   *   - "eu":  11/05/2026.
   */
  dateFormatMode: "dateFormatMode",
  /** ISO-4217 currency code the user prefers (e.g. "MXN", "USD"). */
  defaultCurrency: "defaultCurrency",
  /** macOS native notification delivery preferences. In-app notifications stay on. */
  nativeNotifications: "nativeNotifications",
  /** Whether chart/graph entrance animations play. Default true. */
  chartAnimations: "chartAnimations",
  /** Cross-device table layouts for user-controlled columns in high-value screens. */
  tablePreferences: "tablePreferences",
  /** Cross-device project timeline ordering and visibility per workspace. */
  projectTimelinePreferences: "projectTimelinePreferences",
  /** Cross-device sort preference for the project list in the app sidebar. */
  projectSidebarSort: "projectSidebarSort",
} as const;

export type UserSettingKey = (typeof userSettingKeys)[keyof typeof userSettingKeys];

/** Allowed values for `dateFormatMode`. Keep in sync with `sanitizeRemoteSettings`. */
export const DATE_FORMAT_MODES = ["locale", "iso", "us", "eu"] as const;
export type DateFormatMode = (typeof DATE_FORMAT_MODES)[number];

/** Languages we ship UI catalogs for. Extend cautiously — every entry implies a JSON catalog. */
export const SUPPORTED_LANGUAGES = ["en", "es"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const PROJECT_SIDEBAR_SORT_VALUES = ["name", "code", "startDate", "createdAt", "updatedAt", "incidents"] as const;
export type ProjectSidebarSortPreference = (typeof PROJECT_SIDEBAR_SORT_VALUES)[number];

export type UserSettingsMap = {
  [userSettingKeys.autoLogoutInactivityMinutes]?: number;
  [userSettingKeys.language]?: SupportedLanguage;
  [userSettingKeys.dateFormatMode]?: DateFormatMode;
  /** Three-letter ISO-4217 code, uppercase. */
  [userSettingKeys.defaultCurrency]?: string;
  [userSettingKeys.nativeNotifications]?: NativeNotificationPreferences;
  [userSettingKeys.chartAnimations]?: boolean;
  [userSettingKeys.tablePreferences]?: TablePreferencesMap;
  [userSettingKeys.projectTimelinePreferences]?: ProjectTimelinePreferencesMap;
  [userSettingKeys.projectSidebarSort]?: ProjectSidebarSortPreference;
};

export type TablePreference = {
  columnWidths?: Record<string, number>;
  visibleColumnKeys?: string[];
};

export type TablePreferencesMap = Record<string, TablePreference>;

export type ProjectTimelineWorkspacePreference = {
  hiddenProjectIds?: string[];
  order?: string[];
};

export type ProjectTimelinePreferencesMap = Record<string, ProjectTimelineWorkspacePreference>;

type Listener = (settings: UserSettingsMap) => void;

const LOCAL_CACHE_PREFIX = "bukowski:user-settings-cache:";

let memoryStore: UserSettingsMap = {};
let activeUserId: string | null = null;
let activeSupabase: BukowskiSupabaseClient | null = null;
const listeners = new Set<Listener>();

const readLocalCache = (userId: string): UserSettingsMap => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(`${LOCAL_CACHE_PREFIX}${userId}`);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as UserSettingsMap) : {};
  } catch {
    return {};
  }
};

const writeLocalCache = (userId: string, settings: UserSettingsMap) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(`${LOCAL_CACHE_PREFIX}${userId}`, JSON.stringify(settings));
  } catch {
    // Cache is best-effort.
  }
};

const notify = () => {
  const snapshot = { ...memoryStore };
  for (const listener of listeners) {
    listener(snapshot);
  }
};

const isSupportedLanguage = (value: unknown): value is SupportedLanguage =>
  typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);

const isDateFormatMode = (value: unknown): value is DateFormatMode =>
  typeof value === "string" && (DATE_FORMAT_MODES as readonly string[]).includes(value);

const isCurrencyCode = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value);

const isProjectSidebarSortPreference = (value: unknown): value is ProjectSidebarSortPreference =>
  typeof value === "string" && (PROJECT_SIDEBAR_SORT_VALUES as readonly string[]).includes(value);

const isSafePreferenceId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9:_-]{1,128}$/.test(value);

const uniqueSafeIds = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const ids = Array.from(new Set(value.filter(isSafePreferenceId)));
  return ids.length ? ids.slice(0, 240) : undefined;
};

const sanitizeTablePreferences = (raw: unknown): TablePreferencesMap | undefined => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const next: TablePreferencesMap = {};
  for (const [tableKey, preference] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-zA-Z0-9:_-]{1,96}$/.test(tableKey) || !preference || typeof preference !== "object" || Array.isArray(preference)) {
      continue;
    }

    const source = preference as Record<string, unknown>;
    const tablePreference: TablePreference = {};
    if (source.columnWidths && typeof source.columnWidths === "object" && !Array.isArray(source.columnWidths)) {
      const widths: Record<string, number> = {};
      for (const [columnKey, width] of Object.entries(source.columnWidths as Record<string, unknown>)) {
        if (/^[a-zA-Z0-9:_-]{1,96}$/.test(columnKey) && typeof width === "number" && Number.isFinite(width) && width >= 40 && width <= 1200) {
          widths[columnKey] = Math.round(width);
        }
      }
      if (Object.keys(widths).length) {
        tablePreference.columnWidths = widths;
      }
    }
    if (Array.isArray(source.visibleColumnKeys)) {
      const visibleColumnKeys = source.visibleColumnKeys.filter(
        (columnKey): columnKey is string => typeof columnKey === "string" && /^[a-zA-Z0-9:_-]{1,96}$/.test(columnKey),
      );
      if (visibleColumnKeys.length) {
        tablePreference.visibleColumnKeys = Array.from(new Set(visibleColumnKeys));
      }
    }
    if (tablePreference.columnWidths || tablePreference.visibleColumnKeys) {
      next[tableKey] = tablePreference;
    }
  }

  return Object.keys(next).length ? next : undefined;
};

const sanitizeProjectTimelinePreferences = (raw: unknown): ProjectTimelinePreferencesMap | undefined => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const next: ProjectTimelinePreferencesMap = {};
  for (const [workspaceId, preference] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSafePreferenceId(workspaceId) || !preference || typeof preference !== "object" || Array.isArray(preference)) {
      continue;
    }

    const source = preference as Record<string, unknown>;
    const workspacePreference: ProjectTimelineWorkspacePreference = {};
    const order = uniqueSafeIds(source.order);
    const hiddenProjectIds = uniqueSafeIds(source.hiddenProjectIds);

    if (order) {
      workspacePreference.order = order;
    }
    if (hiddenProjectIds) {
      workspacePreference.hiddenProjectIds = hiddenProjectIds;
    }
    if (workspacePreference.order || workspacePreference.hiddenProjectIds) {
      next[workspaceId] = workspacePreference;
    }
  }

  return Object.keys(next).length ? next : undefined;
};

export const NOTIFICATION_CATEGORIES = [
  "invoiceInbox",
  "agentsDone",
  "agentsApproval",
  "exchangeRates",
  "projects",
  "todosReminders",
  "appUpdates",
] as const satisfies readonly NotificationCategory[];

export const defaultNativeNotificationPreferences: NativeNotificationPreferences = {
  enabled: true,
  categories: {
    invoiceInbox: true,
    agentsDone: true,
    agentsApproval: true,
    exchangeRates: true,
    projects: true,
    todosReminders: true,
    appUpdates: true,
  },
};

export const mergeNativeNotificationPreferences = (value: unknown): NativeNotificationPreferences => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const rawCategories =
    source.categories && typeof source.categories === "object" && !Array.isArray(source.categories)
      ? (source.categories as Record<string, unknown>)
      : {};

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : defaultNativeNotificationPreferences.enabled,
    categories: NOTIFICATION_CATEGORIES.reduce<NativeNotificationPreferences["categories"]>(
      (next, category) => ({
        ...next,
        [category]:
          typeof rawCategories[category] === "boolean"
            ? rawCategories[category]
            : defaultNativeNotificationPreferences.categories[category],
      }),
      { ...defaultNativeNotificationPreferences.categories },
    ),
  };
};

const sanitizeRemoteSettings = (raw: unknown): UserSettingsMap => {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  // We only keep keys we know about, so a malformed remote value cannot
  // poison the in-memory store.
  const source = raw as Record<string, unknown>;
  const next: UserSettingsMap = {};

  if (typeof source[userSettingKeys.autoLogoutInactivityMinutes] === "number") {
    next[userSettingKeys.autoLogoutInactivityMinutes] = source[
      userSettingKeys.autoLogoutInactivityMinutes
    ] as number;
  }

  if (isSupportedLanguage(source[userSettingKeys.language])) {
    next[userSettingKeys.language] = source[userSettingKeys.language] as SupportedLanguage;
  }

  if (isDateFormatMode(source[userSettingKeys.dateFormatMode])) {
    next[userSettingKeys.dateFormatMode] = source[userSettingKeys.dateFormatMode] as DateFormatMode;
  }

  if (isCurrencyCode(source[userSettingKeys.defaultCurrency])) {
    next[userSettingKeys.defaultCurrency] = source[userSettingKeys.defaultCurrency] as string;
  }

  if (source[userSettingKeys.nativeNotifications] !== undefined) {
    next[userSettingKeys.nativeNotifications] = mergeNativeNotificationPreferences(source[userSettingKeys.nativeNotifications]);
  }

  if (typeof source[userSettingKeys.chartAnimations] === "boolean") {
    next[userSettingKeys.chartAnimations] = source[userSettingKeys.chartAnimations] as boolean;
  }

  const tablePreferences = sanitizeTablePreferences(source[userSettingKeys.tablePreferences]);
  if (tablePreferences) {
    next[userSettingKeys.tablePreferences] = tablePreferences;
  }

  const projectTimelinePreferences = sanitizeProjectTimelinePreferences(source[userSettingKeys.projectTimelinePreferences]);
  if (projectTimelinePreferences) {
    next[userSettingKeys.projectTimelinePreferences] = projectTimelinePreferences;
  }

  if (isProjectSidebarSortPreference(source[userSettingKeys.projectSidebarSort])) {
    next[userSettingKeys.projectSidebarSort] = source[userSettingKeys.projectSidebarSort] as ProjectSidebarSortPreference;
  }

  return next;
};

/**
 * Read the current value of a setting from the in-memory store.
 * Synchronous on purpose so hooks can use it during render.
 */
export const getUserSetting = <K extends UserSettingKey>(key: K): UserSettingsMap[K] => memoryStore[key];

/**
 * Subscribe to changes in the in-memory user settings store. The listener
 * fires whenever any key changes (hydration, writes, rollbacks).
 */
export const subscribeToUserSettings = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Hydrate the in-memory store for the given user. Order:
 *   1) Seed from the local cache so the UI does not flash defaults.
 *   2) Fetch the authoritative row from Supabase.
 *   3) If the remote row is missing/empty but the local cache or the
 *      legacy `localStorage` keys hold a value, do a one-time soft
 *      migration upsert. This means users that configured auto-logout on
 *      a machine before the sync feature shipped will not lose it.
 */
export const hydrateUserSettings = async (
  supabase: BukowskiSupabaseClient | null,
  userId: string,
  legacyLocalValues: Partial<UserSettingsMap> = {},
): Promise<void> => {
  activeUserId = userId;
  activeSupabase = supabase;

  // Step 1: instant local-cache hydration.
  const cached = readLocalCache(userId);
  memoryStore = { ...cached };
  notify();

  if (!supabase) {
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const looseSupabase = supabase as any;
    const { data, error } = await looseSupabase
      .from("user_settings")
      .select("settings")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const remote = sanitizeRemoteSettings(data?.settings);
    const hasRemoteValues = Object.keys(remote).length > 0;

    if (hasRemoteValues) {
      memoryStore = remote;
      writeLocalCache(userId, memoryStore);
      notify();
      return;
    }

    // Step 3: soft migration. Prefer cached values, fall back to legacy
    // localStorage values supplied by the caller.
    const seeded: UserSettingsMap = { ...legacyLocalValues, ...cached };

    if (Object.keys(seeded).length === 0) {
      memoryStore = {};
      writeLocalCache(userId, memoryStore);
      notify();
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upsertError } = await (supabase as any)
      .from("user_settings")
      .upsert({ user_id: userId, settings: seeded }, { onConflict: "user_id" });

    if (upsertError) {
      // Soft migration is best-effort. Keep the local store so the user
      // still sees their value on this device.
      // eslint-disable-next-line no-console
      console.warn("Could not migrate local settings to remote store.", upsertError);
    }

    memoryStore = seeded;
    writeLocalCache(userId, memoryStore);
    notify();
  } catch (error) {
    // Network or RLS failures keep the local cache intact.
    // eslint-disable-next-line no-console
    console.warn("Could not hydrate user settings from Supabase.", error);
  }
};

/**
 * Apply a settings payload that arrived from the server (e.g. via a
 * Supabase Realtime `postgres_changes` event triggered by another
 * device). The remote value is treated as authoritative — local
 * optimistic updates are overwritten. Only sanitized, known keys are
 * accepted, and we no-op when the payload is equivalent to what is
 * already in memory so React subscribers don't re-render needlessly.
 */
export const applyRemoteSettings = (raw: unknown): void => {
  const next = sanitizeRemoteSettings(raw);

  // Shallow equality on the limited key set we care about.
  const keys = new Set<string>([...Object.keys(memoryStore), ...Object.keys(next)]);
  let changed = false;
  for (const key of keys) {
    if ((memoryStore as Record<string, unknown>)[key] !== (next as Record<string, unknown>)[key]) {
      changed = true;
      break;
    }
  }

  if (!changed) {
    return;
  }

  memoryStore = next;
  if (activeUserId) {
    writeLocalCache(activeUserId, memoryStore);
  }
  notify();
};

/** Clear the in-memory store and detach from the current user. */
export const resetUserSettings = () => {
  memoryStore = {};
  activeUserId = null;
  activeSupabase = null;
  notify();
};

/**
 * Set a single user setting. Optimistic: the in-memory store and the
 * local cache update immediately; the network write is best-effort. If
 * Supabase rejects the write, the previous value is restored.
 */
export const setUserSetting = async <K extends UserSettingKey>(
  key: K,
  value: UserSettingsMap[K],
): Promise<void> => {
  const previous = memoryStore[key];
  const nextStore: UserSettingsMap = { ...memoryStore };

  if (value === undefined) {
    delete nextStore[key];
  } else {
    nextStore[key] = value;
  }

  memoryStore = nextStore;
  if (activeUserId) {
    writeLocalCache(activeUserId, memoryStore);
  }
  notify();

  if (!activeSupabase || !activeUserId) {
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (activeSupabase as any)
      .from("user_settings")
      .upsert(
        { user_id: activeUserId, settings: memoryStore },
        { onConflict: "user_id" },
      );

    if (error) {
      throw error;
    }
  } catch (error) {
    // Roll back.
    const rolledBack: UserSettingsMap = { ...memoryStore };
    if (previous === undefined) {
      delete rolledBack[key];
    } else {
      rolledBack[key] = previous;
    }
    memoryStore = rolledBack;
    if (activeUserId) {
      writeLocalCache(activeUserId, memoryStore);
    }
    notify();
    throw error;
  }
};
