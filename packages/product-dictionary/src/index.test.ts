import { describe, expect, it } from "vitest";
import { normalizeCatalogText, resolveCatalogEntry } from "./index.js";

describe("product dictionary", () => {
  it("normalizes full-width and multilingual aliases", () => {
    expect(normalizeCatalogText("ＫＡＭＥＮ　ＲＩＤＥＲ・ＦＡＩＺ")).toBe(
      "kamen rider faiz",
    );
  });

  it("maps Faiz aliases to one canonical series", () => {
    for (const title of [
      "仮面ライダー555 DX",
      "ファイズ ソフビ",
      "Kamen Rider Faiz figure",
    ]) {
      expect(resolveCatalogEntry("series", title)?.value.key).toBe(
        "KAMEN_RIDER_FAIZ",
      );
    }
  });

  it("does not invent a result when no alias is visible", () => {
    expect(resolveCatalogEntry("series", "特撮 おもちゃ まとめ")).toBeNull();
  });

  it("does not confuse Kamen Rider Zeronos with Ultraman Zero", () => {
    expect(resolveCatalogEntry("series", "仮面ライダー ゼロノス")).toBeNull();
    expect(resolveCatalogEntry("series", "仮面ライダー ゼロワン")).toEqual(
      expect.objectContaining({
        value: expect.objectContaining({ key: "KAMEN_RIDER_ZERO_ONE" }),
      }),
    );
    expect(
      resolveCatalogEntry("series", "ウルトラマンゼロ ソフビ")?.value.key,
    ).toBe("ULTRAMAN_ZERO");
  });

  it("resolves every physical-toy franchise used by the catalogue", () => {
    expect(
      resolveCatalogEntry("franchise", "スーパー戦隊 ロボ玩具")?.value.key,
    ).toBe("SUPER_SENTAI");
    expect(resolveCatalogEntry("franchise", "ゴジラ ソフビ")?.value.key).toBe(
      "GODZILLA",
    );
  });
});
