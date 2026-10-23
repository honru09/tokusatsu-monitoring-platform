import { describe, expect, it } from "vitest";
import {
  CRAWLER_DIAGNOSIS_SCHEMA,
  VISION_CLASSIFICATION_SCHEMA,
  ITEM_TRANSLATION_SCHEMA,
  LOGISTICS_EXPLANATION_SCHEMA,
  LOGISTICS_PREDICTION_SCHEMA,
  MARKET_BRIEF_SCHEMA,
  SELLER_BATCH_SUMMARY_SCHEMA,
  SELLER_PROFILE_SCHEMA,
  assistantAnswerSchema,
  assistantToolPlanSchema,
  priceJudgementSchema,
} from "./ai-response-contracts.js";

describe("server AI response contracts", () => {
  describe("priceJudgementSchema", () => {
    it("returns a trimmed canonical decision and strips unknown fields", () => {
      const schema = priceJudgementSchema(["item-a", "item-b", "item-c"]);
      const result = schema.validate({
        bestValueId: " item-a ",
        largestQuantityId: "item-b",
        bestConditionId: "item-c",
        recommendation: " 先核验商品 A ",
        ranked: [{ id: "item-a", reason: " 价格与体积事实完整 ", score: 99 }],
        insights: [" 数量明确 ", " 运费已知 "],
        risks: [" 需要核对配件 ", " 需要确认品相 "],
        score: 99,
      });

      expect(result).toEqual({
        success: true,
        value: {
          bestValueId: "item-a",
          largestQuantityId: "item-b",
          bestConditionId: "item-c",
          recommendation: "先核验商品 A",
          ranked: [{ id: "item-a", reason: "价格与体积事实完整" }],
          insights: ["数量明确", "运费已知"],
          risks: ["需要核对配件", "需要确认品相"],
        },
      });
      expect(`${schema.id}@${schema.version}`).toBe(
        "procurement.price-judgement@1",
      );
    });

    it("rejects IDs outside the request allowlist", () => {
      const result = priceJudgementSchema(["item-a"]).validate({
        bestValueId: "item-a",
        largestQuantityId: "made-up",
        bestConditionId: "item-a",
        recommendation: "建议",
        ranked: [{ id: "item-a", reason: "依据" }],
        insights: ["事实一", "事实二"],
        risks: ["风险一", "风险二"],
      });

      expect(result).toEqual({
        success: false,
        issues: [{ path: "largestQuantityId", code: "not_allowed" }],
      });
    });
  });

  it("validates the four full-item translation fields", () => {
    expect(
      ITEM_TRANSLATION_SCHEMA.validate({
        titleZh: " 中文标题 ",
        descriptionZh: " 中文描述 ",
        conditionZh: " 二手良品 ",
        shippingZh: " 运费另计 ",
        purchaseSummaryZh: "not part of this contract",
      }),
    ).toEqual({
      success: true,
      value: {
        titleZh: "中文标题",
        descriptionZh: "中文描述",
        conditionZh: "二手良品",
        shippingZh: "运费另计",
      },
    });
    expect(
      `${ITEM_TRANSLATION_SCHEMA.id}@${ITEM_TRANSLATION_SCHEMA.version}`,
    ).toBe("translation.item-full@1");
    expect(
      ITEM_TRANSLATION_SCHEMA.validate({
        titleZh: "标题",
        descriptionZh: "描述",
        conditionZh: "   ",
        shippingZh: "运费",
      }),
    ).toEqual({
      success: false,
      issues: [{ path: "conditionZh", code: "empty" }],
    });
  });

  it("validates seller summary and profile contracts", () => {
    expect(
      SELLER_BATCH_SUMMARY_SCHEMA.validate({
        catalogSummary: " 商品集中在变身腰带 ",
        facts: [" 公开商品共含多个系列 "],
        risks: [],
        privateIdentity: "invented",
      }),
    ).toEqual({
      success: true,
      value: {
        catalogSummary: "商品集中在变身腰带",
        facts: ["公开商品共含多个系列"],
        risks: [],
      },
    });
    expect(
      SELLER_PROFILE_SCHEMA.validate({
        profile: " 公开目录画像 ",
        negotiationJa: " 状態をご確認いただけますか。 ",
        negotiationZh: " 可以确认一下商品状态吗。 ",
        suggestedPrice: null,
        negotiation: "legacy alias",
      }),
    ).toEqual({
      success: true,
      value: {
        profile: "公开目录画像",
        negotiationJa: "状態をご確認いただけますか。",
        negotiationZh: "可以确认一下商品状态吗。",
        suggestedPrice: null,
      },
    });
    expect(
      SELLER_PROFILE_SCHEMA.validate({
        profile: "画像",
        negotiationJa: "交渉文",
        negotiationZh: "译文",
        suggestedPrice: "5000",
      }),
    ).toEqual({
      success: false,
      issues: [{ path: "suggestedPrice", code: "type" }],
    });
  });

  describe("VISION_CLASSIFICATION_SCHEMA", () => {
    const evidence = (value: unknown) => ({
      value,
      confidence: 0.8,
      evidence: [" 图片证据 "],
      ignored: "strip",
    });
    const validVision = () => ({
      franchise: evidence(["kamen_rider"]),
      series: evidence([" 仮面ライダークウガ "]),
      characters: evidence([" 五代雄介 "]),
      toyTypes: evidence(["dx_belt"]),
      manufacturers: evidence(["bandai"]),
      quantity: evidence(2),
      sealedCount: evidence(1),
      packaging: evidence([" 原盒 "]),
      condition: evidence("used"),
      visibleDamage: evidence([" 盒角磨损 "]),
      missingParts: evidence([]),
      backMarkings: evidence([" BANDAI 2000 "]),
      year: evidence(2000),
      modelNumber: evidence(" CSM-001 "),
      copyrightText: evidence([" 石森プロ "]),
      confidence: 0.9,
      breakdown: { should: "not survive" },
    });

    it("matches the shared VisionClassification shape and strips extras", () => {
      const result = VISION_CLASSIFICATION_SCHEMA.validate(validVision());

      expect(result).toEqual({
        success: true,
        value: {
          franchise: {
            value: ["kamen_rider"],
            confidence: 0.8,
            evidence: ["图片证据"],
          },
          series: {
            value: ["仮面ライダークウガ"],
            confidence: 0.8,
            evidence: ["图片证据"],
          },
          characters: {
            value: ["五代雄介"],
            confidence: 0.8,
            evidence: ["图片证据"],
          },
          toyTypes: {
            value: ["dx_belt"],
            confidence: 0.8,
            evidence: ["图片证据"],
          },
          manufacturers: {
            value: ["bandai"],
            confidence: 0.8,
            evidence: ["图片证据"],
          },
          quantity: {
            value: 2,
            confidence: 0.8,
            evidence: ["图片证据"],
          },
          sealedCount: {
            value: 1,
            confidence: 0.8,
            evidence: ["图片证据"],
          },
          packaging: {
            value: ["原盒"],
            confidence: 0.8,
            evidence: ["图片证据"],
          },
          condition: {
            value: "used",
            confidence: 0.8,
            evidence: ["图片证据"],
          },
          visibleDamage: {
            value: ["盒角磨损"],
            confidence: 0.8,
            evidence: ["图片证据"],
          },
          missingParts: {
            value: [],
            confidence: 0.8,
            evidence: ["图片证据"],
          },
          backMarkings: {
            value: ["BANDAI 2000"],
            confidence: 0.8,
            evidence: ["图片证据"],
          },
          year: {
            value: 2000,
            confidence: 0.8,
            evidence: ["图片证据"],
          },
          modelNumber: {
            value: "CSM-001",
            confidence: 0.8,
            evidence: ["图片证据"],
          },
          copyrightText: {
            value: ["石森プロ"],
            confidence: 0.8,
            evidence: ["图片证据"],
          },
          confidence: 0.9,
        },
      });
      expect(
        `${VISION_CLASSIFICATION_SCHEMA.id}@${VISION_CLASSIFICATION_SCHEMA.version}`,
      ).toBe("vision.classification@1");
    });

    it("rejects unknown enums, coercion, and out-of-range confidence", () => {
      const response = validVision();
      response.toyTypes = evidence(["spaceship"]);
      response.quantity = evidence("2");
      response.confidence = 1.2;

      expect(VISION_CLASSIFICATION_SCHEMA.validate(response)).toEqual({
        success: false,
        issues: [
          { path: "toyTypes.value[0]", code: "not_allowed" },
          { path: "quantity.value", code: "type" },
          { path: "confidence", code: "range" },
        ],
      });
    });
  });

  it("validates assistant tool planning against its allowlist", () => {
    const schema = assistantToolPlanSchema(["search_products", "market_trend"]);
    expect(
      schema.validate({
        selectedTools: [" search_products ", "market_trend"],
        reasonZh: " 覆盖商品和市场信息 ",
        ignored: true,
      }),
    ).toEqual({
      success: true,
      value: {
        selectedTools: ["search_products", "market_trend"],
        reasonZh: "覆盖商品和市场信息",
      },
    });
    expect(
      schema.validate({ selectedTools: ["write_database"], reasonZh: "原因" }),
    ).toEqual({
      success: false,
      issues: [{ path: "selectedTools[0]", code: "not_allowed" }],
    });
  });

  it("validates assistant answers against the request item IDs", () => {
    const schema = assistantAnswerSchema(["item-a", "item-b"]);
    expect(
      schema.validate({
        answerZh: " 可展示答案 ",
        referencedItemIds: [" item-a "],
        suggestions: [" 继续比较价格？ "],
        confidence: 1,
      }),
    ).toEqual({
      success: true,
      value: {
        answerZh: "可展示答案",
        referencedItemIds: ["item-a"],
        suggestions: ["继续比较价格？"],
      },
    });
    expect(
      schema.validate({
        answerZh: "答案",
        referencedItemIds: ["made-up"],
        suggestions: [],
      }),
    ).toEqual({
      success: false,
      issues: [{ path: "referencedItemIds[0]", code: "not_allowed" }],
    });
  });

  it("validates crawler diagnosis and requires literal human approval", () => {
    expect(
      CRAWLER_DIAGNOSIS_SCHEMA.validate({
        summary: " 抓取任务持续失败 ",
        facts: [" 最近三次任务均失败 "],
        hypotheses: [
          {
            cause: " 页面结构可能变化 ",
            evidence: " 选择器未匹配 ",
            verification: " 使用固定页面离线复现 ",
            confidence: 0.8,
          },
        ],
        recommendedPatch: " 更新选择器后运行回归测试 ",
        tests: [" 固定 fixture 解析测试 "],
        requiresHumanApproval: true,
        productionCommand: "ignored",
      }),
    ).toEqual({
      success: true,
      value: {
        summary: "抓取任务持续失败",
        facts: ["最近三次任务均失败"],
        hypotheses: [
          {
            cause: "页面结构可能变化",
            evidence: "选择器未匹配",
            verification: "使用固定页面离线复现",
          },
        ],
        recommendedPatch: "更新选择器后运行回归测试",
        tests: ["固定 fixture 解析测试"],
        requiresHumanApproval: true,
      },
    });
    expect(
      CRAWLER_DIAGNOSIS_SCHEMA.validate({
        summary: "摘要",
        facts: ["事实"],
        hypotheses: [],
        recommendedPatch: "补丁建议",
        tests: ["测试"],
        requiresHumanApproval: false,
      }),
    ).toEqual({
      success: false,
      issues: [{ path: "requiresHumanApproval", code: "literal" }],
    });
  });

  it("validates bounded market brief arrays", () => {
    expect(
      MARKET_BRIEF_SCHEMA.validate({
        facts: [" 事实 "],
        inferences: [" 推测 "],
        uncertainties: [],
        risks: [" 风险 "],
        actions: [" 行动 "],
        score: 100,
      }),
    ).toEqual({
      success: true,
      value: {
        facts: ["事实"],
        inferences: ["推测"],
        uncertainties: [],
        risks: ["风险"],
        actions: ["行动"],
      },
    });
    expect(
      MARKET_BRIEF_SCHEMA.validate({
        facts: ["事实"],
        inferences: ["   "],
        uncertainties: [],
        risks: [],
        actions: [],
      }),
    ).toEqual({
      success: false,
      issues: [{ path: "inferences[0]", code: "empty" }],
    });
  });

  it("validates logistics prediction without numeric coercion", () => {
    expect(
      LOGISTICS_PREDICTION_SCHEMA.validate({
        weightGrams: 1_000,
        packageWeightGrams: 1_200,
        lengthMm: 300,
        widthMm: 200,
        heightMm: null,
        estimatedSalePriceYen: 15_000,
        reasoningZh: " 图片显示中型原盒 ",
        cautionsZh: " 无法确认内部填充物 ",
        confidence: 0.8,
      }),
    ).toEqual({
      success: true,
      value: {
        weightGrams: 1_000,
        packageWeightGrams: 1_200,
        lengthMm: 300,
        widthMm: 200,
        heightMm: null,
        estimatedSalePriceYen: 15_000,
        reasoningZh: "图片显示中型原盒",
        cautionsZh: "无法确认内部填充物",
      },
    });
    expect(
      LOGISTICS_PREDICTION_SCHEMA.validate({
        weightGrams: "1000",
        packageWeightGrams: 1_200,
        lengthMm: 5_001,
        widthMm: 200,
        heightMm: 100,
        estimatedSalePriceYen: null,
        reasoningZh: "依据",
        cautionsZh: "注意",
      }),
    ).toEqual({
      success: false,
      issues: [
        { path: "weightGrams", code: "type" },
        { path: "lengthMm", code: "range" },
      ],
    });
  });

  it("validates logistics explanation text and caution rows", () => {
    expect(
      LOGISTICS_EXPLANATION_SCHEMA.validate({
        summaryZh: " 最佳方案为合箱 ",
        cautionsZh: [" 重量仍需确认 "],
        recommendationZh: " 发货前重新称重 ",
        modifiedPrice: 0,
      }),
    ).toEqual({
      success: true,
      value: {
        summaryZh: "最佳方案为合箱",
        cautionsZh: ["重量仍需确认"],
        recommendationZh: "发货前重新称重",
      },
    });
    expect(
      LOGISTICS_EXPLANATION_SCHEMA.validate({
        summaryZh: "摘要",
        cautionsZh: [42],
        recommendationZh: "建议",
      }),
    ).toEqual({
      success: false,
      issues: [{ path: "cautionsZh[0]", code: "type" }],
    });
  });

  it("keeps stable identities for static operational contracts", () => {
    expect(
      [
        ITEM_TRANSLATION_SCHEMA,
        SELLER_BATCH_SUMMARY_SCHEMA,
        SELLER_PROFILE_SCHEMA,
        VISION_CLASSIFICATION_SCHEMA,
        CRAWLER_DIAGNOSIS_SCHEMA,
        MARKET_BRIEF_SCHEMA,
        LOGISTICS_PREDICTION_SCHEMA,
        LOGISTICS_EXPLANATION_SCHEMA,
      ].map((schema) => `${schema.id}@${schema.version}`),
    ).toEqual([
      "translation.item-full@1",
      "seller.batch-summary@1",
      "seller.profile@1",
      "vision.classification@1",
      "crawler.diagnosis@1",
      "market.brief@1",
      "logistics.prediction@1",
      "logistics.explanation@1",
    ]);
  });
});
