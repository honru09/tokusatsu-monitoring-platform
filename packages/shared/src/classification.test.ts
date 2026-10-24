import { describe, expect, it } from "vitest";
import {
  auctionRefreshDelay,
  classifyText,
  extractQuantityEst,
  isExcludedCollectibleText,
  isExcludedNormalizedItem,
  normalizeRawItem,
  resolveListingType,
} from "./classification.js";
import { categoryIps } from "./types.js";

describe("classification rules", () => {
  it("publishes every supported franchise category", () => {
    expect(categoryIps).toEqual([
      "kamen_rider",
      "ultraman",
      "super_sentai",
      "godzilla",
      "other",
      "unknown",
    ]);
  });

  it("classifies a bulk Kamen Rider lot without inventing listed_at", () => {
    const item = normalizeRawItem({
      sourcePlatform: "fixture",
      listingType: "direct",
      sourceItemId: "1",
      sourceUrl: "https://example.test/1",
      titleRaw: "仮面ライダー DX変身ベルト まとめ売り 12点",
      descriptionRaw: "中古、一部キズあり。BANDAI",
      priceCurrent: 4800,
      shippingFee: 0,
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

  it("recognizes franchise-specific Japanese product names without an umbrella title", () => {
    expect(classifyText("DXガッチャードライバー").categoryIp).toBe(
      "kamen_rider",
    );
    expect(
      classifyText("ウルトラ怪獣シリーズ バルタン星人 キングジョー").categoryIp,
    ).toBe("ultraman");
    expect(
      classifyText("爆竜戦隊アバレンジャー DX爆竜合体ロボ").categoryIp,
    ).toBe("super_sentai");
    expect(classifyText("ゴジュウジャー センタイリング").categoryIp).toBe(
      "super_sentai",
    );
    expect(classifyText("メカゴジラ2003 ガイガン2005 セット").categoryIp).toBe(
      "godzilla",
    );
  });

  it("recognizes explicit Chinese and English franchise aliases", () => {
    expect(classifyText("Kamen-Rider DX belt").categoryIp).toBe("kamen_rider");
    expect(classifyText("ULTRA MAN action figure").categoryIp).toBe("ultraman");
    expect(classifyText("超级战队 合体机器人").categoryIp).toBe("super_sentai");
    expect(classifyText("GODZILLA vinyl figure").categoryIp).toBe("godzilla");
  });

  it("uses the listing title before cross-franchise seller boilerplate", () => {
    expect(
      classifyText(
        "ウルトラマンゼロ ソフビ 3体セット",
        "同じ出品者が仮面ライダー商品も販売しています。",
      ).categoryIp,
    ).toBe("ultraman");
  });

  it("does not guess a franchise from generic monster or ambiguous names", () => {
    expect(classifyText("怪獣 ソフビ フィギュア").categoryIp).toBe("unknown");
    expect(classifyText("カブトムシ フィギュア").categoryIp).toBe("unknown");
    expect(classifyText("ミニライブ 限定フィギュア").categoryIp).toBe(
      "unknown",
    );
    expect(classifyText("牙狼 GARO 魔戒可動").categoryIp).toBe("unknown");
  });

  it("does not expose an ordinary unit cost when shipping or auction close price is unknown", () => {
    const raw = {
      sourcePlatform: "fixture",
      listingType: "unknown" as const,
      sourceItemId: "cost-basis",
      sourceUrl: "https://example.test/cost-basis",
      titleRaw: "仮面ライダー 食玩 10個",
      priceCurrent: 1_000,
      imageUrls: [],
      status: "active" as const,
      channel: "online" as const,
    };

    expect(normalizeRawItem(raw).unitCostEst).toBeUndefined();
    expect(
      normalizeRawItem({
        ...raw,
        listingType: "auction",
        shippingFee: 500,
        auctionEndAt: new Date("2026-09-02T00:00:00Z"),
      }).unitCostEst,
    ).toBeUndefined();
    expect(
      normalizeRawItem({ ...raw, listingType: "direct", shippingFee: 0 })
        .unitCostEst,
    ).toBe(100);
  });

  it("never promotes a missing sale mode to direct", () => {
    expect(resolveListingType(undefined)).toBe("unknown");
    expect(resolveListingType("direct")).toBe("direct");
    expect(
      resolveListingType("direct", new Date("2026-09-02T00:00:00.000Z")),
    ).toBe("auction");
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

  it("reads explicit variety and carton multipliers without treating models as counts", () => {
    expect(extractQuantityEst("全6種 各2個 コンプリートセット")).toBe(12);
    expect(extractQuantityEst("2箱（1箱10個入り）未開封")).toBe(20);
    expect(extractQuantityEst("2盒每盒10个")).toBe(20);
    expect(extractQuantityEst("2 boxes, 5 pcs each")).toBe(10);
    expect(extractQuantityEst("3袋×10個")).toBe(30);
    expect(
      extractQuantityEst("1/12 スケール サイズ120 型番 DX-100"),
    ).toBeUndefined();
  });

  it("does not turn approximate or accessory/media counts into exact toy quantity", () => {
    expect(extractQuantityEst("約20個")).toBeUndefined();
    expect(extractQuantityEst("20個以上")).toBeUndefined();
    expect(extractQuantityEst("20個前後")).toBeUndefined();
    expect(extractQuantityEst("写真30枚掲載・説明書10枚付き")).toBeUndefined();
    expect(extractQuantityEst("本体10体＋交換パーツ30個")).toBe(10);
    expect(extractQuantityEst("フィギュア10個、付属品40個")).toBe(10);
    expect(extractQuantityEst("台座20個のみ")).toBeUndefined();
    expect(extractQuantityEst("2袋（各10個）の交換パーツ")).toBeUndefined();
  });

  it("does not turn negated condition labels into damage or junk", () => {
    expect(
      classifyText("フィギュア", "目立った傷や汚れなし").conditionGrade,
    ).toBe("used");
    expect(classifyText("フィギュア", "傷なし・欠品なし").conditionGrade).toBe(
      "unknown",
    );
    expect(
      classifyText("フィギュア", "ジャンクではありません。動作未確認ではない")
        .conditionGrade,
    ).toBe("unknown");
    expect(classifyText("フィギュア", "破損あり").conditionGrade).toBe(
      "stained_or_damaged",
    );
    expect(classifyText("フィギュア", "動作未確認").conditionGrade).toBe(
      "junk",
    );
  });

  it("does not infer an exact total from an inexact package multiplier", () => {
    expect(extractQuantityEst("約2箱（1箱10個入り）")).toBeUndefined();
    expect(extractQuantityEst("約2盒每盒10个")).toBeUndefined();
    expect(extractQuantityEst("2箱以上（1箱10個入り）")).toBeUndefined();
    expect(extractQuantityEst("2箱前後（1箱10個入り）")).toBeUndefined();
    expect(extractQuantityEst("about 2 boxes, 5 pcs each")).toBeUndefined();
    expect(extractQuantityEst("2 boxes or more, 5 pcs each")).toBeUndefined();
    expect(extractQuantityEst("2箱（1箱約10個入り）")).toBeUndefined();
    expect(extractQuantityEst("2箱（1箱10個以上入り）")).toBeUndefined();
  });

  it("excludes books and cards without rejecting toy product names", () => {
    expect(isExcludedCollectibleText("仮面ライダー コミック 全3巻")).toBe(true);
    expect(
      isExcludedCollectibleText("平成仮面ライダー 変身ベルト&ウエポン辞典"),
    ).toBe(true);
    expect(isExcludedCollectibleText("仮面ライダー トレカ セット")).toBe(true);
    expect(isExcludedCollectibleText("スーパー戦隊 カードダス 全30枚")).toBe(
      true,
    );
    expect(
      isExcludedCollectibleText("仮面ライダー ガンバライジング LR まとめ売り"),
    ).toBe(true);
    expect(
      isExcludedCollectibleText("ガンバレジェンズ 仮面ライダー GL05-001"),
    ).toBe(true);
    expect(isExcludedCollectibleText("ゴジラ大図鑑")).toBe(true);
    expect(isExcludedCollectibleText("ゴジラ 復刻版冊子")).toBe(true);
    expect(isExcludedCollectibleText("ウルトラマン 新番組告知チラシ")).toBe(
      true,
    );
    expect(isExcludedCollectibleText("仮面ライダー 劇場版ポスター")).toBe(true);
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
    expect(
      isExcludedCollectibleText(
        "新 仮面ライダーSPIRITS(3) マガジンKCDX/村枝賢一(著者)",
      ),
    ).toBe(true);
    expect(
      isExcludedCollectibleText(
        "ウルトラマンオーブ ソフビ購入特典ステッカー シール",
      ),
    ).toBe(true);
    expect(
      isExcludedCollectibleText(
        "【B51-9】特撮 映画 Blu-ray 仮面ライダー THE WINTER MOVIE",
      ),
    ).toBe(true);
    expect(
      isExcludedCollectibleText(
        "CSMファイズドライバーNEXT 仮面ライダー555 Blu-rayセット",
      ),
    ).toBe(false);
    expect(
      isExcludedCollectibleText(
        "CSM ライダーカード バインダー ディエンド ディエンドライバー",
      ),
    ).toBe(true);
    expect(
      isExcludedCollectibleText(
        "ライダーカード/ネオディエンドライバー付属品/仮面ライダージオウ",
      ),
    ).toBe(true);
    expect(
      isExcludedCollectibleText(
        "ウルトラマン ソフビ 60周年記念 カード 2枚セット",
      ),
    ).toBe(true);
    expect(
      isExcludedCollectibleText(
        "DXディエンドライバー 仮面ライダーディケイド ライダーカード40枚セット",
      ),
    ).toBe(false);
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

  it("keeps far auctions inside the two-hour SLA and buy-now listings inside one hour", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(auctionRefreshDelay(new Date("2026-01-01T03:00:00Z"), now)).toBe(
      60 * 60 * 1000,
    );
    expect(auctionRefreshDelay(new Date("2026-01-01T12:00:00Z"), now)).toBe(
      2 * 60 * 60 * 1000,
    );
    expect(auctionRefreshDelay(new Date("2026-01-03T00:00:00Z"), now)).toBe(
      2 * 60 * 60 * 1000,
    );
    expect(auctionRefreshDelay(null, now)).toBe(1 * 60 * 60 * 1000);
    expect(auctionRefreshDelay(undefined, now)).toBe(1 * 60 * 60 * 1000);
  });
});
