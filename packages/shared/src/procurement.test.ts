import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROCUREMENT_CONFIG,
  assessProcurementCandidate,
  compareProcurementCandidates,
  procurementConfigFromEnv,
  procurementLogisticsEvidence,
  rankProcurementCandidates,
  type ProcurementCandidate,
} from "./procurement.js";

function candidate(
  input: Partial<ProcurementCandidate> = {},
): ProcurementCandidate {
  return {
    titleRaw: "仮面ライダー 小物まとめ",
    listingType: "direct",
    categoryToyType: "gashapon",
    conditionGrade: "used",
    priceCurrent: 5_000,
    shippingFee: 0,
    quantityEst: 10,
    logistics: { volumeCm3: 8_000 },
    ...input,
  };
}

describe("procurement assessment", () => {
  it("places a candidate that is better on volume, quantity, and unit cost first", () => {
    const stronger = {
      id: "stronger",
      ...candidate({
        priceCurrent: 4_800,
        quantityEst: 12,
        logistics: { volumeCm3: 4_800 },
      }),
    };
    const weaker = {
      id: "weaker",
      ...candidate({
        priceCurrent: 9_000,
        quantityEst: 10,
        logistics: { volumeCm3: 9_000 },
      }),
    };

    const ranked = rankProcurementCandidates([weaker, stronger]);

    expect(ranked.map(({ candidate: item }) => item.id)).toEqual([
      "stronger",
      "weaker",
    ]);
    expect(compareProcurementCandidates(stronger, weaker)).toBeLessThan(0);
    expect(ranked[0].assessment.category).toBe("preferred");
    expect(ranked[1].assessment.category).toBe("preferred");
  });

  it("does not treat unknown shipping or volume as known low cost or compact", () => {
    const unknownShipping = assessProcurementCandidate(
      candidate({ shippingFee: null }),
    );
    const unknownVolume = assessProcurementCandidate(
      candidate({ categoryToyType: "figure", logistics: null }),
    );

    expect(unknownShipping.costBasis).toBe("lower_bound");
    expect(unknownShipping.category).toBe("promising");
    expect(unknownShipping.missingFacts).toContain("shipping_fee");
    expect(unknownShipping.reasons.join(" ")).toContain("不能视为最终低价");

    expect(unknownVolume.compactness).toBe("unknown");
    expect(unknownVolume.compactnessBasis).toBe("unknown");
    expect(unknownVolume.category).toBe("needs_facts");
    expect(unknownVolume.missingFacts).toContain("volume");
  });

  it("treats an active auction bid as a lower bound, never a preferred cost", () => {
    const assessment = assessProcurementCandidate(
      candidate({
        listingType: "auction",
        priceCurrent: 1,
        shippingFee: 500,
        quantityEst: 20,
        logistics: { volumeCm3: 2_000 },
      }),
    );

    expect(assessment.costBasis).toBe("lower_bound");
    expect(assessment.category).toBe("promising");
    expect(assessment.facts.join(" ")).toContain("当前竞价");
    expect(assessment.reasons.join(" ")).toContain("不能视为最终低价");
  });

  it("keeps an unknown transaction mode as an explicit missing fact", () => {
    const assessment = assessProcurementCandidate(
      candidate({ listingType: "unknown" }),
    );

    expect(assessment.costBasis).toBe("lower_bound");
    expect(assessment.category).toBe("promising");
    expect(assessment.missingFacts).toContain("listing_type");
    expect(assessment.reasons.join(" ")).toContain("成交方式未知");
  });

  it("keeps a fixed landed cost ahead of a provisional auction bargain", () => {
    const direct = {
      id: "known-direct",
      ...candidate({ quantityEst: 5, logistics: null }),
    };
    const auction = {
      id: "auction-lower-bound",
      ...candidate({
        listingType: "auction",
        priceCurrent: 1,
        shippingFee: 0,
        quantityEst: 100,
        logistics: null,
      }),
    };

    expect(
      rankProcurementCandidates([auction, direct]).map(
        ({ candidate: item }) => item.id,
      ),
    ).toEqual(["known-direct", "auction-lower-bound"]);
  });

  it("marks small collectible categories as inference, never known volume", () => {
    const assessment = assessProcurementCandidate(
      candidate({
        categoryToyType: "finger_puppet",
        logistics: null,
      }),
    );

    expect(assessment.compactness).toBe("likely_compact");
    expect(assessment.compactnessBasis).toBe("inference");
    expect(assessment.category).toBe("promising");
    expect(assessment.missingFacts).toContain("volume");
    expect(assessment.reasons.join(" ")).toContain("依据是推断");

    const miniature = assessProcurementCandidate(
      candidate({
        titleRaw: "特撮 ミニフィギュア 20体まとめ",
        categoryToyType: "figure",
        logistics: null,
      }),
    );
    expect(miniature.compactness).toBe("likely_compact");
    expect(miniature.compactnessBasis).toBe("inference");
  });

  it("deprioritizes junk and known large-volume listings", () => {
    const junk = assessProcurementCandidate(
      candidate({ conditionGrade: "junk" }),
    );
    const bulky = assessProcurementCandidate(
      candidate({ logistics: { volumeCm3: 10_001 } }),
    );

    expect(junk.category).toBe("deprioritized");
    expect(junk.reasons.join(" ")).toContain("采购风险高");
    expect(bulky.compactness).toBe("bulky");
    expect(bulky.category).toBe("deprioritized");
  });

  it("does not trust a stored volume that conflicts with complete dimensions", () => {
    const assessment = assessProcurementCandidate(
      candidate({
        logistics: {
          volumeCm3: 1_000,
          lengthMm: 1_000,
          widthMm: 1_000,
          heightMm: 1_000,
        },
      }),
    );

    expect(assessment.category).toBe("needs_facts");
    expect(assessment.compactness).toBe("unknown");
    expect(assessment.compactnessBasis).toBe("conflict");
    expect(assessment.missingFacts).toContain("volume");
    expect(assessment.reasons.join(" ")).toContain("相互冲突");
  });

  it("excludes unverified AI logistics drafts from procurement evidence", () => {
    expect(
      procurementLogisticsEvidence({
        volumeCm3: 500,
        notes: "[AI_ESTIMATE_UNVERIFIED]\n图片推测",
      }),
    ).toBeNull();
    expect(
      procurementLogisticsEvidence({ volumeCm3: 500, notes: "人工实测" }),
    ).toEqual({ volumeCm3: 500, notes: "人工实测" });
  });

  it("uses the larger volume when provided and calculated values agree within tolerance", () => {
    const assessment = assessProcurementCandidate(
      candidate({
        logistics: {
          volumeCm3: 9_900,
          lengthMm: 1_030,
          widthMm: 100,
          heightMm: 100,
        },
      }),
    );

    expect(assessment.compactness).toBe("bulky");
    expect(assessment.compactnessBasis).toBe("calculated_dimensions");
    expect(assessment.category).toBe("deprioritized");
  });

  it("keeps equal candidates in their original order", () => {
    const first = { id: "first", ...candidate() };
    const second = { id: "second", ...candidate() };

    expect(
      rankProcurementCandidates([first, second]).map(
        ({ candidate: item }) => item.id,
      ),
    ).toEqual(["first", "second"]);
  });
});

describe("procurement environment configuration", () => {
  it("accepts positive integer overrides and preserves config invariants", () => {
    expect(
      procurementConfigFromEnv({
        PROCUREMENT_MIN_QUANTITY: "12",
        PROCUREMENT_TARGET_QUANTITY: "8",
        PROCUREMENT_MAX_UNIT_COST_JPY: "750",
        PROCUREMENT_MAX_VOLUME_CM3: "9000",
        PROCUREMENT_MAX_UNIT_VOLUME_CM3: "800",
      }),
    ).toEqual({
      minQuantity: 12,
      targetQuantity: 12,
      maxUnitCostJpy: 750,
      maxVolumeCm3: 9_000,
      maxUnitVolumeCm3: 800,
    });
  });

  it("falls back for malformed, zero, negative, decimal, and unsafe values", () => {
    expect(
      procurementConfigFromEnv({
        PROCUREMENT_MIN_QUANTITY: "0",
        PROCUREMENT_TARGET_QUANTITY: "-3",
        PROCUREMENT_MAX_UNIT_COST_JPY: "cheap",
        PROCUREMENT_MAX_VOLUME_CM3: "10.5",
        PROCUREMENT_MAX_UNIT_VOLUME_CM3: "999999999999999999999",
      }),
    ).toEqual(DEFAULT_PROCUREMENT_CONFIG);
  });
});
