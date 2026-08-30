import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnalysisService,
  negotiationFallback,
  publicDetailFields,
} from "./analysis.service.js";

afterEach(() => vi.restoreAllMocks());

describe("AI Gateway availability", () => {
  it("preserves the unified gateway error code for background workers", async () => {
    const gateway = {
      configured: () => true,
      executeJson: vi.fn().mockRejectedValue(
        Object.assign(new Error("AI unavailable"), {
          response: { code: "AI_GATEWAY_UNAVAILABLE" },
        }),
      ),
    };
    const service = new AnalysisService({} as never, gateway as never);

    await expect(
      service.translate({ texts: ["仮面ライダー"] }),
    ).rejects.toMatchObject({
      response: { code: "AI_GATEWAY_UNAVAILABLE" },
    });
  });

  it("returns historical detail rows to pending when all gateway routes fail", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const service = new AnalysisService(
      {
        item: {
          findUnique: vi.fn().mockResolvedValue({
            id: "item-gateway",
            titleRaw: "仮面ライダー DX",
            descriptionRaw: "中古",
            conditionRaw: "中古",
            shippingFee: null,
            sourceData: null,
            titleZh: null,
            descriptionZh: null,
            conditionZh: null,
            shippingZh: null,
            detailsZh: null,
            translationStatus: "pending",
            translatedAt: null,
          }),
          update,
        },
      } as never,
      {
        configured: () => true,
        executeJson: vi.fn().mockRejectedValue(
          Object.assign(new Error("AI unavailable"), {
            response: { code: "AI_GATEWAY_UNAVAILABLE" },
          }),
        ),
      } as never,
    );

    await expect(service.itemTranslation("item-gateway")).rejects.toMatchObject(
      {
        response: { code: "AI_GATEWAY_UNAVAILABLE" },
      },
    );
    expect(update).toHaveBeenLastCalledWith({
      where: { id: "item-gateway" },
      data: { translationStatus: "pending" },
    });
  });
});

describe("publicDetailFields", () => {
  it("keeps structured public facts and sanitized page text", () => {
    const fields = publicDetailFields({
      bodyText: "登录 注册 返回顶部 热门品牌 推荐商品 使用规约",
      shippingStatus: "calculated",
      conditionText: "中古・目立った傷なし",
      structuredData: { name: "仮面ライダー DX 2点セット" },
    });

    expect(fields).toEqual([
      {
        path: "bodyText",
        value: "登录 注册 返回顶部 热门品牌 推荐商品 使用规约",
      },
      { path: "shippingStatus", value: "calculated" },
      { path: "conditionText", value: "中古・目立った傷なし" },
      {
        path: "structuredData.name",
        value: "仮面ライダー DX 2点セット",
      },
    ]);
  });
});

describe("negotiationFallback", () => {
  it("keeps Japanese as the copyable primary message and Chinese as translation", () => {
    const result = negotiationFallback(12_000);

    expect(result.negotiationJa).toContain("送料込みで¥12,000");
    expect(result.negotiationJa).toMatch(/[ぁ-んァ-ヶ一-龯]/);
    expect(result.negotiationZh).toContain("含运费降到 ¥12,000");
    expect(result.negotiationZh).not.toBe(result.negotiationJa);
  });
});

describe("AnalysisService seller catalogue", () => {
  it("reports and pages the complete seller catalogue without a 200-item cap", async () => {
    const allItems = Array.from({ length: 237 }, (_, index) => ({
      id: `listing-${index + 1}`,
      titleRaw: `商品 ${index + 1}`,
      descriptionRaw: "公開説明",
      priceCurrent: 1_000 + index,
      shippingFee: null,
      priceTotalEst: 1_000 + index,
      listingType: "auction",
      conditionRaw: "中古",
      conditionGrade: "used",
      categoryToyType: "figure",
      status: "active",
      listedAt: null,
      sourceUrl: `https://example.test/${index + 1}`,
      sourceData: null,
      images: [],
    }));
    const prisma = {
      seller: {
        findUnique: async () => ({
          id: "seller-large",
          name: "大型卖家",
          sellerType: "store",
          locationText: null,
          profileUrl: null,
          sourceData: null,
          source: {
            key: "yahoo_auctions",
            displayName: "Yahoo!オークション",
          },
          items: allItems,
        }),
      },
    };
    const service = new AnalysisService(
      prisma as never,
      { configured: () => false } as never,
    );

    const result = await service.seller("seller-large", undefined, 2, 48);

    expect(result).toMatchObject({
      total: 237,
      page: 2,
      pageCount: 5,
      mode: "rules",
      seller: expect.objectContaining({
        segment: expect.objectContaining({
          key: "professional_store",
          reasons: [expect.any(String)],
        }),
      }),
    });
    expect(result?.items).toHaveLength(48);
    expect(result?.items[0]?.id).toBe("listing-49");
    expect(result?.analysis.profile).toContain("237 条在售记录");
  });
});
