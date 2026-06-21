export const MAX_ACCEPTED_CLIENT_CLOCK_SKEW_MS = 5 * 60 * 1000;

const parseTimestamp = (value: string): number | null => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Local timestamps are optimistic while an outbox row is pending. Once the
 * outbox is clear, Postgres is authoritative. A workstation timestamp far in
 * the future must therefore never suppress a valid server row indefinitely.
 */
export const isLocalTimestampAtLeastAsNew = (
  localTimestamp: string,
  remoteTimestamp: string,
  nowMs = Date.now(),
): boolean => {
  const localMs = parseTimestamp(localTimestamp);
  const remoteMs = parseTimestamp(remoteTimestamp);
  if (localMs === null || remoteMs === null) return false;
  if (localMs > nowMs + MAX_ACCEPTED_CLIENT_CLOCK_SKEW_MS) return false;
  return localMs >= remoteMs;
};

export const isLocalTimestampStrictlyNewer = (
  localTimestamp: string,
  remoteTimestamp: string,
  nowMs = Date.now(),
): boolean => {
  const localMs = parseTimestamp(localTimestamp);
  const remoteMs = parseTimestamp(remoteTimestamp);
  if (localMs === null || remoteMs === null) return false;
  if (localMs > nowMs + MAX_ACCEPTED_CLIENT_CLOCK_SKEW_MS) return false;
  return localMs > remoteMs;
};
