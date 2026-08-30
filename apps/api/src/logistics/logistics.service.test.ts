import { describe, expect, it, vi } from "vitest";
import { LogisticsService } from "./logistics.service.js";

function item(id: string, priceCurrent: number, logistics: Record<string, unknown> | null, shippingFee: number | null = 0) {
  return {
    id,
    titleRaw: id,
    titleZh: null,
    priceCurrent,
    shippingFee,
    quantityEst: 1,
    source: { key: "fixture", displayName: "fixture" },
    images: [],
    logistics,
  };
}

describe("LogisticsService", () => {
  it("lists only favorite or purchased products as profit candidates", async () => {
    const prisma = {
      item: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new LogisticsService(prisma as never, {} as never);

    await service.listItems();

    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { favorite: true },
            { purchaseRecord: { isNot: null } },
          ],
        }),
      }),
    );
  });

  it("uses the visual model to prefill editable logistics estimates", async () => {
    const prisma = {
      item: {
        findUnique: vi.fn().mockResolvedValue({
          id: "item-1",
          titleRaw: "仮面ライダー DX ベルト",
          titleZh: "假面骑士 DX 腰带",
          descriptionRaw: "箱付き",
          descriptionZh: "带包装盒",
          priceCurrent: 4_000,
          shippingFee: 800,
          favorite: true,
          purchaseRecord: null,
          images: [{ url: "https://example.com/one.jpg" }],
        }),
      },
      itemLogistics: {
        upsert: vi.fn().mockImplementation(({ create }) =>
          Promise.resolve({ id: "logistics-1", ...create }),
        ),
      },
    };
    const gateway = {
      executeJson: vi.fn().mockResolvedValue({
        data: {
          weightGrams: 620,
          packageWeightGrams: 820,
          lengthMm: 300,
          widthMm: 220,
          heightMm: 120,
          estimatedSalePriceYen: 7_500,
          reasoningZh: "依据腰带和包装盒比例估算",
        },
        model: "deepseek-v4-flash-vision-exp",
        cached: false,
        fallbackUsed: false,
      }),
    };
    const service = new LogisticsService(prisma as never, gateway as never);

    const result = await service.predictItem("item-1");

    expect(gateway.executeJson).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "image_analysis",
        imageUrls: ["https://example.com/one.jpg"],
      }),
    );
    expect(prisma.itemLogistics.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ weightGrams: 620, lengthMm: 300 }),
      }),
    );
    expect(result.model).toBe("deepseek-v4-flash-vision-exp");
  });

  it("chooses a deterministic multi-carrier quote and calculates profit", async () => {
    const prisma = {
      item: { findMany: vi.fn().mockResolvedValue([
        item("one", 1_000, { weightGrams: 500, packageWeightGrams: 600, lengthMm: 200, widthMm: 100, heightMm: 100, estimatedSalePriceYen: 3_000 }),
        item("two", 1_500, { weightGrams: 700, packageWeightGrams: 800, lengthMm: 200, widthMm: 100, heightMm: 100, estimatedSalePriceYen: 3_500 }),
      ]) },
      shippingCarrier: { findMany: vi.fn().mockResolvedValue([
        { id: "carrier-a", key: "a", displayName: "A", enabled: true, tariffs: [
          { id: "t1", serviceName: "A 标准", basis: "weight", minValue: 0, maxValue: 2_000, priceYen: 1_200, zone: "JP" },
        ] },
        { id: "carrier-b", key: "b", displayName: "B", enabled: true, tariffs: [
          { id: "t2", serviceName: "B 体积", basis: "volume", minValue: 0, maxValue: 10_000, priceYen: 900, zone: "JP" },
        ] },
      ]) },
    };
    const service = new LogisticsService(prisma as never, {} as never);
    const result = await service.optimize({ itemIds: ["one", "two"], zone: "JP", withAi: false });
    expect(prisma.item.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ channel: "online" }),
    }));
    expect(result.best.shippingYen).toBe(900);
    expect(result.best.groups).toHaveLength(1);
    expect(result.best.profitYen).toBe(3_100);
    expect(result.best.groups[0].carrier?.displayName).toBe("B");
  });

  it("never presents unknown package dimensions as zero shipping", async () => {
    const prisma = {
      item: { findMany: vi.fn().mockResolvedValue([item("one", 1_000, null, null)]) },
      shippingCarrier: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new LogisticsService(prisma as never, {} as never);
    const result = await service.optimize({ itemIds: ["one"], zone: "JP", withAi: false });
    expect(result.best.shippingYen).toBeNull();
    expect(result.best.groups[0].known).toBe(false);
  });

  it("uses the selected carrier and actual shipping fee as the profit source of truth", async () => {
    const prisma = {
      item: {
        findMany: vi.fn().mockResolvedValue([
          item("one", 1_000, { estimatedSalePriceYen: 4_000 }),
        ]),
      },
      shippingCarrier: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "7e7b46cb-6ee9-4a21-8e02-41f4f8cf5bd8",
            key: "yamato",
            displayName: "黑猫宅急便",
            enabled: true,
            tariffs: [],
          },
        ]),
      },
    };
    const service = new LogisticsService(prisma as never, {} as never);

    const result = await service.optimize({
      itemIds: ["one"],
      carrierId: "7e7b46cb-6ee9-4a21-8e02-41f4f8cf5bd8",
      shippingFeeYen: 780,
    });

    expect(result.options).toHaveLength(1);
    expect(result.best.shippingYen).toBe(780);
    expect(result.best.profitYen).toBe(2_220);
    expect(result.best.groups[0].carrier?.displayName).toBe("黑猫宅急便");
  });
});
