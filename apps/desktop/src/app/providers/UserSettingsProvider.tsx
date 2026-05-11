import { useEffect, type ReactNode } from "react";

import i18n from "../../i18n";
import { readNumberPreference, uiPreferenceKeys } from "@shared/lib/preferences";
import {
  applyRemoteSettings,
  getUserSetting,
  hydrateUserSettings,
  resetUserSettings,
  subscribeToUserSettings,
  SUPPORTED_LANGUAGES,
  userSettingKeys,
  type SupportedLanguage,
  type UserSettingsMap,
} from "@shared/lib/userSettings";

import { useSession } from "./SessionProvider";

const DEFAULT_LANGUAGE: SupportedLanguage = "en";

const detectBrowserLanguage = (): SupportedLanguage => {
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE;
  const candidates = [navigator.language, ...(navigator.languages ?? [])];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const short = candidate.slice(0, 2).toLowerCase();
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(short)) {
      return short as SupportedLanguage;
    }
  }
  return DEFAULT_LANGUAGE;
};

const applyI18nLanguage = (language: SupportedLanguage | undefined) => {
  const resolved = language ?? detectBrowserLanguage();
  if (i18n.language !== resolved) {
    void i18n.changeLanguage(resolved);
  }
};

/**
 * Hydrates the cross-device user-settings store as soon as a Supabase
 * session is available, and subscribes to realtime changes so that an
 * update made on another device is reflected here without needing to
 * sign out / sign in.
 *
 * Placed high in the provider tree so any feature can read settings
 * synchronously via `useUserSetting` after first render.
 */
export const UserSettingsProvider = ({ children }: { children: ReactNode }) => {
  const { status, user, supabase } = useSession();

  // Keep i18next in sync with whatever the store currently has. Runs
  // independently of session lifecycle so the browser-detected fallback
  // also applies pre-login.
  useEffect(() => {
    applyI18nLanguage(getUserSetting(userSettingKeys.language));
    const unsubscribe = subscribeToUserSettings((next) => {
      applyI18nLanguage(next[userSettingKeys.language]);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      resetUserSettings();
      return;
    }

    if (status !== "authenticated" || !user) {
      return;
    }

    // Collect legacy localStorage values that may need to be migrated.
    const legacy: Partial<UserSettingsMap> = {};
    const legacyAutoLogout = readNumberPreference(
      uiPreferenceKeys.autoLogoutInactivityMinutes,
      Number.NaN,
    );
    if (Number.isFinite(legacyAutoLogout)) {
      legacy[userSettingKeys.autoLogoutInactivityMinutes] = legacyAutoLogout;
    }

    let cancelled = false;
    void hydrateUserSettings(supabase ?? null, user.id, legacy);

    if (!supabase) {
      return () => {
        cancelled = true;
      };
    }

    // Subscribe to remote changes. Any UPDATE/INSERT/DELETE on the
    // current user's row is mirrored into the in-memory store, which
    // re-renders every component using `useUserSetting`.
    const channel = supabase
      .channel(`user-settings:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_settings",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (cancelled) {
            return;
          }
          if (payload.eventType === "DELETE") {
            applyRemoteSettings({});
            return;
          }
          const nextRow = payload.new as { settings?: unknown } | null;
          applyRemoteSettings(nextRow?.settings ?? {});
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void Promise.resolve(supabase.removeChannel(channel));
    };
  }, [status, user, supabase]);

  return <>{children}</>;
};
