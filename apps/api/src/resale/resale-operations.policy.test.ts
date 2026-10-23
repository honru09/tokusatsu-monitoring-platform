import { describe, expect, it } from "vitest";
import {
  csvCell,
  matchesMonitor,
  metricDelta,
  parseMarketObservation,
  parseMetricObservation,
} from "./resale-operations.policy.js";
import { normalizeCopy, resalePrompt } from "./resale-content.js";

describe("resale market evidence and copy", () => {
  const evidence = {
    id: "123",
    title: "ＡＩ 学习资料 完整版",
    price: "¥199.50",
    area: "上海",
    link: "https://www.goofish.com/item?id=123",
  };
  it("reads monitor fields without trusting conflicting IDs or currency", () => {
    expect(parseMarketObservation(evidence)).toMatchObject({
      targetItemId: "123",
      priceCny: 199.5,
      region: "上海",
    });
    expect(parseMarketObservation({ ...evidence, id: "456" })).toBeNull();
    expect(
      parseMarketObservation({
        ...evidence,
        link: "https://goofish.com.evil.test/item?id=123",
      }),
    ).toBeNull();
    expect(parseMarketObservation({ ...evidence, currency: "JPY" })).toBeNull();
    expect(parseMarketObservation({ ...evidence, price: "面议" })).toBeNull();
  });
  it("combines price, required, excluded, and region filters with full width normalisation", () => {
    const row = parseMarketObservation(evidence)!;
    const monitor = {
      minPriceCny: 100,
      maxPriceCny: 200,
      requiredKeywords: ["AI", "完整"],
      excludedKeywords: ["缺页"],
      regions: ["上海", "北京"],
    };
    expect(matchesMonitor(row, monitor)).toBe(true);
    expect(matchesMonitor({ ...row, title: "AI 缺页 完整" }, monitor)).toBe(
      false,
    );
    expect(matchesMonitor({ ...row, priceCny: 201 }, monitor)).toBe(false);
    expect(matchesMonitor({ ...row, region: "成都" }, monitor)).toBe(false);
  });
  it("keeps unknown metrics distinct from actual zero and rejects wrong receipts", () => {
    const data = {
      targetItemId: "123",
      observedAt: new Date().toISOString(),
      views: 0,
    };
    expect(parseMetricObservation(data, "123")).toMatchObject({
      views: 0,
      wants: null,
      revenueCny: null,
    });
    expect(parseMetricObservation(data, "456")).toBeNull();
    expect(
      parseMetricObservation({ ...data, views: undefined }, "123"),
    ).toBeNull();
    expect(parseMetricObservation({ ...data, views: 1.5 }, "123")).toBeNull();
    expect(parseMetricObservation({ ...data, views: "100" }, "123")).toBeNull();
    expect(metricDelta(null, 20)).toBeNull();
    expect(metricDelta(20, 10)).toBeNull();
    expect(metricDelta(0, 20)).toBe(20);
  });
  it("prevents spreadsheet formulas in imported titles and quotes CSV cells", () => {
    expect(csvCell(' =HYPERLINK("x")')).toBe('"\' =HYPERLINK(""x"")"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(0)).toBe('"0"');
  });
  it("deduplicates factual title alternatives and rejects unsupported histories", () => {
    const copy = {
      title: "AI 学习资料",
      description: "配件缺失，交付待确认",
      titleCandidates: ["AI 学习资料", "AI 入门资料"],
      contentKeywords: ["AI"],
      contentWarnings: ["使用权待确认"],
    };
    expect(normalizeCopy(copy, 40)).toMatchObject({
      titleCandidates: ["AI 学习资料", "AI 入门资料"],
    });
    expect(() =>
      normalizeCopy({ ...copy, description: "个人一手自用出" }, 40),
    ).toThrow();
    expect(resalePrompt("premium", 40)).toContain("完整保留瑕疵");
  });
});
