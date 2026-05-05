import { describe, expect, it } from "vitest";

import {
  calculateQuote,
  suggestTaxAddedToTotal,
  type CalculateQuoteInput,
} from "../../electron/main/services/data/quoteCalculationService";

const baseInput = (overrides: Partial<CalculateQuoteInput> = {}): CalculateQuoteInput => ({
  currency: "DOP",
  baseCurrency: "DOP",
  exchangeRate: 1,
  taxProfile: "standard_itbis",
  itbisRate: 0.18,
  taxAddedToTotal: true,
  items: [],
  ...overrides,
});

describe("quoteCalculationService", () => {
  it("DOP standard_itbis applies 18% ITBIS to a single line", () => {
    const result = calculateQuote(
      baseInput({
        items: [{ quantity: 1, unitPrice: 10000, taxBehavior: "follows_quote" }],
      }),
    );
    expect(result.subtotal).toBe(10000);
    expect(result.taxAmount).toBe(1800);
    expect(result.total).toBe(11800);
    expect(result.baseCurrencyTotal).toBe(11800);
    expect(result.warnings).toHaveLength(0);
    expect(result.itemBreakdowns[0]?.effectiveBehavior).toBe("taxable");
  });

  it("DOP film_law_exempt shows ITBIS but does not add it", () => {
    const result = calculateQuote(
      baseInput({
        taxProfile: "film_law_exempt",
        taxAddedToTotal: false,
        items: [{ quantity: 1, unitPrice: 10000, taxBehavior: "follows_quote" }],
      }),
    );
    expect(result.subtotal).toBe(10000);
    expect(result.taxAmount).toBe(1800);
    expect(result.taxAddedToTotal).toBe(false);
    expect(result.total).toBe(10000);
    expect(result.itemBreakdowns[0]?.effectiveBehavior).toBe("show_only");
  });

  it("mixed profile only taxes items explicitly marked taxable", () => {
    const result = calculateQuote(
      baseInput({
        taxProfile: "mixed",
        items: [
          { quantity: 1, unitPrice: 5000, taxBehavior: "taxable" },
          { quantity: 1, unitPrice: 3000, taxBehavior: "exempt" },
        ],
      }),
    );
    expect(result.subtotal).toBe(8000);
    expect(result.taxAmount).toBe(900);
    expect(result.total).toBe(8900);
  });

  it("USD quote with DOP base reflects the rate in baseCurrencyTotal", () => {
    const result = calculateQuote(
      baseInput({
        currency: "USD",
        baseCurrency: "DOP",
        exchangeRate: 60,
        items: [{ quantity: 1, unitPrice: 100, taxBehavior: "exempt" }],
        taxProfile: "film_law_exempt",
        taxAddedToTotal: false,
      }),
    );
    expect(result.total).toBe(100);
    expect(result.baseCurrencyTotal).toBe(6000);
  });

  it("item with `included` behavior derives subtotal from gross price", () => {
    const result = calculateQuote(
      baseInput({
        items: [{ quantity: 1, unitPrice: 1180, taxBehavior: "included" }],
      }),
    );
    expect(result.itemBreakdowns[0]?.lineSubtotal).toBe(1000);
    expect(result.itemBreakdowns[0]?.taxAmount).toBe(180);
    expect(result.itemBreakdowns[0]?.lineTotal).toBe(1180);
    expect(result.total).toBe(1180);
  });

  it("quote-level fixed discount reduces ITBIS proportionally", () => {
    const result = calculateQuote(
      baseInput({
        discountAmount: 500,
        items: [{ quantity: 1, unitPrice: 10000, taxBehavior: "taxable" }],
      }),
    );
    expect(result.subtotal).toBe(10000);
    expect(result.discountAmount).toBe(500);
    expect(result.taxableBase).toBe(9500);
    expect(result.taxAmount).toBe(1710);
    expect(result.total).toBe(11210);
  });

  it("percentage discount on a line applies before tax", () => {
    const result = calculateQuote(
      baseInput({
        items: [
          { quantity: 2, unitPrice: 1000, discountRate: 0.1, taxBehavior: "taxable" },
        ],
      }),
    );
    expect(result.itemBreakdowns[0]?.discountAmount).toBe(200);
    expect(result.itemBreakdowns[0]?.taxableBase).toBe(1800);
    expect(result.itemBreakdowns[0]?.taxAmount).toBe(324);
    expect(result.total).toBe(2124);
  });

  it("empty items array returns zeros without warnings", () => {
    const result = calculateQuote(baseInput({ items: [] }));
    expect(result.subtotal).toBe(0);
    expect(result.total).toBe(0);
    expect(result.taxAmount).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("emits a warning when mixed profile has follows_quote items", () => {
    const result = calculateQuote(
      baseInput({
        taxProfile: "mixed",
        items: [{ quantity: 1, unitPrice: 1000, taxBehavior: "follows_quote" }],
      }),
    );
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.itemBreakdowns[0]?.effectiveBehavior).toBe("exempt");
  });

  it("suggestTaxAddedToTotal mirrors profile and item shape", () => {
    expect(suggestTaxAddedToTotal("film_law_exempt", [])).toBe(false);
    expect(suggestTaxAddedToTotal("standard_itbis", [])).toBe(true);
    expect(
      suggestTaxAddedToTotal("standard_itbis", [
        { quantity: 1, unitPrice: 100, taxBehavior: "exempt" },
      ]),
    ).toBe(false);
    expect(
      suggestTaxAddedToTotal("standard_itbis", [
        { quantity: 1, unitPrice: 100, taxBehavior: "taxable" },
      ]),
    ).toBe(true);
  });
});
