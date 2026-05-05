/**
 * Renderer-side mirror of the main-process `quoteCalculationService` so the
 * Quote editor can render totals live without a round-trip through IPC. Logic
 * is intentionally identical to keep the on-screen preview consistent with
 * what the mutation service will persist.
 */

import {
  calculateQuote as calculateQuoteCore,
  type CalculateQuoteInput,
  type CalculateQuoteResult,
  type QuoteItemTaxBehavior,
  type QuoteTaxProfile,
} from "../../../electron/main/services/data/quoteCalculationService";

export type CalculateQuotePreviewInput = CalculateQuoteInput;
export type QuotePreviewResult = CalculateQuoteResult;
export type { QuoteItemTaxBehavior, QuoteTaxProfile };

export const calculateQuotePreview = (input: CalculateQuotePreviewInput): QuotePreviewResult =>
  calculateQuoteCore(input);
