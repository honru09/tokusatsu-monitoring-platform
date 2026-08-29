import { describe, expect, it } from "vitest";
import { scoreProductMatch, trigramCosine } from "./index.js";

describe("multi-stage product matching", () => {
  it("matches multilingual Faiz aliases after normalization", () => {
    const result = scoreProductMatch(
      {
        normalizedName: "仮面ライダー555 ファイズ ソフビ",
        franchiseKey: "KAMEN_RIDER",
        seriesKey: "KAMEN_RIDER_FAIZ",
        toyTypeKey: "sofubi",
      },
      {
        normalizedName: "仮面ライダー555 ファイズ ソフビ",
        franchiseKey: "KAMEN_RIDER",
        seriesKey: "KAMEN_RIDER_FAIZ",
        toyTypeKey: "sofubi",
      },
    );
    expect(result.decision).toBe("auto_match");
    expect(result.score).toBeGreaterThanOrEqual(0.95);
  });

  it("penalizes a conflicting series instead of guessing", () => {
    const result = scoreProductMatch(
      {
        normalizedName: "仮面ライダー ソフビ",
        seriesKey: "KAMEN_RIDER_FAIZ",
        toyTypeKey: "sofubi",
      },
      {
        normalizedName: "仮面ライダー ソフビ",
        seriesKey: "KAMEN_RIDER_KUUGA",
        toyTypeKey: "sofubi",
      },
    );
    expect(result.decision).not.toBe("auto_match");
    expect(result.evidence).toContain("作品系列冲突");
  });

  it("returns zero for empty titles", () => {
    expect(trigramCosine("", "Faiz")).toBe(0);
  });
});
