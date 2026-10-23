import { describe, expect, it } from "vitest";
import { classifyShfListing, SHF_SEARCH_KEYWORDS } from "./shf.js";

describe("SHF marketplace classification", () => {
  it("separates standard SHF from Shinkocchou Seihou and extracts attributes", () => {
    expect(
      classifyShfListing({
        categoryIp: "kamen_rider",
        titleRaw: "S.H.Figuarts 仮面ライダーギーツ 初版 日版 通販",
      }),
    ).toEqual({
      line: "standard",
      releaseChannel: "retail",
      edition: "first",
      region: "japanese",
    });

    expect(
      classifyShfListing({
        categoryIp: "kamen_rider",
        titleRaw: "S.H.Figuarts 真骨彫製法 仮面ライダーW 再販",
        descriptionRaw: "魂ウェブ商店限定、輸送箱あり",
      }),
    ).toEqual({
      line: "shinkocchou",
      releaseChannel: "tamashii_web",
      edition: "reissue",
      region: "unknown",
    });
  });

  it.each([
    "装動 仮面ライダー 可動フィギュア",
    "RKF 仮面ライダーゼロワン",
    "S.I.C 仮面ライダークウガ",
    "Figuarts ZERO 仮面ライダー",
    "Figure-rise Standard 仮面ライダー プラモデル",
  ])("does not mix the independent line %s into SHF", (titleRaw) => {
    expect(
      classifyShfListing({ categoryIp: "kamen_rider", titleRaw }),
    ).toBeNull();
  });

  it("does not classify anime S.H.Figuarts into the Kamen Rider subsection", () => {
    expect(
      classifyShfListing({
        categoryIp: "other",
        titleRaw: "S.H.Figuarts 孫悟空",
      }),
    ).toBeNull();
  });

  it("classifies Ultraman S.H.Figuarts without admitting unrelated anime figures", () => {
    expect(
      classifyShfListing({
        categoryIp: "ultraman",
        titleRaw: "S.H.Figuarts ウルトラマンゼロ 魂ウェブ商店限定",
      }),
    ).toEqual({
      line: "standard",
      releaseChannel: "tamashii_web",
      edition: "unknown",
      region: "unknown",
    });
  });

  it("keeps both SHF lines in the scheduled marketplace keyword set", () => {
    expect(
      SHF_SEARCH_KEYWORDS.some((value) => value.includes("S.H.Figuarts")),
    ).toBe(true);
    expect(
      SHF_SEARCH_KEYWORDS.some((value) => value.includes("真骨彫製法")),
    ).toBe(true);
    expect(
      SHF_SEARCH_KEYWORDS.some(
        (value) => value.includes("ウルトラマン") && value.includes("S.H.Figuarts"),
      ),
    ).toBe(true);
  });
});
