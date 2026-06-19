export type CompositePullCursor = {
  timestamp: string;
  id: string | null;
};

export const readCompositePullCursor = (key: string): CompositePullCursor | null => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<CompositePullCursor>;
      if (typeof parsed.timestamp === "string" && parsed.timestamp.length > 0) {
        return { timestamp: parsed.timestamp, id: typeof parsed.id === "string" ? parsed.id : null };
      }
    } catch {
      // Legacy cursors stored only the timestamp. Re-read the timestamp boundary
      // once, then persist a composite cursor after a successful page.
    }
    return { timestamp: raw, id: null };
  } catch {
    return null;
  }
};

export const writeCompositePullCursor = (key: string, cursor: CompositePullCursor | null) => {
  try {
    if (!cursor) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(cursor));
  } catch {
    // Best effort. Re-reading an older boundary is safe because applies are idempotent.
  }
};

export const cursorFromRow = (
  row: Record<string, unknown> | undefined,
  timestampColumn: string,
  idColumn: string,
): CompositePullCursor | null => {
  const timestamp = row?.[timestampColumn];
  const id = row?.[idColumn];
  if (typeof timestamp !== "string" || typeof id !== "string") return null;
  return { timestamp, id };
};

/**
 * Applies stable keyset pagination to a Supabase/PostgREST query. The query must
 * already be ordered by timestamp and stable id in ascending order.
 */
export const applyCompositePullCursor = <T extends { gte: (column: string, value: string) => T; or: (filter: string) => T }>(
  query: T,
  cursor: CompositePullCursor | null,
  timestampColumn: string,
  idColumn: string,
): T => {
  if (!cursor) return query;
  if (!cursor.id) return query.gte(timestampColumn, cursor.timestamp);
  return query.or(
    `${timestampColumn}.gt.${cursor.timestamp},and(${timestampColumn}.eq.${cursor.timestamp},${idColumn}.gt.${cursor.id})`,
  );
};
