import { describe, expect, it } from "vitest";
import {
  authoritativePurchaseTotal,
  mergePurchaseBundlePage,
  standalonePurchaseRecords,
} from "./purchase-history";

describe("purchase history accounting", () => {
  it("uses the server aggregate without counting purchases from unloaded bundles again", () => {
    const purchases = [
      { id: "loaded-member", bundleId: "bundle-1", purchaseAmount: 1_000 },
      { id: "unloaded-member", bundleId: "bundle-101", purchaseAmount: 2_000 },
      { id: "legacy", bundleId: null, purchaseAmount: 300 },
    ];

    expect(standalonePurchaseRecords(purchases)).toEqual([purchases[2]]);
    expect(authoritativePurchaseTotal(3_300)).toBe(3_300);
  });

  it("merges later bundle pages by id without losing the API order", () => {
    const first = [
      { id: "bundle-2", totalPurchaseAmount: 2_000 },
      { id: "bundle-1", totalPurchaseAmount: 1_000 },
    ];
    const next = [
      { id: "bundle-1", totalPurchaseAmount: 1_100 },
      { id: "bundle-0", totalPurchaseAmount: 500 },
    ];

    expect(mergePurchaseBundlePage(first, next)).toEqual([
      first[0],
      next[0],
      next[1],
    ]);
  });
});
