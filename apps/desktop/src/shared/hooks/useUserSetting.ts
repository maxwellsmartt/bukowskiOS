import { useCallback, useEffect, useState } from "react";

import {
  getUserSetting,
  setUserSetting,
  subscribeToUserSettings,
  type UserSettingKey,
  type UserSettingsMap,
} from "@shared/lib/userSettings";

/**
 * React hook for a single cross-device user setting.
 *
 * Reads stay synchronous (the in-memory store is hydrated by
 * `UserSettingsProvider` on session start). Writes are optimistic; the
 * returned setter resolves once the Supabase upsert succeeds, and rejects
 * (after rolling back) if it fails.
 */
export const useUserSetting = <K extends UserSettingKey>(
  key: K,
): readonly [UserSettingsMap[K], (value: UserSettingsMap[K]) => Promise<void>] => {
  const [value, setValue] = useState<UserSettingsMap[K]>(() => getUserSetting(key));

  useEffect(() => {
    const unsubscribe = subscribeToUserSettings((nextSettings) => {
      setValue(nextSettings[key]);
    });
    // Re-read in case the store was hydrated between mount and subscribe.
    setValue(getUserSetting(key));
    return unsubscribe;
  }, [key]);

  const update = useCallback(
    (next: UserSettingsMap[K]) => setUserSetting(key, next),
    [key],
  );

  return [value, update] as const;
};
