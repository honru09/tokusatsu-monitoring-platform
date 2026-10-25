import { describe, expect, it } from "vitest";
import {
  calculateQuote,
  customerQuoteText,
  DEFAULT_QUOTE_ASSUMPTIONS,
  estimateItemCost,
  inputNumber,
  internalEarnings,
  procurementCeiling,
  yahooFleamarketDiscount,
} from "./procurement-calculator";

const input = {
  quantity: 20,
  exchangePer100: 4.21,
  marketYen: 30_000,
  feePercent: 15,
  shippingPerUnit: 25,
};
describe("procurement calculator imported formulas", () => {
  it("retains the source calculator's cent-rounded quote", () => {
    expect(calculateQuote(input)).toEqual({
      marketCny: 1263,
      shipping: 500,
      fee: 189.45,
      landed: 1763,
      receivable: 1952.45,
      perUnit: 97.62,
    });
  });
  it("separates internal earnings from the customer's resale margin", () => {
    const quote = calculateQuote(input)!;
    expect(internalEarnings(quote, 4.21, 20_000, 400)).toEqual({
      purchaseCny: 842,
      shippingDifference: 100,
      purchaseDifference: 421,
      cost: 1242,
      profit: 710.45,
    });
    expect(internalEarnings(quote, 4.21, 50_000, 500)?.profit).toBe(-652.55);
  });
  it("computes an inclusive whole-yen ceiling that actually satisfies the target", () => {
    const ceiling = procurementCeiling({
      ...input,
      domesticCny: 3000,
      unitProfit: 30,
    })!;
    expect(ceiling.possible).toBe(true);
    expect(
      calculateQuote({ ...input, marketYen: ceiling.yen })!.receivable,
    ).toBeLessThanOrEqual(2400);
    expect(
      calculateQuote({ ...input, marketYen: ceiling.yen + 1 })!.receivable,
    ).toBeGreaterThan(2400);
    expect(
      procurementCeiling({ ...input, domesticCny: 100, unitProfit: 30 })
        ?.possible,
    ).toBe(false);
  });
  it("does not mistake missing inputs for zero or accept invalid numbers", () => {
    expect(inputNumber("")).toBeNull();
    expect(inputNumber("0")).toBe(0);
    expect(inputNumber("2.1", 1, 100, true)).toBeNull();
    for (const value of ["NaN", "Infinity", "-1", "1e20"])
      expect(inputNumber(value)).toBeNull();
    expect(calculateQuote({ ...input, quantity: 0 })).toBeNull();
    expect(calculateQuote({ ...input, exchangePer100: 0 })).toBeNull();
    expect(calculateQuote({ ...input, feePercent: 101 })).toBeNull();
  });
  it("copies a customer-only quote without accepting any internal cost data", () => {
    const text = customerQuoteText(input, calculateQuote(input)!, 3000);
    expect(text).toContain("1,952.45");
    expect(text).toContain("1,047.55");
    expect(text).not.toMatch(/实际采购|内部|710.45|842.00/);
  });
  it("preserves the calculation rate precision in the copied customer quote", () => {
    const precise = { ...input, exchangePer100: 4.349 };
    const quote = calculateQuote(precise)!;
    expect(quote.marketCny).toBe(1304.7);
    const text = customerQuoteText(precise, quote, 3000);
    expect(text).toContain("100 日元 = 4.349 元");
    expect(text).toContain("1,304.70");
  });
  it("shares one set of default assumptions with the embedded estimate", () => {
    expect(DEFAULT_QUOTE_ASSUMPTIONS).toEqual({
      feePercent: 15,
      shippingPerUnit: 25,
      targetProfitPerUnit: 30,
    });
    // The embedded estimate for the same batch must land on the same
    // receivable the standalone calculator produces.
    const estimate = estimateItemCost({
      priceYen: 30_000,
      shippingYen: 0,
      quantity: 20,
      exchangeRate: 0.0421,
      domesticCny: 3000,
    })!;
    expect(estimate.totalYen).toBe(30_000);
    expect(estimate.landedCny).toBe(calculateQuote(input)!.receivable);
    expect(estimate.perUnitCny).toBe(97.62);
    expect(estimate.profitCny).toBe(1047.55);
  });
  it("estimates a single item and refuses an unknown price", () => {
    const single = estimateItemCost({
      priceYen: 10_000,
      shippingYen: 500,
      exchangeRate: 0.05,
    })!;
    expect(single.quantity).toBe(1);
    expect(single.totalYen).toBe(10_500);
    expect(single.unitYen).toBe(10_500);
    expect(single.profitCny).toBeNull();
    expect(estimateItemCost({ priceYen: 0 })).toBeNull();
    expect(estimateItemCost({ priceYen: Number.NaN })).toBeNull();
    // Without a rate the yen total still stands, no CNY figure is made up.
    expect(
      estimateItemCost({ priceYen: 8000 })?.landedCny,
    ).toBeNull();
  });
  it("applies the 20% scenario to Yahoo flea market only", () => {
    expect(yahooFleamarketDiscount("yahoo_fleamarket", 3100)).toEqual({
      targetYen: 2480,
      reductionYen: 620,
    });
    expect(yahooFleamarketDiscount("yahoo_fleamarket", 101)?.targetYen).toBe(
      81,
    );
    expect(yahooFleamarketDiscount("yahoo_auctions", 3100)).toBeNull();
    expect(yahooFleamarketDiscount("mercari", 3100)).toBeNull();
    expect(yahooFleamarketDiscount("yahoo_fleamarket", NaN)).toBeNull();
  });
});
