import { describe, expect, it } from "vitest";
import {
  classifyCollectibleSeries,
  isSicListing,
  SIC_SEARCH_KEYWORDS,
} from "./collectible-series.js";

describe("collectible series classification", () => {
  it("includes Kamen Rider and Ultraman SHF in the same collection", () => {
    expect(
      classifyCollectibleSeries({
        categoryIp: "kamen_rider",
        titleRaw: "S.H.Figuarts 仮面ライダーギーツ",
      }),
    ).toBe("shf");
    expect(
      classifyCollectibleSeries({
        categoryIp: "ultraman",
        titleRaw: "S.H.Figuarts ウルトラマンゼロ",
      }),
    ).toBe("shf");
  });

  it("keeps Kamen Rider S.I.C. independent from SHF", () => {
    const input = {
      categoryIp: "kamen_rider",
      titleRaw: "S.I.C. 仮面ライダークウガ",
    } as const;
    expect(isSicListing(input)).toBe(true);
    expect(classifyCollectibleSeries(input)).toBe("sic");
  });

  it("does not classify unrelated SIC text or non-Kamen-Rider products", () => {
    expect(
      isSicListing({ categoryIp: "other", titleRaw: "S.I.C. キカイダー" }),
    ).toBe(false);
    expect(
      isSicListing({ categoryIp: "kamen_rider", titleRaw: "classic figure" }),
    ).toBe(false);
  });

  it("keeps dedicated S.I.C. searches in the scheduled pool", () => {
    expect(SIC_SEARCH_KEYWORDS.some((keyword) => keyword.includes("S.I.C."))).toBe(
      true,
    );
    expect(SIC_SEARCH_KEYWORDS.some((keyword) => keyword.includes("極魂"))).toBe(
      true,
    );
  });
});
