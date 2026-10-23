import { describe, expect, it } from "vitest";
import {
  batchTranslationSchema,
  detailFragmentsSchema,
  recordResponseSchema,
  responseSchemaIdentity,
  responseSchemaIdentityHash,
  type ResponseValidationResult,
} from "./ai-response-schema.js";

describe("AI response schema contracts", () => {
  it("builds a bounded, deterministic schema identity", () => {
    const validate = (
      value: unknown,
    ): ResponseValidationResult<{ accepted: true }> =>
      value === "accepted"
        ? { success: true, value: { accepted: true } }
        : { success: false, issues: [{ path: "$", code: "rejected" }] };
    const schema = recordResponseSchema("translation.batch", 1, validate);

    expect(schema).toMatchObject({ id: "translation.batch", version: 1 });
    expect(schema.validate("accepted")).toEqual({
      success: true,
      value: { accepted: true },
    });
    expect(responseSchemaIdentity(schema.id, schema.version)).toBe(
      "translation.batch@1",
    );
    expect(responseSchemaIdentityHash(schema.id, schema.version)).toBe(
      "095633019e8f8b31e2a03a5305fdeb3802b74e7b8a60ecde571fd7f2833711fb",
    );
  });

  it.each([
    ["contains unsafe separators", "translation/batch", 1],
    ["is too long", `a${"b".repeat(80)}`, 1],
    ["has a zero version", "translation.batch", 0],
    ["has a fractional version", "translation.batch", 1.5],
    ["has an unbounded version", "translation.batch", 1_000_000],
  ])("rejects an identity that %s", (_case, id, version) => {
    expect(() =>
      recordResponseSchema(id, version, () => ({
        success: true,
        value: {},
      })),
    ).toThrow();
    expect(() => responseSchemaIdentity(id, version)).toThrow();
  });

  it("does not swallow a validator implementation error", () => {
    const failure = new Error("validator implementation failed");
    const schema = recordResponseSchema("test.throwing", 1, () => {
      throw failure;
    });

    expect(() => schema.validate({})).toThrow(failure);
  });

  describe("batchTranslationSchema", () => {
    it("trims translations and strips unknown fields", () => {
      const result = batchTranslationSchema(2).validate({
        translations: ["  第一条  ", "第二条"],
        confidence: 0.99,
      });

      expect(result).toEqual({
        success: true,
        value: { translations: ["第一条", "第二条"] },
      });
    });

    it.each([
      ["too few", ["one"]],
      ["too many", ["one", "two", "three"]],
    ])("rejects %s translations", (_case, translations) => {
      const result = batchTranslationSchema(2).validate({ translations });

      expect(result).toEqual({
        success: false,
        issues: [{ path: "translations", code: "length" }],
      });
    });

    it("rejects blank translations", () => {
      const result = batchTranslationSchema(2).validate({
        translations: ["valid", "   "],
      });

      expect(result).toEqual({
        success: false,
        issues: [{ path: "translations[1]", code: "empty" }],
      });
    });

    it("does not coerce translation values", () => {
      const result = batchTranslationSchema(1).validate({
        translations: [42],
      });

      expect(result).toEqual({
        success: false,
        issues: [{ path: "translations[0]", code: "type" }],
      });
    });

    it("rejects verbatim Japanese output and dropped numeric facts", () => {
      expect(
        batchTranslationSchema(["仮面ライダー まとめ売り 30点"]).validate({
          translations: ["仮面ライダー まとめ売り 30点"],
        }),
      ).toEqual({
        success: false,
        issues: [{ path: "translations[0]", code: "untranslated" }],
      });

      expect(
        batchTranslationSchema(["仮面ライダー 30点"]).validate({
          translations: ["假面骑士套装"],
        }),
      ).toEqual({
        success: false,
        issues: [{ path: "translations[0]", code: "numeric_fact_missing" }],
      });
    });

    it("accepts a complete translated title while retaining model numbers", () => {
      expect(
        batchTranslationSchema(["DXドライバー 30点セット"]).validate({
          translations: ["DX驱动器30件套装"],
        }),
      ).toEqual({
        success: true,
        value: { translations: ["DX驱动器30件套装"] },
      });
    });
  });

  describe("detailFragmentsSchema", () => {
    const expected = new Map([
      ["0:0", "title"],
      ["1:0", "details.description"],
    ]);

    it("returns trimmed, ordered fragments without unknown fields", () => {
      const result = detailFragmentsSchema(expected).validate({
        translations: [
          {
            fragmentKey: "1:0",
            path: "details.description",
            labelZh: "  商品说明 ",
            valueZh: "  完整说明 ",
            confidence: 0.8,
          },
          {
            fragmentKey: "0:0",
            path: "title",
            labelZh: " 标题 ",
            valueZh: " 中文标题 ",
          },
        ],
        ignored: true,
      });

      expect(result).toEqual({
        success: true,
        value: {
          translations: [
            {
              fragmentKey: "0:0",
              path: "title",
              labelZh: "标题",
              valueZh: "中文标题",
            },
            {
              fragmentKey: "1:0",
              path: "details.description",
              labelZh: "商品说明",
              valueZh: "完整说明",
            },
          ],
        },
      });
    });

    it("rejects a missing fragment", () => {
      const result = detailFragmentsSchema(expected).validate({
        translations: [
          {
            fragmentKey: "0:0",
            path: "title",
            labelZh: "标题",
            valueZh: "中文标题",
          },
        ],
      });

      expect(result).toEqual({
        success: false,
        issues: [
          { path: "translations", code: "length" },
          { path: "translations[1:0]", code: "missing_fragment" },
        ],
      });
    });

    it("rejects a duplicate fragment", () => {
      const result = detailFragmentsSchema(expected).validate({
        translations: [
          {
            fragmentKey: "0:0",
            path: "title",
            labelZh: "标题",
            valueZh: "中文标题",
          },
          {
            fragmentKey: "0:0",
            path: "title",
            labelZh: "标题",
            valueZh: "重复标题",
          },
        ],
      });

      expect(result).toEqual({
        success: false,
        issues: [
          { path: "translations[1].fragmentKey", code: "duplicate_fragment" },
          { path: "translations[1:0]", code: "missing_fragment" },
        ],
      });
    });

    it("rejects an unknown fragment", () => {
      const result = detailFragmentsSchema(expected).validate({
        translations: [
          {
            fragmentKey: "0:0",
            path: "title",
            labelZh: "标题",
            valueZh: "中文标题",
          },
          {
            fragmentKey: "9:9",
            path: "unknown",
            labelZh: "未知",
            valueZh: "未知值",
          },
        ],
      });

      expect(result).toEqual({
        success: false,
        issues: [
          { path: "translations[1].fragmentKey", code: "unknown_fragment" },
          { path: "translations[1:0]", code: "missing_fragment" },
        ],
      });
    });

    it("rejects a fragment path mismatch", () => {
      const result = detailFragmentsSchema(expected).validate({
        translations: [
          {
            fragmentKey: "0:0",
            path: "wrong.path",
            labelZh: "标题",
            valueZh: "中文标题",
          },
          {
            fragmentKey: "1:0",
            path: "details.description",
            labelZh: "商品说明",
            valueZh: "完整说明",
          },
        ],
      });

      expect(result).toEqual({
        success: false,
        issues: [{ path: "translations[0].path", code: "path_mismatch" }],
      });
    });

    it("rejects blank fragment content", () => {
      const result = detailFragmentsSchema(expected).validate({
        translations: [
          {
            fragmentKey: "0:0",
            path: "title",
            labelZh: "   ",
            valueZh: "中文标题",
          },
          {
            fragmentKey: "1:0",
            path: "details.description",
            labelZh: "商品说明",
            valueZh: "完整说明",
          },
        ],
      });

      expect(result).toEqual({
        success: false,
        issues: [{ path: "translations[0].labelZh", code: "empty" }],
      });
    });

    it("accepts a technical literal that is correctly preserved verbatim", () => {
      const technical = new Map([["0:0", "shippingStatus"]]);
      const sources = new Map([["0:0", "unknown"]]);

      expect(
        detailFragmentsSchema(technical, sources).validate({
          translations: [
            {
              fragmentKey: "0:0",
              path: "shippingStatus",
              labelZh: "配送状态",
              valueZh: "unknown",
            },
          ],
        }),
      ).toEqual({
        success: true,
        value: {
          translations: [
            {
              fragmentKey: "0:0",
              path: "shippingStatus",
              labelZh: "配送状态",
              valueZh: "unknown",
            },
          ],
        },
      });
    });

    it("still rejects a Japanese detail fragment returned untranslated", () => {
      const japanese = new Map([["0:0", "details.description"]]);
      const sources = new Map([
        ["0:0", "仮面ライダーの中古品です。付属品は写真をご確認ください。"],
      ]);

      expect(
        detailFragmentsSchema(japanese, sources).validate({
          translations: [
            {
              fragmentKey: "0:0",
              path: "details.description",
              labelZh: "商品说明",
              valueZh:
                "仮面ライダーの中古品です。付属品は写真をご確認ください。",
            },
          ],
        }),
      ).toEqual({
        success: false,
        issues: [{ path: "translations[0].valueZh", code: "untranslated" }],
      });
    });
  });
});
