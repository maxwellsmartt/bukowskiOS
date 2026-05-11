/**
 * ISO-4217 currency catalog used by the user-level "Default currency"
 * picker. The shortlist appears first in the dropdown; the rest is
 * searchable. We deliberately keep the list compact — searching the
 * full ISO catalog (~180 codes) is rarely useful for our user base
 * and bloats the bundle. New entries are cheap to add when needed.
 */

export type CurrencyEntry = {
  code: string;
  name: string;
};

/** Curated shortlist — shown first in the combobox without filtering. */
export const COMMON_CURRENCIES: readonly CurrencyEntry[] = [
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "DOP", name: "Dominican Peso" },
] as const;

/** Additional codes resolvable by search (typing the code or part of the name). */
export const EXTENDED_CURRENCIES: readonly CurrencyEntry[] = [
  { code: "GBP", name: "British Pound" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "CNY", name: "Chinese Yuan" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "NZD", name: "New Zealand Dollar" },
  { code: "MXN", name: "Mexican Peso" },
  { code: "BRL", name: "Brazilian Real" },
  { code: "ARS", name: "Argentine Peso" },
  { code: "CLP", name: "Chilean Peso" },
  { code: "COP", name: "Colombian Peso" },
  { code: "PEN", name: "Peruvian Sol" },
  { code: "UYU", name: "Uruguayan Peso" },
  { code: "VES", name: "Venezuelan Bolívar" },
  { code: "BOB", name: "Bolivian Boliviano" },
  { code: "PYG", name: "Paraguayan Guaraní" },
  { code: "CRC", name: "Costa Rican Colón" },
  { code: "GTQ", name: "Guatemalan Quetzal" },
  { code: "HNL", name: "Honduran Lempira" },
  { code: "NIO", name: "Nicaraguan Córdoba" },
  { code: "PAB", name: "Panamanian Balboa" },
  { code: "HKD", name: "Hong Kong Dollar" },
  { code: "SGD", name: "Singapore Dollar" },
] as const;

export const ALL_CURRENCIES: readonly CurrencyEntry[] = [...COMMON_CURRENCIES, ...EXTENDED_CURRENCIES];

const byCode = new Map(ALL_CURRENCIES.map((entry) => [entry.code, entry]));

export const getCurrencyEntry = (code: string): CurrencyEntry | null => byCode.get(code.toUpperCase()) ?? null;
