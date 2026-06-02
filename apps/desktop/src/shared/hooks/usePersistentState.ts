import { useEffect, useRef, useState } from "react";

/**
 * Like useState, but the value is mirrored to localStorage under `key` so the
 * user's view choice (period filter, active tab, …) survives a reload/restart.
 *
 * - Reads the persisted value lazily on first mount (falls back to
 *   `defaultValue` when absent or unparseable).
 * - Writes on every change.
 * - When `key` changes (e.g. workspace switch) the value re-hydrates from the
 *   new key's storage, so per-workspace choices don't bleed across workspaces.
 */
export const usePersistentState = <T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] => {
  const read = (storageKey: string): T => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw === null ? defaultValue : (JSON.parse(raw) as T);
    } catch {
      return defaultValue;
    }
  };

  const [value, setValue] = useState<T>(() => read(key));

  // Re-hydrate when the key changes (skip the very first run — state is
  // already seeded from `key` above).
  const previousKey = useRef(key);
  useEffect(() => {
    if (previousKey.current !== key) {
      previousKey.current = key;
      setValue(read(key));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full / unavailable — non-fatal, the choice just won't persist */
    }
  }, [key, value]);

  return [value, setValue];
};
