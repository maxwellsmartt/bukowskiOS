// Values that read as "unfinished" to a non-technical user — raw seed/placeholder
// artifacts and not-set sentinels. Normalized to a calm dash at display time so
// the UI never looks half-built. (The underlying record is untouched.)
const PLACEHOLDER_VALUES = new Set(["placeholder", "unknown", "n/a", "null", "undefined", "—", "-"]);

export const isPlaceholderValue = (value?: string | null): boolean => {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "" || PLACEHOLDER_VALUES.has(normalized);
};

/** Returns the value, or a fallback when it is empty / a placeholder sentinel. */
export const cleanDisplay = (value?: string | null, fallback = "—"): string =>
  isPlaceholderValue(value) ? fallback : (value as string);
