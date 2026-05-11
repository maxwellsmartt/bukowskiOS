/**
 * Locale-aware formatters.
 *
 * All UI formatting (dates, numbers, money) should go through this
 * module so a user-level change to language / date format / default
 * currency reformats the whole app on the next render.
 *
 * `Intl.*Format` constructors are expensive — we memoize one instance
 * per unique combination of locale + options.
 */

import type { DateFormatMode } from "./userSettings";

export type LocaleContext = {
  /** BCP-47 tag, e.g. "es", "en-US". */
  language: string;
  dateFormatMode: DateFormatMode;
  /** ISO-4217 currency, e.g. "MXN". */
  currency: string;
};

// --- caches --------------------------------------------------------------

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();

const getDateFormatter = (locale: string, options: Intl.DateTimeFormatOptions) => {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormatters.set(key, formatter);
  }
  return formatter;
};

const getNumberFormatter = (locale: string, options: Intl.NumberFormatOptions) => {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatters.set(key, formatter);
  }
  return formatter;
};

// --- date resolution -----------------------------------------------------

/**
 * Map `dateFormatMode` to the effective BCP-47 locale used for date
 * formatting. The user's language is kept for the rest of the app, but
 * date rendering can override it. We use a well-known locale per mode:
 *   - "iso": Swedish, whose default short date is `2026-05-11`.
 *   - "us":  en-US → 5/11/2026.
 *   - "eu":  en-GB → 11/05/2026.
 *   - "locale": fall through to the user's language.
 */
const resolveDateLocale = (language: string, mode: DateFormatMode): string => {
  switch (mode) {
    case "iso":
      return "sv-SE";
    case "us":
      return "en-US";
    case "eu":
      return "en-GB";
    case "locale":
    default:
      return language;
  }
};

const toDate = (value: Date | string | number | null | undefined): Date | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const next = new Date(value);
  return Number.isNaN(next.getTime()) ? null : next;
};

// --- public API ----------------------------------------------------------

export const formatDate = (
  value: Date | string | number | null | undefined,
  ctx: Pick<LocaleContext, "language" | "dateFormatMode">,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "2-digit" },
): string => {
  const date = toDate(value);
  if (!date) return "";
  const locale = resolveDateLocale(ctx.language, ctx.dateFormatMode);
  return getDateFormatter(locale, options).format(date);
};

export const formatDateTime = (
  value: Date | string | number | null | undefined,
  ctx: Pick<LocaleContext, "language" | "dateFormatMode">,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  },
): string => formatDate(value, ctx, options);

export const formatNumber = (
  value: number | null | undefined,
  ctx: Pick<LocaleContext, "language">,
  options: Intl.NumberFormatOptions = {},
): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return getNumberFormatter(ctx.language, options).format(value);
};

export const formatMoney = (
  amount: number | null | undefined,
  currency: string,
  ctx: Pick<LocaleContext, "language">,
  options: Intl.NumberFormatOptions = {},
): string => {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "";
  const normalizedCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  return getNumberFormatter(ctx.language, {
    style: "currency",
    currency: normalizedCurrency,
    ...options,
  }).format(amount);
};
