import { describe, expect, it, vi } from "vitest";
import { FinanceService } from "./finance.service.js";

function harness({
  totalPurchaseAmount = null as number | null,
  salePrice = null as number | null,
} = {}) {
  const prisma = {
    purchaseBundle: {
      aggregate: vi.fn().mockResolvedValue({
        _sum: { totalPurchaseAmount },
      }),
    },
    salesRecord: {
      aggregate: vi.fn().mockResolvedValue({
        _sum: { salePrice },
      }),
    },
  };
  return { service: new FinanceService(prisma as never), prisma };
}

describe("FinanceService.summary", () => {
  it("maps aggregate sums to cost/income and computes net profit", async () => {
    const { service, prisma } = harness({
      totalPurchaseAmount: 120_000,
      salePrice: 150_000,
    });

    const result = await service.summary();

    expect(prisma.purchaseBundle.aggregate).toHaveBeenCalledWith({
      _sum: { totalPurchaseAmount: true },
    });
    expect(prisma.salesRecord.aggregate).toHaveBeenCalledWith({
      _sum: { salePrice: true },
    });
    expect(result.totalCostYen).toBe(120_000);
    expect(result.totalIncomeYen).toBe(150_000);
    expect(result.netProfitYen).toBe(30_000);
    expect(typeof result.serverTime).toBe("string");
    expect(Number.isNaN(Date.parse(result.serverTime))).toBe(false);
  });

  it("treats empty aggregates (null sums) as 0", async () => {
    const { service } = harness();

    const result = await service.summary();

    expect(result.totalCostYen).toBe(0);
    expect(result.totalIncomeYen).toBe(0);
    expect(result.netProfitYen).toBe(0);
  });

  it("allows net profit to go negative when costs exceed income", async () => {
    const { service } = harness({
      totalPurchaseAmount: 80_000,
      salePrice: 25_000,
    });

    const result = await service.summary();

    expect(result.netProfitYen).toBe(-55_000);
  });
});
