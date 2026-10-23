import { describe, expect, it } from "vitest";
import { assessInventoryQuality } from "./inventory-quality.js";

const base = {
  titleRaw: "仮面ライダー DX変身ベルト 中古",
  descriptionRaw:
    "動作確認済みです。付属品は写真に写っているものがすべてです。",
  sourceUrl: "https://example.test/item/1",
  priceCurrent: 3_000,
  shippingFee: 500,
  categoryIp: "kamen_rider",
  categoryToyType: "dx_belt",
  manufacturer: "bandai",
  conditionGrade: "used",
  quantityEst: 1,
  imageCount: 3,
  status: "active",
  channel: "online",
} as const;

describe("assessInventoryQuality", () => {
  it("accepts a user-selected general category without requiring a tokusatsu identity", () => {
    const bag = {
      ...base,
      titleRaw: "ブランド レザー バッグ",
      categoryIp: "unknown",
      categoryToyType: "unknown",
      manufacturer: "unknown",
    };
    expect(assessInventoryQuality(bag)).toMatchObject({
      eligible: false,
      reason: "weak_product_identity",
    });
    expect(assessInventoryQuality(bag, { scope: "general" })).toMatchObject({
      eligible: true,
    });
  });
  it.each(["仮面ライダー 写真集", "トレーディングカード"])(
    "keeps prohibited books/cards excluded even in general categories: %s",
    (titleRaw) => {
      expect(
        assessInventoryQuality({ ...base, titleRaw }, { scope: "general" }),
      ).toMatchObject({ eligible: false, reason: "excluded_collectible" });
    },
  );
  it.each([
    { status: "sold" },
    { channel: "offline" },
    { priceCurrent: 0 },
    { conditionGrade: "junk" },
  ])("keeps common admission safeguards in general categories: %j", (patch) => {
    expect(
      assessInventoryQuality({ ...base, ...patch }, { scope: "general" })
        .eligible,
    ).toBe(false);
  });
  it("admits a fully identified, evidenced toy listing", () => {
    expect(assessInventoryQuality(base)).toMatchObject({
      eligible: true,
      strongIdentity: true,
    });
  });

  it("rejects a franchise keyword with no product identity", () => {
    expect(
      assessInventoryQuality({
        ...base,
        titleRaw: "仮面ライダー 関連グッズ",
        categoryToyType: "unknown",
        manufacturer: "unknown",
      }),
    ).toMatchObject({ eligible: false, reason: "weak_product_identity" });
  });

  it("does not treat a generic bundle phrase as proof that the listing is a toy", () => {
    expect(
      assessInventoryQuality({
        ...base,
        titleRaw: "仮面ライダー グッズ まとめ売り",
        categoryIp: "unknown",
        categoryToyType: "unknown",
        manufacturer: "unknown",
      }),
    ).toMatchObject({ eligible: false, reason: "weak_product_identity" });
  });

  it("continues to reject books and cards", () => {
    expect(
      assessInventoryQuality({ ...base, titleRaw: "仮面ライダー 写真集" }),
    ).toMatchObject({ eligible: false, reason: "excluded_collectible" });
  });

  it("preserves an identified ultra-low unit-cost bundle", () => {
    expect(
      assessInventoryQuality({
        ...base,
        titleRaw: "仮面ライダー ソフビ まとめ売り 20体",
        categoryToyType: "sofubi",
        conditionGrade: "stained_or_damaged",
        quantityEst: 20,
        priceCurrent: 4_000,
        shippingFee: 800,
      }),
    ).toMatchObject({
      eligible: true,
      bulkValueException: true,
    });
  });
});
