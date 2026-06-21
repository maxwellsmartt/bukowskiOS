import type { AppSyncPullCursorRow } from "@contracts";

export const syncCursorStaleAfterMs = 3 * 60 * 1_000;

export const parseSyncTimestamp = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const isSyncCursorStale = (
  cursor: Pick<AppSyncPullCursorRow, "updatedAt">,
  now = Date.now(),
  staleAfterMs = syncCursorStaleAfterMs,
) => {
  const updatedAt = parseSyncTimestamp(cursor.updatedAt);
  return updatedAt === null || now - updatedAt > staleAfterMs;
};
