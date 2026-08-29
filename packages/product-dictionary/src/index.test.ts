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
});
