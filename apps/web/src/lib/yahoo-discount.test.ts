import { describe, expect, it } from "vitest";
import { yahooFleamarketDiscount } from "./yahoo-discount";

describe("yahooFleamarketDiscount", () => {
  it("targets 80% of the ask on Yahoo flea-market listings", () => {
    expect(yahooFleamarketDiscount("yahoo_fleamarket", 3100)).toEqual({
      targetYen: 2480,
      reductionYen: 620,
    });
    expect(yahooFleamarketDiscount("yahoo_fleamarket", 101)?.targetYen).toBe(
      81,
    );
  });

  it("ignores other sources and invalid prices", () => {
    expect(yahooFleamarketDiscount("yahoo_auctions", 3100)).toBeNull();
    expect(yahooFleamarketDiscount("mercari", 3100)).toBeNull();
    expect(yahooFleamarketDiscount("yahoo_fleamarket", NaN)).toBeNull();
    expect(yahooFleamarketDiscount("yahoo_fleamarket", 0)).toBeNull();
  });
});
