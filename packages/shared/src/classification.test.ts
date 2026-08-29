import { describe, expect, it } from "vitest";
import {
  auctionRefreshDelay,
  classifyText,
  isExcludedCollectibleText,
  normalizeRawItem,
} from "./classification.js";

describe("classification rules", () => {
  it("classifies a bulk Kamen Rider lot without inventing listed_at", () => {
    const item = normalizeRawItem({
      sourcePlatform: "fixture",
      sourceItemId: "1",
      sourceUrl: "https://example.test/1",
      titleRaw: "仮面ライダー DX変身ベルト まとめ売り 12点",
      descriptionRaw: "中古、一部キズあり。BANDAI",
      priceCurrent: 4800,
      imageUrls: [],
      status: "active",
      channel: "online",
    });
    expect(item.categoryIp).toBe("kamen_rider");
    expect(item.categoryToyType).toBe("dx_belt");
    expect(item.quantityEst).toBe(12);
    expect(item.unitCostEst).toBe(400);
    expect(item.listedAt).toBeUndefined();
  });

  it("marks contradictory condition text for review", () => {
    expect(
      classifyText("未開封フィギュア", "箱破損・ジャンク扱い").conflicts,
    ).toContain("condition_text_conflict");
  });

  it("excludes books and cards without rejecting toy product names", () => {
    expect(isExcludedCollectibleText("仮面ライダー コミック 全3巻")).toBe(true);
    expect(isExcludedCollectibleText("仮面ライダー トレカ セット")).toBe(true);
    expect(isExcludedCollectibleText("装動 仮面ライダーセイバー Book 2")).toBe(
      false,
    );
  });
});

describe("auction refresh cadence", () => {
  it("accelerates inside three minutes", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(auctionRefreshDelay(new Date("2026-01-01T00:02:00Z"), now)).toBe(
      30_000,
    );
  });
});
