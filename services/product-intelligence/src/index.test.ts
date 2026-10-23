import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  itemFindUnique: vi.fn(),
  itemUpdate: vi.fn(),
  productUpsert: vi.fn(),
  queryRaw: vi.fn(),
  reviewUpsert: vi.fn(),
}));

vi.mock("@tokusatsu/db", () => ({
  prisma: {
    item: {
      findUnique: db.itemFindUnique,
      update: db.itemUpdate,
    },
    product: {
      upsert: db.productUpsert,
      findMany: vi.fn(),
    },
    reviewQueue: { upsert: db.reviewUpsert },
    $queryRaw: db.queryRaw,
  },
  Prisma: {
    empty: {},
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: [...strings],
      values,
    }),
  },
}));

import {
  matchOrCreateProduct,
  mergeExtractionEvidence,
  resolveProductCatalogReferences,
} from "./index.js";

beforeEach(() => {
  vi.clearAllMocks();
  db.queryRaw.mockResolvedValue([]);
  db.productUpsert.mockResolvedValue({ id: "product-1" });
  db.itemUpdate.mockResolvedValue({});
  db.reviewUpsert.mockResolvedValue({});
});

describe("mergeExtractionEvidence", () => {
  it("preserves AI evidence while refreshing product matching evidence", () => {
    const aiEvidence = {
      text: { categoryIp: { value: "kamen_rider", confidence: 0.98 } },
      vision: { toyTypes: { value: ["dx_belt"], confidence: 0.96 } },
      productMatch: { decision: "review", score: 0.74 },
    };

    expect(
      mergeExtractionEvidence(aiEvidence, {
        manufacturer: { value: { key: "bandai" }, confidence: 0.9 },
        productMatch: { decision: "auto_match", score: 0.98 },
      }),
    ).toEqual({
      text: aiEvidence.text,
      vision: aiEvidence.vision,
      manufacturer: { value: { key: "bandai" }, confidence: 0.9 },
      productMatch: { decision: "auto_match", score: 0.98 },
    });
  });

  it("retains a non-object legacy payload under an explicit key", () => {
    expect(mergeExtractionEvidence(["legacy"], { productMatch: null })).toEqual(
      {
        legacy: ["legacy"],
        productMatch: null,
      },
    );
  });
});

describe("resolveProductCatalogReferences", () => {
  it("keeps Kamen Rider title evidence ahead of unrelated seller boilerplate", () => {
    const result = resolveProductCatalogReferences(
      "仮面ライダー ゼロノス ベルト",
      "ウルトラマンゼロなど多数の商品も出品しています",
    );

    expect(result.franchise?.value.key).toBe("KAMEN_RIDER");
    expect(result.series).toBeNull();
    expect(result.conflict).toBe(true);
  });

  it("derives the immutable franchise parent from a title series", () => {
    const result = resolveProductCatalogReferences(
      "ウルトラマンゼロ ソフビ",
      "仮面ライダー商品も扱うショップです",
    );

    expect(result.series?.value.key).toBe("ULTRAMAN_ZERO");
    expect(result.franchise?.value.key).toBe("ULTRAMAN");
    expect(result.conflict).toBe(false);
  });
});

describe("matchOrCreateProduct evidence retention", () => {
  it("keeps stored AI evidence when product matching runs again", async () => {
    const text = {
      categoryIp: { value: "kamen_rider", confidence: 0.98 },
    };
    db.itemFindUnique.mockResolvedValue({
      id: "item-1",
      titleRaw: "unclassified listing",
      descriptionRaw: null,
      manufacturer: "unknown",
      categoryToyType: "unknown",
      conditionGrade: "unknown",
      confidence: 0.98,
      quantityEst: null,
      needsReview: false,
      extractionEvidence: { text },
    });

    const result = await matchOrCreateProduct("item-1");

    expect(result.extractionEvidence).toEqual(
      expect.objectContaining({ text, productMatch: null }),
    );
    expect(db.itemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          extractionEvidence: expect.objectContaining({
            text,
            productMatch: null,
          }),
        }),
      }),
    );
  });
});
