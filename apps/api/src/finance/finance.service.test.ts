import { describe, expect, it, vi } from "vitest";
import { FinanceService } from "./finance.service.js";

type BundleRow = {
  totalPurchaseAmount: number;
  archivedAt: Date | null;
};

function harness({
  bundles = [] as BundleRow[],
  salePrice = null as number | null,
} = {}) {
  const prisma = {
    purchaseBundle: {
      // Model the aggregate the way Prisma applies it: a row only
      // contributes when it matches the where clause the service passes.
      aggregate: vi.fn(
        (args: { where?: { archivedAt?: Date | null } }) => {
          const rows = bundles.filter((bundle) => {
            if (!args.where) return true;
            if (args.where.archivedAt === null)
              return bundle.archivedAt === null;
            return true;
          });
          return Promise.resolve({
            _sum: {
              totalPurchaseAmount: rows.length
                ? rows.reduce(
                    (sum, bundle) => sum + bundle.totalPurchaseAmount,
                    0,
                  )
                : null,
            },
          });
        },
      ),
    },
    salesRecord: {
      aggregate: vi.fn().mockResolvedValue({
        _sum: { salePrice },
      }),
    },
  };
  return { service: new FinanceService(prisma as never), prisma };
}

function unarchived(totalPurchaseAmount: number): BundleRow {
  return { totalPurchaseAmount, archivedAt: null };
}

function archived(totalPurchaseAmount: number): BundleRow {
  return { totalPurchaseAmount, archivedAt: new Date("2026-10-20T00:00:00Z") };
}

describe("FinanceService.summary", () => {
  it("maps aggregate sums to cost/income and computes net profit", async () => {
    const { service, prisma } = harness({
      bundles: [unarchived(120_000)],
      salePrice: 150_000,
    });

    const result = await service.summary();

    expect(prisma.purchaseBundle.aggregate).toHaveBeenCalledWith({
      where: { archivedAt: null },
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
      bundles: [unarchived(80_000)],
      salePrice: 25_000,
    });

    const result = await service.summary();

    expect(result.netProfitYen).toBe(-55_000);
  });

  it("ignores archived bundles that still carry a total", async () => {
    // An archived empty shell left over from a single-item bundle merge
    // keeps its old total; that spend now lives on the surviving bundle,
    // so counting the shell as well would double-count it.
    const { service } = harness({
      bundles: [unarchived(105_309), archived(4_601)],
    });

    const result = await service.summary();

    expect(result.totalCostYen).toBe(105_309);
    expect(result.netProfitYen).toBe(-105_309);
  });

  it("raises the total when an unarchived bundle is added", async () => {
    const archivedOnly = harness({ bundles: [archived(4_601)] });
    const withActive = harness({
      bundles: [archived(4_601), unarchived(12_000)],
    });

    await expect(archivedOnly.service.summary()).resolves.toMatchObject({
      totalCostYen: 0,
    });
    await expect(withActive.service.summary()).resolves.toMatchObject({
      totalCostYen: 12_000,
    });
  });
});
