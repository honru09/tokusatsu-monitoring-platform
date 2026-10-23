import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnalysisService,
  negotiationFallback,
  publicDetailFieldChunks,
  publicDetailFields,
  translationOutputTokenBudget,
} from "./analysis.service.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function useDefaultProcurementConfig() {
  for (const name of [
    "PROCUREMENT_MIN_QUANTITY",
    "PROCUREMENT_TARGET_QUANTITY",
    "PROCUREMENT_MAX_UNIT_COST_JPY",
    "PROCUREMENT_MAX_VOLUME_CM3",
    "PROCUREMENT_MAX_UNIT_VOLUME_CM3",
  ]) {
    vi.stubEnv(name, "");
  }
}

function marketItemFixture(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    titleRaw: `特摄玩具套装 ${id}`,
    sourceUrl: `https://example.test/${id}`,
    priceCurrent: 5_000,
    priceTotalEst: 5_000,
    unitCostEst: 500,
    quantityEst: 10,
    categoryToyType: "figure",
    conditionGrade: "used",
    status: "active",
    imageCount: 3,
    descriptionRaw: "10点セット、中古",
    shippingFee: 0,
    listingType: "direct",
    bidCount: null,
    auctionEndAt: null,
    detectedAt: new Date("2026-08-31T00:00:00.000Z"),
    logistics: {
      volumeCm3: 5_000,
      lengthMm: 200,
      widthMm: 100,
      heightMm: 250,
    },
    source: { key: "mercari", displayName: "Mercari" },
    ...overrides,
  };
}

describe("AI Gateway availability", () => {
  it("preserves the unified gateway error code for background workers", async () => {
    const error = Object.assign(new Error("AI unavailable"), {
      response: { code: "AI_GATEWAY_UNAVAILABLE" },
    });
    const gateway = {
      configured: () => true,
      executeJson: vi.fn(),
    };
    const service = new AnalysisService(
      {} as never,
      gateway as never,
      { execute: vi.fn().mockRejectedValue(error) } as never,
    );

    await expect(
      service.translate({ texts: ["仮面ライダー"] }),
    ).rejects.toMatchObject({
      response: { code: "AI_GATEWAY_UNAVAILABLE" },
    });
  });

  it("returns historical detail rows to pending when all gateway routes fail", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const error = Object.assign(new Error("AI unavailable"), {
      response: { code: "AI_GATEWAY_UNAVAILABLE" },
    });
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
        executeJson: vi.fn(),
      } as never,
      { execute: vi.fn().mockRejectedValue(error) } as never,
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

describe("Product AI routing", () => {
  it("routes market price judgement through the product operation", async () => {
    const marketItem = {
      id: "item-market",
      titleRaw: "仮面ライダー DX ベルト",
      sourceUrl: "https://example.test/item-market",
      priceCurrent: 8_000,
      priceTotalEst: 8_800,
      unitCostEst: 8_800,
      quantityEst: 1,
      conditionGrade: "used",
      status: "active",
      imageCount: 3,
      descriptionRaw: "中古・付属品あり",
      shippingFee: 800,
      listingType: "direct",
      bidCount: null,
      auctionEndAt: null,
      detectedAt: new Date(),
      source: { key: "mercari", displayName: "Mercari" },
    };
    const execute = vi.fn().mockResolvedValue({
      data: {
        bestValueId: marketItem.id,
        largestQuantityId: marketItem.id,
        bestConditionId: marketItem.id,
        recommendation: "核验配件后可考虑购买。",
      },
      model: "smart",
      cached: false,
    });
    const gateway = { configured: () => true, executeJson: vi.fn() };
    const service = new AnalysisService(
      { item: { findMany: vi.fn().mockResolvedValue([marketItem]) } } as never,
      gateway as never,
      { execute } as never,
    );

    const result = await service.market();

    expect(result.mode).toBe("ai");
    expect(result.engineLabel).toBe("smart");
    expect(execute).toHaveBeenCalledWith(
      "price_judgement",
      expect.objectContaining({ messages: expect.any(Array) }),
    );
    expect(gateway.executeJson).not.toHaveBeenCalled();
  });

  it("routes batch product translation through the product operation", async () => {
    const execute = vi.fn().mockResolvedValue({
      data: { translations: ["假面骑士"] },
      model: "fast",
      cached: false,
    });
    const gateway = { executeJson: vi.fn() };
    const service = new AnalysisService(
      {} as never,
      gateway as never,
      { execute } as never,
    );

    const result = await service.translate({ texts: ["仮面ライダー"] });

    expect(result.translations).toEqual(["假面骑士"]);
    expect(execute).toHaveBeenCalledWith(
      "translation",
      expect.objectContaining({ maxTokens: 800 }),
    );
    expect(gateway.executeJson).not.toHaveBeenCalled();
  });

  it("preserves the free-only policy for scheduled historical translation", async () => {
    const execute = vi.fn().mockResolvedValue({
      data: { translations: ["假面骑士整批出售"] },
      model: "fast",
      cached: false,
    });
    const service = new AnalysisService(
      {} as never,
      { executeJson: vi.fn() } as never,
      { execute } as never,
    );

    await service.translate(
      { texts: ["仮面ライダー まとめ売り"] },
      "free_only",
    );

    expect(execute).toHaveBeenCalledWith(
      "translation",
      expect.objectContaining({ costPolicy: "free_only" }),
    );
  });

  it("coalesces concurrent requests for the same translation batch", async () => {
    let finish:
      | ((value: {
          data: { translations: string[] };
          model: string;
          cached: boolean;
        }) => void)
      | undefined;
    const pending = new Promise<{
      data: { translations: string[] };
      model: string;
      cached: boolean;
    }>((resolve) => {
      finish = resolve;
    });
    const execute = vi.fn().mockReturnValue(pending);
    const service = new AnalysisService(
      {} as never,
      { executeJson: vi.fn() } as never,
      { execute } as never,
    );

    const first = service.translate({ texts: ["仮面ライダー"] });
    const second = service.translate({ texts: ["仮面ライダー"] });

    expect(execute).toHaveBeenCalledTimes(1);
    finish?.({
      data: { translations: ["假面骑士"] },
      model: "fast",
      cached: false,
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { translations: ["假面骑士"], model: "fast", cached: false },
      { translations: ["假面骑士"], model: "fast", cached: false },
    ]);
  });

  it("routes item classification and detail translation through product operations", async () => {
    const execute = vi
      .fn()
      .mockImplementation(
        async (
          operation: string,
          input: { messages: Array<{ content: string }> },
        ) => {
          if (operation === "translation" && execute.mock.calls.length === 1) {
            return {
              data: {
                titleZh: "假面骑士 DX",
                descriptionZh: "二手商品",
                conditionZh: "二手",
                shippingZh: "运费待确认",
                purchaseSummaryZh: "DX 商品",
              },
              model: "smart",
              cached: false,
            };
          }
          const payload = JSON.parse(
            input.messages.at(-1)?.content ?? "{}",
          ) as {
            fields?: Array<{
              fragmentKey: string;
              path: string;
            }>;
          };
          return {
            data: {
              translations: (payload.fields ?? []).map((field) => ({
                fragmentKey: field.fragmentKey,
                path: field.path,
                labelZh: "商品状态",
                valueZh: "二手",
              })),
            },
            model: "fast",
            cached: false,
          };
        },
      );
    const update = vi.fn().mockImplementation(({ data }) =>
      data.translationStatus === "completed"
        ? {
            id: "item-1",
            ...data,
          }
        : undefined,
    );
    const prisma = {
      item: {
        findUnique: vi.fn().mockResolvedValue({
          id: "item-1",
          titleRaw: "仮面ライダー DX",
          descriptionRaw: "中古品",
          conditionRaw: "中古",
          shippingFee: null,
          sourceData: { conditionText: "中古" },
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
    };
    const gateway = { executeJson: vi.fn() };
    const service = new AnalysisService(
      prisma as never,
      gateway as never,
      { execute } as never,
    );

    await service.itemTranslation("item-1");

    expect(execute.mock.calls[0]?.[0]).toBe("translation");
    expect(execute.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ itemId: "item-1" }),
    );
    expect(execute.mock.calls[1]?.[0]).toBe("translation");
    expect(execute.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ itemId: "item-1", maxTokens: 4_000 }),
    );
    expect(gateway.executeJson).not.toHaveBeenCalled();
    const completedWrite = update.mock.calls.find(
      ([input]) => input.data.translationStatus === "completed",
    )?.[0];
    expect(completedWrite?.data.detailsZh).toEqual([
      expect.objectContaining({ path: "conditionText", valueZh: "二手" }),
    ]);
    expect(
      completedWrite?.data.detailsZh.some((row: { path: string }) =>
        row.path.startsWith("ai."),
      ),
    ).toBe(false);
  });

  it("reassembles every provider-sized fragment of a long public detail field", async () => {
    const longDetail = `付属品と商品の状態。${"欠品なし、外箱に擦れあり。".repeat(420)}`;
    const execute = vi
      .fn()
      .mockImplementation(
        async (
          _operation: string,
          input: { messages: Array<{ content: string }> },
        ) => {
          if (execute.mock.calls.length === 1) {
            return {
              data: {
                titleZh: "假面骑士套装",
                descriptionZh: "完整卖家说明",
                conditionZh: "二手",
                shippingZh: "运费待确认",
                purchaseSummaryZh: "套装商品",
              },
              model: "smart",
              cached: false,
            };
          }
          const payload = JSON.parse(
            input.messages.at(-1)?.content ?? "{}",
          ) as {
            fields?: Array<{
              fragmentKey: string;
              path: string;
              value: string;
            }>;
          };
          return {
            data: {
              translations: (payload.fields ?? []).map((field) => ({
                fragmentKey: field.fragmentKey,
                path: field.path,
                labelZh: "完整详情",
                valueZh: field.value,
              })),
            },
            model: "fast",
            cached: false,
          };
        },
      );
    const update = vi.fn().mockImplementation(async ({ data }) => ({
      id: "item-long-detail",
      ...data,
    }));
    const service = new AnalysisService(
      {
        item: {
          findUnique: vi.fn().mockResolvedValue({
            id: "item-long-detail",
            titleRaw: "仮面ライダー セット",
            descriptionRaw: "出品説明",
            conditionRaw: "中古",
            shippingFee: null,
            sourceData: { sellerLongDetail: longDetail },
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
      { executeJson: vi.fn() } as never,
      { execute } as never,
    );

    const result = await service.itemTranslation("item-long-detail");
    const detail = (
      result?.translation as unknown as {
        detailsZh: Array<{ path: string; valueZh: string }>;
      }
    ).detailsZh.find((row) => row.path === "sellerLongDetail");

    expect(longDetail.length).toBeGreaterThan(5_000);
    expect(detail?.valueZh).toBe(longDetail);
  });

  it("retries only omitted detail fragments and ignores duplicate rows", async () => {
    let detailAttempt = 0;
    const execute = vi
      .fn()
      .mockImplementation(
        async (
          _operation: string,
          input: { messages: Array<{ content: string }> },
        ) => {
          if (execute.mock.calls.length === 1) {
            return {
              data: {
                titleZh: "假面骑士套装",
                descriptionZh: "卖家说明",
                conditionZh: "二手",
                shippingZh: "运费待确认",
                purchaseSummaryZh: "套装商品",
              },
              model: "smart",
              cached: false,
            };
          }
          detailAttempt += 1;
          const payload = JSON.parse(
            input.messages.at(-1)?.content ?? "{}",
          ) as {
            fields?: Array<{
              fragmentKey: string;
              path: string;
              value: string;
            }>;
          };
          const fields = payload.fields ?? [];
          const selected = detailAttempt === 1 ? fields.slice(0, 1) : fields;
          return {
            data: {
              translations: [
                ...selected.map((field) => ({
                  fragmentKey: field.fragmentKey,
                  path: field.path,
                  labelZh: field.path,
                  valueZh: `中文：${field.value}`,
                })),
                ...(detailAttempt === 1 && selected[0]
                  ? [
                      {
                        fragmentKey: selected[0].fragmentKey,
                        path: selected[0].path,
                        labelZh: "重复行",
                        valueZh: "不应覆盖首个有效翻译",
                      },
                    ]
                  : []),
              ],
            },
            model: "fast",
            cached: false,
          };
        },
      );
    const update = vi.fn().mockImplementation(async ({ data }) => ({
      id: "item-retry-detail",
      ...data,
    }));
    const service = new AnalysisService(
      {
        item: {
          findUnique: vi.fn().mockResolvedValue({
            id: "item-retry-detail",
            titleRaw: "仮面ライダー セット",
            descriptionRaw: "出品説明",
            conditionRaw: "中古",
            shippingFee: null,
            sourceData: {
              conditionText: "中古・擦れあり",
              shippingText: "送料は購入者負担",
            },
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
      { executeJson: vi.fn() } as never,
      { execute } as never,
    );

    const result = await service.itemTranslation("item-retry-detail");
    const detailCalls = execute.mock.calls.slice(1);
    const retriedPayload = JSON.parse(
      (
        detailCalls[1]?.[1] as { messages: Array<{ content: string }> }
      ).messages.at(-1)?.content ?? "{}",
    ) as { fields: Array<{ path: string }> };
    const details = (
      result?.translation as unknown as {
        detailsZh: Array<{ path: string; valueZh: string }>;
      }
    ).detailsZh;

    expect(detailCalls).toHaveLength(2);
    expect(retriedPayload.fields).toEqual([
      expect.objectContaining({ path: "shippingText" }),
    ]);
    expect(detailCalls[1]?.[1]).toEqual(
      expect.objectContaining({ bypassCache: true }),
    );
    expect(details.find((row) => row.path === "conditionText")?.valueZh).toBe(
      "中文：中古・擦れあり",
    );
    expect(details.find((row) => row.path === "shippingText")?.valueZh).toBe(
      "中文：送料は購入者負担",
    );
  });
});

describe("AnalysisService procurement market ranking", () => {
  it("selects logistics and makes the three-axis rule winner the fallback", async () => {
    useDefaultProcurementConfig();
    const findMany = vi.fn().mockResolvedValue([
      marketItemFixture("cheap-but-bulky", {
        priceCurrent: 1_000,
        priceTotalEst: 1_000,
        unitCostEst: 50,
        quantityEst: 20,
        logistics: {
          volumeCm3: 20_000,
          lengthMm: 400,
          widthMm: 250,
          heightMm: 200,
        },
      }),
      marketItemFixture("compact-many-cheap"),
    ]);
    const service = new AnalysisService(
      { item: { findMany } } as never,
      { configured: () => false } as never,
      { execute: vi.fn() } as never,
    );

    const result = await service.market();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["active", "unknown"] },
        }),
        select: expect.objectContaining({
          categoryToyType: true,
          logistics: {
            select: {
              volumeCm3: true,
              lengthMm: true,
              widthMm: true,
              heightMm: true,
              notes: true,
            },
          },
        }),
      }),
    );
    expect(result.mode).toBe("rules");
    expect(result.bestValue?.id).toBe("compact-many-cheap");
    expect(result.rankedRecommendations[0]?.item.id).toBe("compact-many-cheap");
    expect(result.rankedRecommendations[0]?.reason).toContain("含运费单件成本");
    expect(result.rankedRecommendations[0]?.reason).toContain("单件体积");
  });

  it("paginates all active candidates before applying procurement ranking", async () => {
    useDefaultProcurementConfig();
    const recent = Array.from({ length: 1_000 }, (_, index) =>
      marketItemFixture(`recent-${index}`, {
        priceCurrent: 9_000,
        quantityEst: 10,
        logistics: {
          volumeCm3: 9_000,
          lengthMm: 300,
          widthMm: 300,
          heightMm: 100,
        },
      }),
    );
    const olderBest = marketItemFixture("older-best", {
      priceCurrent: 1_000,
      quantityEst: 20,
      logistics: {
        volumeCm3: 2_000,
        lengthMm: 200,
        widthMm: 100,
        heightMm: 100,
      },
    });
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce([olderBest]);
    const service = new AnalysisService(
      { item: { findMany } } as never,
      { configured: () => false } as never,
      { execute: vi.fn() } as never,
    );

    const result = await service.market();

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        cursor: { id: "recent-999" },
        skip: 1,
      }),
    );
    expect(result.bestValue?.id).toBe("older-best");
  });

  it("keeps unknown shipping as a cost lower bound and unknown volume unclassified", async () => {
    useDefaultProcurementConfig();
    const service = new AnalysisService(
      {
        item: {
          findMany: vi.fn().mockResolvedValue([
            marketItemFixture("missing-facts", {
              shippingFee: null,
              priceTotalEst: 1_000,
              priceCurrent: 1_000,
              unitCostEst: 100,
              logistics: null,
            }),
          ]),
        },
      } as never,
      { configured: () => false } as never,
      { execute: vi.fn() } as never,
    );

    const result = await service.market();
    const reason = result.rankedRecommendations[0]?.reason ?? "";

    expect(reason).toContain("单件成本下限");
    expect(reason).toContain("不能视为最终低价");
    expect(reason).toContain("不能把商品判定为小体积");
    expect(reason).not.toContain("含运费单件成本");
    expect(result.risks).toContain(
      "1 件缺少可靠体积，不能直接视为小体积商品。",
    );
  });

  it("does not label unknown quantity or condition as a category winner", async () => {
    useDefaultProcurementConfig();
    const service = new AnalysisService(
      {
        item: {
          findMany: vi.fn().mockResolvedValue([
            marketItemFixture("unknown-winners", {
              quantityEst: null,
              conditionGrade: "unknown",
              logistics: null,
            }),
          ]),
        },
      } as never,
      { configured: () => false } as never,
      { execute: vi.fn() } as never,
    );

    const result = await service.market();

    expect(result.largestQuantity).toBeNull();
    expect(result.bestCondition).toBeNull();
  });

  it("sends the rule-ranked top 80 and their verifiable facts to AI", async () => {
    useDefaultProcurementConfig();
    const ordinary = Array.from({ length: 80 }, (_, index) =>
      marketItemFixture(`ordinary-${index + 1}`, {
        quantityEst: 5,
        priceCurrent: 4_000,
        priceTotalEst: 4_000,
        unitCostEst: 800,
        logistics: {
          volumeCm3: 5_000,
          lengthMm: 250,
          widthMm: 200,
          heightMm: 100,
        },
      }),
    );
    const strongest = marketItemFixture("strongest", {
      priceCurrent: 1_000,
      priceTotalEst: 1_000,
      unitCostEst: 50,
      quantityEst: 20,
      logistics: {
        volumeCm3: 2_000,
        lengthMm: 200,
        widthMm: 100,
        heightMm: 100,
      },
    });
    const execute = vi.fn().mockResolvedValue({
      data: {
        bestValueId: "strongest",
        largestQuantityId: "strongest",
        bestConditionId: "strongest",
        recommendation: "优先核验规则事实完整的候选。",
        ranked: [{ id: "strongest", reason: "体积小、数量多、成本低。" }],
      },
      model: "smart",
      cached: false,
    });
    const service = new AnalysisService(
      {
        item: { findMany: vi.fn().mockResolvedValue([...ordinary, strongest]) },
      } as never,
      { configured: () => true } as never,
      { execute } as never,
    );

    const result = await service.market();
    const input = execute.mock.calls[0]?.[1] as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemPrompt = input.messages.find(
      (message) => message.role === "system",
    )?.content;
    const candidates = JSON.parse(
      input.messages.find((message) => message.role === "user")?.content ??
        "[]",
    ) as Array<{
      id: string;
      logistics: { volumeCm3: number };
      ruleAssessment: {
        compactnessBasis: string;
        costBasis: string;
        facts: string[];
        missingFacts: string[];
      };
    }>;

    expect(candidates).toHaveLength(80);
    expect(candidates[0]).toMatchObject({
      id: "strongest",
      logistics: { volumeCm3: 2_000 },
      ruleAssessment: {
        compactnessBasis: "provided_volume",
        costBasis: "known",
        missingFacts: [],
      },
    });
    expect(candidates[0]?.ruleAssessment.facts.join(" ")).toContain("单件体积");
    expect(systemPrompt).toContain("未知体积绝不能写成小体积");
    expect(systemPrompt).toContain("只能称为成本下限");
    expect(systemPrompt).toContain("严禁生成数字评分");
    expect(result.mode).toBe("ai");
    expect(result.bestValue?.id).toBe("strongest");
    expect(result.rankedRecommendations[0]?.reason).toContain("规则依据");
    expect(result.rankedRecommendations[0]?.reason).toContain("含运费单件成本");
  });

  it("prevents AI output from overriding deterministic winners and risk order", async () => {
    useDefaultProcurementConfig();
    const primary = marketItemFixture("primary");
    const bestCondition = marketItemFixture("best-condition", {
      conditionGrade: "new_sealed",
    });
    const largestButBulky = marketItemFixture("largest-but-bulky", {
      quantityEst: 30,
      priceCurrent: 3_000,
      priceTotalEst: 3_000,
      unitCostEst: 100,
      logistics: {
        volumeCm3: 60_000,
        lengthMm: 600,
        widthMm: 400,
        heightMm: 250,
      },
    });
    const execute = vi.fn().mockResolvedValue({
      data: {
        bestValueId: "largest-but-bulky",
        largestQuantityId: "primary",
        bestConditionId: "primary",
        recommendation: "综合评分 99 分，直接购买。",
        ranked: [
          { id: "largest-but-bulky", reason: "评分 99，应排第一。" },
          { id: "largest-but-bulky", reason: "重复候选。" },
          { id: "primary", reason: "得分 98。" },
        ],
        insights: ["评分 95。", "推荐度 9/10。", "卖家描述仍需核验。"],
        risks: ["得分风险 10。", "竞拍价格可能变化。"],
      },
      model: "smart",
      cached: false,
    });
    const service = new AnalysisService(
      {
        item: {
          findMany: vi
            .fn()
            .mockResolvedValue([primary, bestCondition, largestButBulky]),
        },
      } as never,
      { configured: () => true } as never,
      { execute } as never,
    );

    const result = await service.market();
    const rankedIds = result.rankedRecommendations.map(({ item }) => item.id);
    const allText = [
      result.recommendation,
      ...result.rankedRecommendations.map(({ reason }) => reason),
      ...result.insights,
      ...result.risks,
    ].join(" ");

    expect(result.mode).toBe("ai");
    expect(result.bestValue?.id).toBe("primary");
    expect(result.largestQuantity?.id).toBe("largest-but-bulky");
    expect(result.bestCondition?.id).toBe("best-condition");
    expect(new Set(rankedIds).size).toBe(rankedIds.length);
    expect(rankedIds.indexOf("primary")).toBeLessThan(
      rankedIds.indexOf("largest-but-bulky"),
    );
    expect(result.rankedRecommendations[0]?.reason).toContain("含运费单件成本");
    expect(result.recommendation).toContain(
      "建议先核验「特摄玩具套装 primary」",
    );
    expect(result.risks.some((risk) => risk.startsWith("AI补充："))).toBe(
      false,
    );
    expect(allText).not.toContain("直接购买");
    expect(allText).not.toMatch(/评分|得分|分数|\bscore\b|9\/10/i);
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

  it("does not spend translation requests on image URLs or schema metadata", () => {
    const fields = publicDetailFields({
      shippingStatus: "unknown",
      structuredData: {
        "@context": "https://schema.org",
        "@type": "Product",
        image: [
          "https://cdn.example.test/item/front.jpg",
          "https://cdn.example.test/item/back.jpg",
        ],
        offers: {
          "@type": "Offer",
          priceCurrency: "JPY",
          url: "https://market.example.test/item/123",
        },
        name: "仮面ライダー DXベルト 2点セット",
      },
      seller: {
        name: "田中ホビー店",
        profileUrl: "https://market.example.test/seller/456",
      },
    });

    expect(fields).toEqual([
      {
        path: "structuredData.name",
        value: "仮面ライダー DXベルト 2点セット",
      },
      { path: "seller.name", value: "田中ホビー店" },
    ]);
    expect(fields.some((field) => /^https?:\/\//i.test(field.value))).toBe(
      false,
    );
  });

  it("keeps every field while splitting provider-safe translation requests", () => {
    const longValue = `説明。${"付属品と状態".repeat(1_400)}`;
    const chunks = publicDetailFieldChunks([
      { path: "item.description", value: longValue },
      { path: "item.condition", value: "中古・傷あり" },
    ]);
    const fragments = chunks.flat();

    expect(chunks.length).toBeGreaterThan(1);
    expect(fragments.map((fragment) => fragment.value).join("")).toBe(
      `${longValue}中古・傷あり`,
    );
    expect(
      Math.max(
        ...chunks.map((chunk) =>
          chunk.reduce(
            (total, fragment) =>
              total +
              fragment.fragmentKey.length +
              fragment.path.length +
              fragment.value.length,
            0,
          ),
        ),
      ),
    ).toBeLessThanOrEqual(4_000);
  });
});

describe("translationOutputTokenBudget", () => {
  it("reserves visible output for every title in a batch and caps long output", () => {
    expect(translationOutputTokenBudget(["仮面ライダー DXベルト"])).toBe(800);
    expect(
      translationOutputTokenBudget([
        "仮面ライダー DXベルト",
        "中古 未開封 20個セット",
        "昭和 特撮 フィギュア",
        "送料込み",
      ]),
    ).toBeGreaterThanOrEqual(2_000);
    expect(translationOutputTokenBudget(["長文".repeat(4_000)])).toBe(6_000);
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
      { execute: vi.fn() } as never,
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

  it("returns the AI profile grounded in the complete public seller catalogue", async () => {
    const executeJson = vi.fn().mockResolvedValue({
      model: "gpt-5.6-luna",
      data: {
        profile:
          "该卖家公开目录以二手 DX 腰带为主，商品描述持续注明配件、成色与包邮条件。",
        negotiationJa:
          "コメント失礼いたします。送料込みで¥8,000までお値下げいただくことは可能でしょうか。",
        negotiationZh: "打扰了。请问含运费可以降到 8,000 日元吗？",
        suggestedPrice: 8_000,
      },
    });
    const prisma = {
      seller: {
        findUnique: async () => ({
          id: "seller-ai",
          name: "公开卖家",
          sellerType: "individual",
          locationText: "東京都",
          profileUrl: "https://example.test/seller-ai",
          sourceData: { ratingCount: 42 },
          source: { key: "mercari", displayName: "Mercari" },
          items: [
            {
              id: "listing-ai",
              titleRaw: "DXベルト 付属品あり",
              descriptionRaw: "中古です。写真の付属品がすべてです。送料込み。",
              priceCurrent: 9_000,
              shippingFee: 0,
              priceTotalEst: 9_000,
              listingType: "direct",
              conditionRaw: "中古",
              conditionGrade: "used",
              categoryToyType: "dx_belt",
              status: "active",
              listedAt: null,
              sourceUrl: "https://example.test/listing-ai",
              sourceData: { shippingLabel: "送料込み" },
              images: [],
            },
          ],
        }),
      },
    };
    const service = new AnalysisService(
      prisma as never,
      { configured: () => true, executeJson } as never,
      { execute: vi.fn() } as never,
    );

    const result = await service.seller("seller-ai", 8_000);

    expect(result).toMatchObject({
      mode: "ai",
      model: "gpt-5.6-luna",
      analysis: {
        profile:
          "该卖家公开目录以二手 DX 腰带为主，商品描述持续注明配件、成色与包邮条件。",
        negotiationJa: expect.stringContaining("¥8,000"),
        negotiationZh: expect.stringContaining("8,000"),
        suggestedPrice: 8_000,
      },
    });
    expect(executeJson).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "seller_analysis",
        dataClass: "public_market",
      }),
    );
    const prompt = JSON.parse(
      executeJson.mock.calls[0][0].messages[1].content,
    ) as {
      seller: { locationText?: string; sourceData?: unknown };
      items: Array<{ descriptionRaw: string; sourceData?: unknown }>;
    };
    expect(prompt.seller.locationText).toBe("東京都");
    expect(prompt.seller.sourceData).toEqual({ ratingCount: 42 });
    expect(prompt.items[0]).toMatchObject({
      descriptionRaw: "中古です。写真の付属品がすべてです。送料込み。",
      sourceData: { shippingLabel: "送料込み" },
    });
  });
});
