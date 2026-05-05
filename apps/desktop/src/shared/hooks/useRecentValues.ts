import { useCallback, useEffect, useState } from "react";

const STORAGE_PREFIX = "bukowski:recent:";
const DEFAULT_LIMIT = 12;

const readList = (key: string): string[] => {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  } catch {
    return [];
  }
};

const writeList = (key: string, values: string[]) => {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(values));
  } catch {
    /* storage full / private mode — ignore */
  }
};

/**
 * Per-workspace, per-field recall of values the user has typed before.
 * Backed by localStorage so suggestions persist across sessions on the same
 * device. The hook returns:
 *   - `values`: most-recent first, capped at `limit`.
 *   - `remember(value)`: dedupes and prepends a fresh value (call on save/blur).
 *   - `forget(value)`: removes a single value (e.g. "no longer use this client").
 */
export const useRecentValues = (
  scopeKey: string,
  options: { limit?: number } = {},
) => {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const [values, setValues] = useState<string[]>(() => readList(scopeKey));

  useEffect(() => {
    setValues(readList(scopeKey));
  }, [scopeKey]);

  const remember = useCallback(
    (value: string | null | undefined) => {
      const trimmed = value?.trim();
      if (!trimmed) return;
      setValues((prev) => {
        const next = [trimmed, ...prev.filter((existing) => existing !== trimmed)].slice(0, limit);
        writeList(scopeKey, next);
        return next;
      });
    },
    [scopeKey, limit],
  );

  const forget = useCallback(
    (value: string) => {
      setValues((prev) => {
        const next = prev.filter((existing) => existing !== value);
        writeList(scopeKey, next);
        return next;
      });
    },
    [scopeKey],
  );

  return { values, remember, forget };
};
