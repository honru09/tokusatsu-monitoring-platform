import { describe, expect, it, vi } from "vitest";
import { LogisticsService } from "./logistics.service.js";

function item(
  id: string,
  priceCurrent: number,
  logistics: Record<string, unknown> | null,
  shippingFee: number | null = 0,
) {
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
    const service = new LogisticsService(
      prisma as never,
      {} as never,
      {} as never,
    );

    await service.listItems();

    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ favorite: true }, { purchaseRecord: { isNot: null } }],
        }),
      }),
    );
  });

  it("returns every profit candidate instead of silently stopping at 100", async () => {
    const candidates = Array.from({ length: 251 }, (_, index) => ({
      ...item(`item-${String(index).padStart(3, "0")}`, 1_000, null),
      favorite: true,
      purchaseRecord: null,
    }));
    const findMany = vi
      .fn()
      .mockImplementation(
        ({
          cursor,
          skip = 0,
          take,
        }: {
          cursor?: { id: string };
          skip?: number;
          take?: number;
        }) => {
          const cursorIndex = cursor
            ? candidates.findIndex((candidate) => candidate.id === cursor.id)
            : -1;
          const start = cursorIndex >= 0 ? cursorIndex + skip : 0;
          return Promise.resolve(
            candidates.slice(start, take == null ? undefined : start + take),
          );
        },
      );
    const service = new LogisticsService(
      { item: { findMany } } as never,
      {} as never,
      {} as never,
    );

    const result = await service.listItems();

    expect(result.items).toHaveLength(251);
    expect(result.total).toBe(251);
    expect(new Set(result.items.map((candidate) => candidate.id)).size).toBe(
      251,
    );
    expect(findMany.mock.calls.length).toBeGreaterThan(1);
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
        upsert: vi.fn(),
      },
    };
    const productAi = {
      execute: vi.fn().mockResolvedValue({
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
    const gateway = { executeJson: vi.fn() };
    const service = new LogisticsService(
      prisma as never,
      gateway as never,
      productAi as never,
    );

    const result = await service.predictItem("item-1");

    expect(productAi.execute).toHaveBeenCalledWith(
      "image_analysis",
      expect.objectContaining({
        imageUrls: ["https://example.com/one.jpg"],
      }),
    );
    expect(gateway.executeJson).not.toHaveBeenCalled();
    expect(prisma.itemLogistics.upsert).not.toHaveBeenCalled();
    expect(result.logistics).toMatchObject({
      weightGrams: 620,
      lengthMm: 300,
      volumeCm3: 7_920,
      notes: expect.stringContaining("[AI_ESTIMATE_UNVERIFIED]"),
    });
    expect(result.model).toBe("deepseek-v4-flash-vision-exp");
  });

  it("keeps the unverified marker when AI fills a missing field beside manual notes", async () => {
    const prisma = {
      item: {
        findUnique: vi.fn().mockResolvedValue({
          id: "item-mixed",
          titleRaw: "仮面ライダー 食玩セット",
          titleZh: null,
          descriptionRaw: null,
          descriptionZh: null,
          priceCurrent: 2_000,
          shippingFee: 500,
          favorite: true,
          purchaseRecord: null,
          images: [],
          logistics: { weightGrams: 500, notes: "重量は手測り" },
        }),
      },
    };
    const productAi = {
      execute: vi.fn().mockResolvedValue({
        data: { lengthMm: 200, widthMm: 100, heightMm: 80 },
        model: "fixture-vision",
        cached: false,
        fallbackUsed: false,
      }),
    };
    const service = new LogisticsService(
      prisma as never,
      {} as never,
      productAi as never,
    );

    const result = await service.predictItem("item-mixed");

    expect(result.logistics.notes).toContain("[AI_ESTIMATE_UNVERIFIED]");
    expect(result.logistics.notes).toContain("重量は手測り");
  });

  it("chooses a deterministic multi-carrier quote and calculates profit", async () => {
    const prisma = {
      item: {
        findMany: vi.fn().mockResolvedValue([
          item("one", 1_000, {
            weightGrams: 500,
            packageWeightGrams: 600,
            lengthMm: 200,
            widthMm: 100,
            heightMm: 100,
            estimatedSalePriceYen: 3_000,
          }),
          item("two", 1_500, {
            weightGrams: 700,
            packageWeightGrams: 800,
            lengthMm: 200,
            widthMm: 100,
            heightMm: 100,
            estimatedSalePriceYen: 3_500,
          }),
        ]),
      },
      shippingCarrier: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "carrier-a",
            key: "a",
            displayName: "A",
            enabled: true,
            tariffs: [
              {
                id: "t1",
                serviceName: "A 标准",
                basis: "weight",
                minValue: 0,
                maxValue: 2_000,
                priceYen: 1_200,
                zone: "JP",
              },
            ],
          },
          {
            id: "carrier-b",
            key: "b",
            displayName: "B",
            enabled: true,
            tariffs: [
              {
                id: "t2",
                serviceName: "B 体积",
                basis: "volume",
                minValue: 0,
                maxValue: 10_000,
                priceYen: 900,
                zone: "JP",
              },
            ],
          },
        ]),
      },
    };
    const service = new LogisticsService(
      prisma as never,
      {} as never,
      {} as never,
    );
    const result = await service.optimize({
      itemIds: ["one", "two"],
      zone: "JP",
      withAi: false,
    });
    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ channel: "online" }),
      }),
    );
    expect(result.best.shippingYen).toBe(900);
    expect(result.best.groups).toHaveLength(1);
    expect(result.best.profitYen).toBe(3_100);
    expect(result.best.groups[0].carrier?.displayName).toBe("B");
  });

  it("never presents unknown package dimensions as zero shipping", async () => {
    const prisma = {
      item: {
        findMany: vi.fn().mockResolvedValue([item("one", 1_000, null, null)]),
      },
      shippingCarrier: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new LogisticsService(
      prisma as never,
      {} as never,
      {} as never,
    );
    const result = await service.optimize({
      itemIds: ["one"],
      zone: "JP",
      withAi: false,
    });
    expect(result.best.shippingYen).toBeNull();
    expect(result.best.groups[0].known).toBe(false);
  });

  it("uses the selected carrier and actual shipping fee as the profit source of truth", async () => {
    const prisma = {
      item: {
        findMany: vi
          .fn()
          .mockResolvedValue([
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
    const service = new LogisticsService(
      prisma as never,
      {} as never,
      {} as never,
    );

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

  it("uses the allocated purchase amount as the purchased item cost in JPY", async () => {
    const purchased = {
      ...item("purchased", 5_000, { estimatedSalePriceYen: 6_000 }, 700),
      purchaseRecord: {
        id: "purchase-1",
        purchaseAmount: 2_000,
        amountAllocated: true,
        purchasedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    };
    const prisma = {
      item: { findMany: vi.fn().mockResolvedValue([purchased]) },
      shippingCarrier: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new LogisticsService(
      prisma as never,
      {} as never,
      {} as never,
    );

    const result = await service.optimize({
      itemIds: ["purchased"],
      carrierId: undefined,
      shippingFeeYen: undefined,
    });

    expect(result.units.money).toBe("JPY");
    expect(result.best.itemCostYen).toBe(2_000);
    expect(result.best.profitYen).toBe(3_300);
  });

  it("falls back to listing cost when a bundle total has no item allocation", async () => {
    const bundled = {
      ...item("bundled", 1_500, { estimatedSalePriceYen: 4_000 }, 300),
      purchaseRecord: {
        id: "purchase-2",
        purchaseAmount: 0,
        amountAllocated: false,
        purchasedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    };
    const prisma = {
      item: { findMany: vi.fn().mockResolvedValue([bundled]) },
      shippingCarrier: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new LogisticsService(
      prisma as never,
      {} as never,
      {} as never,
    );

    const result = await service.optimize({ itemIds: ["bundled"] });

    expect(result.best.itemCostYen).toBe(1_800);
    expect(result.best.profitYen).toBe(1_900);
  });
});
