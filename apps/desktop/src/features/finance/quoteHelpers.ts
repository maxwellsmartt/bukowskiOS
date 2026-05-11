import type { QuoteStatus, QuoteTaxProfile } from "@contracts";

export const currencySymbol = (code: string): string => {
  const normalized = code.trim().toUpperCase();
  switch (normalized) {
    case "DOP":
      return "RD$";
    case "USD":
      return "US$";
    case "EUR":
      return "€";
    default:
      return normalized + " ";
  }
};

/**
 * Locale-aware currency formatter. Pass the user's language (from
 * `useLocale()`) so decimal/thousands separators match the user's
 * locale. Falls back to `en` when omitted — kept for non-render
 * contexts that don't have access to the hook.
 */
export const formatCurrency = (value: number, currency: string, language: string = "en"): string => {
  const safe = Number.isFinite(value) ? value : 0;
  const normalizedCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  try {
    return new Intl.NumberFormat(language, {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe);
  } catch {
    // Defensive fallback if `currency` is unknown to Intl.
    const formatted = safe.toLocaleString(language, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${currencySymbol(currency)}${formatted}`;
  }
};

export const statusLabel = (status: QuoteStatus): string => {
  switch (status) {
    case "draft":
      return "Draft";
    case "sent":
      return "Sent";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "expired":
      return "Expired";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
};

export const statusTone = (
  status: QuoteStatus,
): "neutral" | "info" | "warning" | "success" | "critical" => {
  switch (status) {
    case "draft":
      return "neutral";
    case "sent":
      return "info";
    case "approved":
      return "success";
    case "rejected":
      return "critical";
    case "expired":
      return "warning";
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
};

export const taxProfileLabel = (profile: QuoteTaxProfile): string => {
  switch (profile) {
    case "film_law_exempt":
      return "Film Law (exempt)";
    case "standard_itbis":
      return "Standard ITBIS";
    case "mixed":
      return "Mixed";
    case "manual":
      return "Manual";
    default:
      return profile;
  }
};

export const validityCopy = (validityDays: number, validUntil: string): string => {
  return `Valid for ${validityDays} day${validityDays === 1 ? "" : "s"} (until ${validUntil}).`;
};

/** Best-effort short id for newly drafted commands. */
export const newCommandId = (prefix: string): string => {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
};
