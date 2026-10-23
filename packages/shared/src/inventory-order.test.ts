import { describe, expect, it } from "vitest";
import {
  applyAdjustment,
  applySale,
  averageCost,
  costOfSale,
  finalOrderMarginPercent,
  finalOrderProfit,
  inventoryOrderMetrics,
  orderNumberFromId,
  recoveryPercent,
  realizedProfit,
  resolveInventoryOrderStatus,
  saleProfit,
} from "./inventory-order.js";

describe("inventory-order average cost", () => {
  it("fixes average cost as purchaseCost / initialQuantity", () => {
    expect(averageCost(10_000, 10)).toBe(1_000);
    expect(averageCost(5_000, 3)).toBeCloseTo(5_000 / 3);
    expect(averageCost(100, 0)).toBeNull();
  });

  it("rounds cost of sale in yen", () => {
    expect(costOfSale(5_000, 3, 1)).toBe(1_667);
    expect(costOfSale(5_000, 3, 2)).toBe(3_333);
    expect(saleProfit(2_000, 1_667)).toBe(333);
  });
});

describe("inventory-order status", () => {
  it("maps remaining vs initial to Chinese-facing status codes", () => {
    expect(resolveInventoryOrderStatus(10, 10)).toBe("in_stock");
    expect(resolveInventoryOrderStatus(4, 10)).toBe("partially_sold");
    expect(resolveInventoryOrderStatus(0, 10)).toBe("sold_out");
  });
});

describe("inventory-order sell", () => {
  const base = {
    purchaseCost: 10_000,
    initialQuantity: 10,
    remainingQuantity: 10,
    soldQuantity: 0,
    totalSales: 0,
  };

  it("applies qty + total sale price for single and bulk sells", () => {
    const first = applySale(base, 2, 3_000);
    expect(first).toMatchObject({
      remainingQuantity: 8,
      soldQuantity: 2,
      totalSales: 3_000,
      costOfSale: 2_000,
      saleProfit: 1_000,
      realizedProfit: 1_000,
      status: "partially_sold",
    });

    const second = applySale(
      {
        ...base,
        remainingQuantity: first.remainingQuantity,
        soldQuantity: first.soldQuantity,
        totalSales: first.totalSales,
      },
      8,
      9_000,
    );
    expect(second.status).toBe("sold_out");
    expect(second.totalSales).toBe(12_000);
    expect(second.realizedProfit).toBe(2_000);
    expect(finalOrderProfit(second.totalSales, base.purchaseCost)).toBe(2_000);
  });

  it("rejects selling more than remaining", () => {
    expect(() => applySale(base, 11, 1_000)).toThrow(/exceeds remaining/);
  });
});

describe("inventory-order adjust", () => {
  it("reduces remaining without touching sales", () => {
    const result = applyAdjustment(
      { remainingQuantity: 10, initialQuantity: 10 },
      -1,
    );
    expect(result).toEqual({
      remainingQuantity: 9,
      status: "partially_sold",
    });
  });

  it("rejects adjustments that go negative or above initial", () => {
    expect(() =>
      applyAdjustment({ remainingQuantity: 1, initialQuantity: 10 }, -2),
    ).toThrow(/negative/);
    expect(() =>
      applyAdjustment({ remainingQuantity: 10, initialQuantity: 10 }, 1),
    ).toThrow(/exceed/);
  });
});

describe("inventory-order metrics", () => {
  it("computes recovery % and realized profit", () => {
    const metrics = inventoryOrderMetrics({
      purchaseCost: 10_000,
      initialQuantity: 10,
      remainingQuantity: 5,
      soldQuantity: 5,
      totalSales: 6_000,
    });
    expect(metrics.averageCost).toBe(1_000);
    expect(metrics.realizedProfit).toBe(1_000);
    expect(recoveryPercent(6_000, 10_000)).toBe(60);
    expect(metrics.recoveryPercent).toBe(60);
    expect(metrics.finalOrderProfit).toBeNull();
    expect(metrics.finalOrderMarginPercent).toBeNull();
    expect(realizedProfit(6_000, 10_000, 10, 5)).toBe(1_000);
  });

  it("exposes final profit and margin only when sold out", () => {
    expect(finalOrderProfit(12_000, 10_000)).toBe(2_000);
    expect(finalOrderMarginPercent(12_000, 10_000)).toBe(20);
    expect(finalOrderMarginPercent(8_000, 10_000)).toBe(-20);
    expect(finalOrderMarginPercent(1_000, 0)).toBeNull();

    const soldOut = inventoryOrderMetrics({
      purchaseCost: 10_000,
      initialQuantity: 10,
      remainingQuantity: 0,
      soldQuantity: 10,
      totalSales: 12_000,
    });
    expect(soldOut.finalOrderProfit).toBe(2_000);
    expect(soldOut.finalOrderMarginPercent).toBe(20);
    expect(soldOut.status).toBe("sold_out");
  });

  it("builds deterministic ORD numbers from ids", () => {
    expect(orderNumberFromId("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(
      "ORD-A1B2C3D4",
    );
    expect(orderNumberFromId("bundle-new-1")).toBe("ORD-BUNDLENE");
  });
});
