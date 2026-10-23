import { describe, expect, it } from "vitest";
import { displayListingTitle, normalizeDiscoveryTitle } from "./listing-title";

const legacyCall = displayListingTitle as unknown as (
  item: Parameters<typeof displayListingTitle>[0],
  language: "zh" | "original",
  translatedTitle?: string,
  localReplacement?: (raw: string) => string,
) => string;

describe("listing-title shared helper", () => {
  it("normalizes seller attribution the same way for non-discovery surfaces", () => {
    expect(normalizeDiscoveryTitle("附赠品 by 闲鱼卖家小王")).toBe("附赠品");
    expect(normalizeDiscoveryTitle("仮面ライダー 出品者：太郎")).toBe(
      "仮面ライダー",
    );
  });

  it("decodes persisted HTML entities before showing marketplace titles", () => {
    expect(
      normalizeDiscoveryTitle(
        "V3&amp;仮面ライダー1号 &#38; 仮面ライダー2号 &quot;セット&quot;",
      ),
    ).toBe('V3&仮面ライダー1号 & 仮面ライダー2号 "セット"');
  });

  it("falls back from accessory-only titles for favorites/detail shape", () => {
    expect(
      displayListingTitle(
        {
          titleRaw: "おまけ by seller",
          titleZh: "附赠品 by 店家",
          product: {
            canonicalName: "假面骑士变身腰带",
            titleZh: "假面骑士变身腰带",
          },
        },
        "zh",
      ),
    ).toBe("假面骑士变身腰带");
  });

  it("keeps the complete raw listing identity instead of a generic product title", () => {
    expect(
      displayListingTitle(
        {
          titleRaw: "仮面ライダーゼッツ GPカプセム03 全8種セット 新品未開封",
          titleZh: null,
          product: {
            canonicalName: "假面骑士 · 扭蛋",
            titleZh: "假面骑士 · 扭蛋",
          },
        },
        "zh",
      ),
    ).toBe("仮面ライダーゼッツ GPカプセム03 全8種セット 新品未開封");
  });

  it("prefers a complete listing translation over raw and product identity", () => {
    expect(
      displayListingTitle(
        {
          titleRaw: "仮面ライダーゼッツ GPカプセム03 全8種セット",
          titleZh: "假面骑士 Zeztz GP胶囊03 全8种套装",
          product: { titleZh: "假面骑士 · 扭蛋" },
        },
        "zh",
      ),
    ).toBe("假面骑士 Zeztz GP胶囊03 全8种套装");
  });

  it("rejects a partial local replacement that still contains Japanese kana", () => {
    expect(
      legacyCall(
        {
          titleRaw: "仮面ライダーゼッツ GPカプセム03 全8種セット",
          product: { titleZh: "假面骑士 · 扭蛋" },
        },
        "zh",
        undefined,
        (raw: string) => raw.replace("仮面ライダー", "假面骑士"),
      ),
    ).toBe("仮面ライダーゼッツ GPカプセム03 全8種セット");
  });

  it("never treats a local replacement callback as a complete AI translation", () => {
    expect(
      legacyCall(
        { titleRaw: "仮面ライダー 変身ベルト セット" },
        "zh",
        undefined,
        () => "假面骑士 变身腰带 套装",
      ),
    ).toBe("仮面ライダー 変身ベルト セット");
  });
});
