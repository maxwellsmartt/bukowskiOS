/**
 * Pure calculation core for FinanceOps Quotes v1.
 *
 * No DB, no IPC, no side effects. Mutation services and the renderer's live
 * preview hook both feed inputs through this module so that totals seen in the
 * UI exactly match what gets persisted and printed to the PDF.
 *
 * Money is REAL with 2 decimals to stay consistent with `financial_entries`.
 * Internally we round each step with `roundCents` to avoid float drift.
 *
 * Tax model (Plan L FQ2):
 * - Quote-level `taxProfile` controls the default behaviour for items whose
 *   `taxBehavior` is `"follows_quote"`:
 *     - `film_law_exempt` → items become `show_only` (ITBIS calculated for
 *       display, not added to total).
 *     - `standard_itbis` → items become `taxable`.
 *     - `mixed`          → ambiguous; items default to `exempt` and we emit a
 *       warning. Caller is expected to set per-item behaviour explicitly.
 *     - `manual`         → items default to `show_only`.
 * - Per-item overrides:
 *     - `taxable`    → adds tax to line + quote total.
 *     - `exempt`     → no tax at all.
 *     - `show_only`  → tax computed for transparency but NOT added.
 *     - `included`   → unit price already contains tax; subtotal is derived as
 *       price / (1 + rate).
 * - `taxAddedToTotal` is the resolved quote-level flag. If every item is
 *   exempt/show_only or the profile is `film_law_exempt`, callers should set
 *   `taxAddedToTotal: false` so the PDF prints "ITBIS (no incluido)".
 */

export type QuoteTaxProfile = "film_law_exempt" | "standard_itbis" | "mixed" | "manual";
export type QuoteItemTaxBehavior = "follows_quote" | "taxable" | "exempt" | "show_only" | "included";

export type CalculateQuoteItemInput = {
  quantity: number;
  unitPrice: number;
  durationValue?: number | null;
  discountRate?: number | null;
  discountAmount?: number | null;
  taxBehavior: QuoteItemTaxBehavior;
  taxRate?: number | null;
};

export type CalculateQuoteInput = {
  currency: string;
  baseCurrency: string;
  exchangeRate: number;
  taxProfile: QuoteTaxProfile;
  itbisRate: number;
  taxAddedToTotal: boolean;
  discountRate?: number | null;
  discountAmount?: number | null;
  items: CalculateQuoteItemInput[];
};

export type QuoteItemBreakdown = {
  lineSubtotal: number;
  discountAmount: number;
  taxableBase: number;
  taxAmount: number;
  taxAddedToLine: boolean;
  effectiveBehavior: Exclude<QuoteItemTaxBehavior, "follows_quote">;
  lineTotal: number;
};

export type CalculateQuoteResult = {
  itemBreakdowns: QuoteItemBreakdown[];
  subtotal: number;
  discountAmount: number;
  taxableBase: number;
  taxAmount: number;
  taxAddedToTotal: boolean;
  total: number;
  baseCurrencyTotal: number;
  warnings: string[];
};

const roundCents = (value: number): number => Math.round(value * 100) / 100;

const resolveItemBehavior = (
  behavior: QuoteItemTaxBehavior,
  profile: QuoteTaxProfile,
  taxAddedToTotal: boolean,
  warnings: string[],
): Exclude<QuoteItemTaxBehavior, "follows_quote"> => {
  if (behavior !== "follows_quote") return behavior;
  switch (profile) {
    case "film_law_exempt":
      return "show_only";
    case "standard_itbis":
      // When the quote-level toggle is off, follows_quote items show ITBIS
      // but don't add it to the line total either — keeps Iván's existing
      // cotizaciones (Ley de Cine via standard_itbis + taxAddedToTotal=false)
      // rendering with tax-free line totals.
      return taxAddedToTotal ? "taxable" : "show_only";
    case "mixed":
      warnings.push(
        "Quote uses mixed tax profile but at least one item still follows the quote default. Defaulting that item to exempt.",
      );
      return "exempt";
    case "manual":
    default:
      return "show_only";
  }
};

const computeItemDiscount = (
  lineSubtotal: number,
  discountRate?: number | null,
  discountAmount?: number | null,
): number => {
  if (discountAmount && discountAmount > 0) {
    return roundCents(Math.min(discountAmount, lineSubtotal));
  }
  if (discountRate && discountRate > 0) {
    return roundCents(lineSubtotal * discountRate);
  }
  return 0;
};

export const calculateQuote = (input: CalculateQuoteInput): CalculateQuoteResult => {
  const warnings: string[] = [];
  const rate = input.itbisRate;

  const itemBreakdowns: QuoteItemBreakdown[] = input.items.map((item) => {
    const effectiveBehavior = resolveItemBehavior(
      item.taxBehavior,
      input.taxProfile,
      input.taxAddedToTotal,
      warnings,
    );
    const taxRate = item.taxRate ?? rate;
    const quantity = item.quantity ?? 0;
    const unitPrice = item.unitPrice ?? 0;
    // Iván's cotizaciones price by `unitPrice × duration_value` (e.g. 60,000
    // per week × 3.8 weeks = 228,000). When duration is missing or zero we
    // treat it as 1 (flat-rate / `unit` items).
    const durationMultiplier =
      typeof item.durationValue === "number" && item.durationValue > 0 ? item.durationValue : 1;
    const grossLine = roundCents(quantity * unitPrice * durationMultiplier);

    if (effectiveBehavior === "included") {
      const divisor = 1 + taxRate;
      const lineSubtotal = roundCents(grossLine / divisor);
      const discount = computeItemDiscount(lineSubtotal, item.discountRate, item.discountAmount);
      const taxableBase = roundCents(lineSubtotal - discount);
      const taxAmount = roundCents(taxableBase * taxRate);
      const lineTotal = roundCents(taxableBase + taxAmount);
      return {
        lineSubtotal,
        discountAmount: discount,
        taxableBase,
        taxAmount,
        taxAddedToLine: true,
        effectiveBehavior,
        lineTotal,
      };
    }

    const lineSubtotal = grossLine;
    const discount = computeItemDiscount(lineSubtotal, item.discountRate, item.discountAmount);
    const taxableBase = roundCents(lineSubtotal - discount);

    if (effectiveBehavior === "exempt") {
      return {
        lineSubtotal,
        discountAmount: discount,
        taxableBase,
        taxAmount: 0,
        taxAddedToLine: false,
        effectiveBehavior,
        lineTotal: taxableBase,
      };
    }

    const taxAmount = roundCents(taxableBase * taxRate);
    const taxAddedToLine = effectiveBehavior === "taxable";
    return {
      lineSubtotal,
      discountAmount: discount,
      taxableBase,
      taxAmount,
      taxAddedToLine,
      effectiveBehavior,
      lineTotal: roundCents(taxAddedToLine ? taxableBase + taxAmount : taxableBase),
    };
  });

  const subtotal = roundCents(itemBreakdowns.reduce((acc, line) => acc + line.taxableBase, 0));

  let quoteDiscount = 0;
  if (input.discountAmount && input.discountAmount > 0) {
    quoteDiscount = roundCents(Math.min(input.discountAmount, subtotal));
  } else if (input.discountRate && input.discountRate > 0) {
    quoteDiscount = roundCents(subtotal * input.discountRate);
  }

  const taxableBase = roundCents(subtotal - quoteDiscount);

  // For the quote-level tax line we sum each line's tax (some lines may already
  // be `included` — those don't get re-added because their tax is already in
  // the line total). When a quote-level discount exists, scale the tax of
  // taxable lines proportionally so the visible ITBIS matches the discounted
  // taxable base.
  const taxableLineBase = roundCents(
    itemBreakdowns
      .filter((line) => line.taxAddedToLine && line.effectiveBehavior !== "included")
      .reduce((acc, line) => acc + line.taxableBase, 0),
  );

  const showOnlyTax = roundCents(
    itemBreakdowns
      .filter((line) => line.effectiveBehavior === "show_only")
      .reduce((acc, line) => acc + line.taxAmount, 0),
  );

  let taxableTax = roundCents(
    itemBreakdowns
      .filter((line) => line.taxAddedToLine && line.effectiveBehavior !== "included")
      .reduce((acc, line) => acc + line.taxAmount, 0),
  );

  if (taxableLineBase > 0 && quoteDiscount > 0) {
    const proportion = Math.max(0, taxableLineBase - quoteDiscount) / taxableLineBase;
    taxableTax = roundCents(taxableTax * proportion);
  }

  const includedTax = roundCents(
    itemBreakdowns
      .filter((line) => line.effectiveBehavior === "included")
      .reduce((acc, line) => acc + line.taxAmount, 0),
  );

  const includedTotal = roundCents(
    itemBreakdowns
      .filter((line) => line.effectiveBehavior === "included")
      .reduce((acc, line) => acc + line.taxAmount, 0),
  );

  const taxAmount = roundCents(taxableTax + showOnlyTax + includedTax);

  // `taxableBase` already contains the pre-tax amount of every line (including
  // the derived pre-tax base of `included` items). For `included` lines the
  // tax is already part of the user-quoted price, so it must contribute to the
  // total regardless of the quote-level `taxAddedToTotal` flag.
  const baseWithIncludedTax = roundCents(taxableBase + includedTotal);
  const total = input.taxAddedToTotal
    ? roundCents(baseWithIncludedTax + taxableTax)
    : baseWithIncludedTax;

  const baseCurrencyTotal = roundCents(total * (input.exchangeRate || 1));

  return {
    itemBreakdowns,
    subtotal,
    discountAmount: quoteDiscount,
    taxableBase,
    taxAmount,
    taxAddedToTotal: input.taxAddedToTotal,
    total,
    baseCurrencyTotal,
    warnings,
  };
};

/** Suggested default for the quote-level `taxAddedToTotal` flag. */
export const suggestTaxAddedToTotal = (
  profile: QuoteTaxProfile,
  items: CalculateQuoteItemInput[],
): boolean => {
  if (profile === "film_law_exempt") return false;
  if (profile === "manual") return false;
  if (items.length === 0) return profile === "standard_itbis";
  const everyHidden = items.every((item) => {
    if (item.taxBehavior === "exempt" || item.taxBehavior === "show_only") return true;
    return false;
  });
  return !everyHidden;
};
