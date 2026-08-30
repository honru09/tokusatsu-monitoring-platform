import { describe, expect, it } from "vitest";
import {
  auctionRefreshDelay,
  classifyText,
  isExcludedCollectibleText,
  isExcludedNormalizedItem,
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

  it("does not read clothing size followed by 本体 as an item count", () => {
    expect(
      classifyText(
        "仮面ライダービルド Tシャツ サイズ120",
        "サイズ120 本体 ポリエステル65％ 綿35％",
      ).quantityEst,
    ).toBeUndefined();
  });

  it("excludes books and cards without rejecting toy product names", () => {
    expect(isExcludedCollectibleText("仮面ライダー コミック 全3巻")).toBe(true);
    expect(isExcludedCollectibleText("平成仮面ライダー 変身ベルト&ウエポン辞典")).toBe(true);
    expect(isExcludedCollectibleText("仮面ライダー トレカ セット")).toBe(true);
    expect(isExcludedCollectibleText("装動 仮面ライダーセイバー Book 2")).toBe(
      false,
    );
    expect(
      isExcludedCollectibleText(
        "仮面ライダーエグゼイド DXガシャット シール無し",
      ),
    ).toBe(false);
    expect(isExcludedCollectibleText("仮面ライダー龍騎 DXカードデッキ")).toBe(
      false,
    );
    expect(
      isExcludedCollectibleText("SD仮面ライダースナック シール 10点セット"),
    ).toBe(true);
    expect(
      isExcludedCollectibleText("仮面ライダー おまけ", "シールのみの出品です"),
    ).toBe(true);
  });

  it("rejects a listing classified as cards even when its mixed title mentions toys", () => {
    expect(
      isExcludedNormalizedItem({
        titleRaw: "仮面ライダー おもちゃ フィギュア カード 大量まとめ",
        descriptionRaw: "カードを含む混合セット",
        categoryToyType: "card",
      }),
    ).toBe(true);
    expect(
      isExcludedNormalizedItem({
        titleRaw: "DX変身ベルト ライドケミートレカ付き",
        descriptionRaw: "ベルト本体と付属カード",
        categoryToyType: "dx_belt",
      }),
    ).toBe(false);
    expect(
      isExcludedCollectibleText(
        "仮面ライダー ガンバライド DXディケイドライバー対応カード まとめ売り 30枚",
      ),
    ).toBe(true);
    expect(isExcludedCollectibleText("仮面ライダー剣 13枚組全話DVD-BOX")).toBe(
      true,
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

  it("spreads far auctions and buy-now listings across sustainable intervals", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(auctionRefreshDelay(new Date("2026-01-01T03:00:00Z"), now)).toBe(
      60 * 60 * 1000,
    );
    expect(auctionRefreshDelay(new Date("2026-01-01T12:00:00Z"), now)).toBe(
      4 * 60 * 60 * 1000,
    );
    expect(auctionRefreshDelay(new Date("2026-01-03T00:00:00Z"), now)).toBe(
      12 * 60 * 60 * 1000,
    );
    expect(auctionRefreshDelay(null, now)).toBe(12 * 60 * 60 * 1000);
  });
});
