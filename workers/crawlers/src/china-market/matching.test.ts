import { describe, expect, it } from "vitest";
import {
  AI_MATCH_ACCEPTANCE_THRESHOLD,
  acceptCandidate,
  fallbackChineseKeywords,
  robustReferencePrice,
  scoreChinaCandidate,
  validatedChineseKeywords,
} from "./matching.js";
import type { ChinaProductReference, RawChinaMarketOffer } from "./types.js";

const reference: ChinaProductReference = {
  productId: "product-1",
  canonicalName: "仮面ライダー555 DXファイズドライバー SB-555B",
  normalizedName: "仮面ライダー555 dxファイズドライバー sb 555b",
  titleZh: "假面骑士555 DX Faiz驱动器 SB-555B",
  productLine: "DX",
  modelNumber: "SB-555B",
  releaseYear: 2003,
  franchiseNames: ["假面骑士", "仮面ライダー"],
  seriesNames: ["假面骑士555", "仮面ライダー555"],
  manufacturerNames: ["万代", "BANDAI"],
  toyTypeNames: ["变身腰带", "驱动器"],
  listingTitleRaw: "仮面ライダー555 DXファイズドライバー SB-555B",
  listingTitleZh: "假面骑士555 DX Faiz驱动器 SB-555B",
  quantity: 1,
  referenceImageUrls: [],
};

function offer(
  sourceListingId: string,
  titleRaw: string,
  priceCny: number,
): RawChinaMarketOffer {
  return {
    platform: "xianyu",
    sourceListingId,
    sourceUrl: `https://www.goofish.com/item?id=${sourceListingId}`,
    titleRaw,
    priceCny,
    status: "active",
  };
}

describe("China market comparison matching", () => {
  it("creates distinct Chinese queries while preserving model identity", () => {
    const keywords = validatedChineseKeywords(
      reference,
      fallbackChineseKeywords(reference),
    );
    expect(keywords.length).toBeGreaterThanOrEqual(3);
    expect(keywords.some((value) => value.includes("sb 555b"))).toBe(true);
  });

  it("rejects non-Chinese, unanchored, marketing, and accessory queries", () => {
    expect(
      validatedChineseKeywords(reference, [
        "仮面ライダー555 DXベルト",
        "热门玩具低价包邮",
        "假面骑士555 SB-555B 仅配件",
        "完全无关中文商品",
        "假面骑士555 DX腰带 SB-555B",
      ]),
    ).toEqual(["假面骑士555 DX腰带 SB-555B"]);
    expect(
      validatedChineseKeywords(
        {
          ...reference,
          titleZh: null,
          listingTitleZh: null,
          franchiseNames: ["仮面ライダー"],
          seriesNames: ["仮面ライダー555"],
          manufacturerNames: ["BANDAI"],
          toyTypeNames: ["変身ベルト"],
        },
        ["假面骑士555 变身腰带"],
      ),
    ).toEqual([]);
  });

  it("rejects accessories and damaged listings before similarity scoring", () => {
    const result = scoreChinaCandidate(
      reference,
      offer("accessory", "假面骑士555 SB-555B 仅空盒 瑕疵品", 80),
      fallbackChineseKeywords(reference),
    );
    expect(result.excluded).toBe(true);
    expect(acceptCandidate(result).accepted).toBe(false);
    expect(
      scoreChinaCandidate(
        reference,
        offer("condition", "假面骑士555 DX SB-555B", 680),
        fallbackChineseKeywords(reference),
      ).excluded,
    ).toBe(false);
    expect(
      scoreChinaCandidate(
        reference,
        {
          ...offer("condition-damage", "假面骑士555 DX SB-555B", 680),
          conditionRaw: "瑕疵品",
        },
        fallbackChineseKeywords(reference),
      ).excluded,
    ).toBe(true);
  });

  it("does not mistake negated damage or included complete parts for exclusions", () => {
    const keywords = fallbackChineseKeywords(reference);
    expect(
      scoreChinaCandidate(
        reference,
        {
          ...offer(
            "complete-condition",
            "假面骑士555 DX Faiz驱动器 SB-555B 包装盒说明书底座齐全",
            680,
          ),
          conditionRaw: "无明显瑕疵，没有破损",
        },
        keywords,
      ).excluded,
    ).toBe(false);
    expect(
      scoreChinaCandidate(
        reference,
        offer("manual-only", "假面骑士555 SB-555B 仅说明书", 50),
        keywords,
      ).excluded,
    ).toBe(true);
    expect(
      scoreChinaCandidate(
        reference,
        offer(
          "complete-with-parts",
          "假面骑士555 DX SB-555B 本体带包装盒和说明书",
          680,
        ),
        keywords,
      ).excluded,
    ).toBe(false);
  });

  it("requires an exact model token instead of a model prefix", () => {
    const csmReference = {
      ...reference,
      canonicalName: "假面骑士 CSM-1 腰带",
      normalizedName: "假面骑士 csm 1 腰带",
      titleZh: "假面骑士 CSM-1 腰带",
      listingTitleRaw: "假面骑士 CSM-1 腰带",
      listingTitleZh: "假面骑士 CSM-1 腰带",
      modelNumber: "CSM-1",
    };
    const prefix = scoreChinaCandidate(
      csmReference,
      offer("model-prefix", "假面骑士 CSM-10 腰带", 680),
      fallbackChineseKeywords(csmReference),
    );
    expect(prefix.factors.modelNumber).toBe(0);
    expect(acceptCandidate(prefix).accepted).toBe(false);

    const conflictingSuffix = scoreChinaCandidate(
      reference,
      offer("model-suffix", "假面骑士555 DX Faiz驱动器 SB-555C 变身腰带", 680),
      fallbackChineseKeywords(reference),
    );
    expect(conflictingSuffix.factors.modelNumber).toBe(0);
    expect(acceptCandidate(conflictingSuffix).accepted).toBe(false);
  });

  it("rejects explicit quantity conflicts and placeholder prices", () => {
    const keywords = fallbackChineseKeywords(reference);
    expect(
      scoreChinaCandidate(
        reference,
        offer(
          "quantity-conflict",
          "假面骑士555 DX Faiz驱动器 SB-555B 两个套装",
          680,
        ),
        keywords,
      ).excluded,
    ).toBe(true);
    expect(
      scoreChinaCandidate(
        reference,
        offer(
          "placeholder-price",
          "假面骑士555 DX Faiz驱动器 SB-555B 标价非实价请勿拍",
          99,
        ),
        keywords,
      ).excluded,
    ).toBe(true);
  });

  it("excludes ads, auctions, rentals, services, and recruitment listings", () => {
    const keywords = fallbackChineseKeywords(reference);
    for (const candidate of [
      {
        ...offer("ad-row", "假面骑士555 DX SB-555B", 680),
        sourceData: { isAd: true },
      },
      {
        ...offer("auction-row", "假面骑士555 DX SB-555B", 680),
        sourceData: { isAuction: true },
      },
      offer("rental-row", "假面骑士555 DX SB-555B 腰带租赁", 68),
      {
        ...offer("service-row", "假面骑士555 DX SB-555B", 68),
        sourceData: { listingType: "维修服务" },
      },
      offer("job-row", "假面骑士555 DX SB-555B 摄影兼职招聘", 68),
    ]) {
      expect(scoreChinaCandidate(reference, candidate, keywords).excluded).toBe(
        true,
      );
    }
  });

  it("only accepts a deterministic fallback with an exact model and very high score", () => {
    const result = scoreChinaCandidate(
      reference,
      offer("same", "万代 假面骑士555 DX Faiz驱动器 SB-555B 变身腰带", 680),
      fallbackChineseKeywords(reference),
    );
    expect(result.factors.modelNumber).toBe(1);
    expect(acceptCandidate(result).accepted).toBe(result.score >= 0.92);
  });

  it("requires the documented conservative threshold for AI-assisted matches", () => {
    const deterministic = scoreChinaCandidate(
      reference,
      offer("same-ai", "假面骑士555 DX Faiz驱动器 SB-555B", 680),
      fallbackChineseKeywords(reference),
    );
    const accepted = acceptCandidate(deterministic, {
      sourceListingId: "same-ai",
      sameProduct: true,
      confidence: 1,
      evidence: ["型号一致"],
    });
    expect(AI_MATCH_ACCEPTANCE_THRESHOLD).toBe(0.85);
    expect(accepted.confidence).toBeGreaterThanOrEqual(
      AI_MATCH_ACCEPTANCE_THRESHOLD,
    );
    expect(accepted.accepted).toBe(true);

    const borderline = acceptCandidate(deterministic, {
      sourceListingId: "same-ai",
      sameProduct: true,
      // Keep the deterministic score contribution fixed and lower the model
      // judgment until the combined score is just below the threshold.
      confidence: 0.7,
      evidence: [],
    });
    expect(borderline.confidence).toBeLessThan(AI_MATCH_ACCEPTANCE_THRESHOLD);
    expect(borderline.accepted).toBe(false);

    expect(
      acceptCandidate(deterministic, {
        sourceListingId: "same-ai",
        sameProduct: true,
        confidence: 1,
        versionConflict: true,
        evidence: ["版本不同"],
      }).accepted,
    ).toBe(false);
  });

  it("keeps SHF and S.I.C. evidence in separate comparable markets", () => {
    const shfReference: ChinaProductReference = {
      ...reference,
      titleZh: "假面骑士空我 SHF 真骨雕",
      listingTitleZh: "假面骑士空我 SHF 真骨雕 初版 日版 全新未拆",
      categoryIp: "kamen_rider",
      collectibleSeries: "shf",
      shfLine: "shinkocchou",
      shfEdition: "first",
      shfRegion: "japanese",
      conditionGrade: "new_sealed",
      modelNumber: null,
    };
    const keywords = fallbackChineseKeywords(shfReference);
    expect(keywords.some((value) => value.includes("shf"))).toBe(true);
    expect(
      scoreChinaCandidate(
        shfReference,
        offer("sic", "假面骑士空我 S.I.C. 初版 日版 全新未拆", 500),
        keywords,
      ).excluded,
    ).toBe(true);
    expect(
      scoreChinaCandidate(
        shfReference,
        offer("standard", "假面骑士空我 SHF 普通版 初版 日版 全新未拆", 500),
        keywords,
      ).excluded,
    ).toBe(true);
    expect(
      scoreChinaCandidate(
        shfReference,
        offer("same-line", "假面骑士空我 SHF 真骨雕 初版 日版 全新未拆", 500),
        keywords,
      ).excluded,
    ).toBe(false);
  });

  it("rejects cross-IP, edition, region, quantity, and condition conflicts", () => {
    const shfReference: ChinaProductReference = {
      ...reference,
      titleZh: "奥特曼赛罗 SHF",
      listingTitleZh: "奥特曼赛罗 SHF 初版 日版 全新未拆 两个套装",
      categoryIp: "ultraman",
      collectibleSeries: "shf",
      shfLine: "standard",
      shfEdition: "first",
      shfRegion: "japanese",
      conditionGrade: "new_sealed",
      quantity: 2,
      modelNumber: null,
    };
    const keywords = fallbackChineseKeywords(shfReference);
    for (const candidate of [
      "假面骑士赛罗 SHF 初版 日版 全新未拆 两个套装",
      "奥特曼赛罗 SHF 再版 日版 全新未拆 两个套装",
      "奥特曼赛罗 SHF 初版 代理版 全新未拆 两个套装",
      "奥特曼赛罗 SHF 初版 日版 拆摆 两个套装",
      "奥特曼赛罗 SHF 初版 日版 全新未拆 一个",
      "奥特曼赛罗 SHF 初版 日版 全新未拆",
    ]) {
      expect(
        scoreChinaCandidate(
          shfReference,
          offer(candidate, candidate, 500),
          keywords,
        ).excluded,
        candidate,
      ).toBe(true);
    }
  });

  it("uses the retained median and removes an extreme price", () => {
    const result = robustReferencePrice([
      { ...offer("1", "same", 600), matchConfidence: 0.9 },
      { ...offer("2", "same", 620), matchConfidence: 0.9 },
      { ...offer("3", "same", 640), matchConfidence: 0.9 },
      { ...offer("4", "same", 9999), matchConfidence: 0.9 },
    ]);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.referencePriceCny).toBe(620);
      expect(result.retained).toHaveLength(3);
      expect(result.representative.sourceListingId).toBe("2");
    }
  });

  it("does not invent a reference price from one sample", () => {
    expect(
      robustReferencePrice([
        { ...offer("1", "same", 600), matchConfidence: 0.9 },
      ]).status,
    ).toBe("insufficient");
  });

  it("requires three active samples and excludes unknown availability", () => {
    expect(
      robustReferencePrice([
        { ...offer("1", "same", 600), matchConfidence: 0.9 },
        { ...offer("2", "same", 620), matchConfidence: 0.9 },
      ]).status,
    ).toBe("insufficient");
    expect(
      robustReferencePrice([
        { ...offer("1", "same", 600), matchConfidence: 0.9 },
        { ...offer("2", "same", 620), matchConfidence: 0.9 },
        {
          ...offer("3", "same", 640),
          status: "unknown",
          matchConfidence: 0.9,
        },
      ]).status,
    ).toBe("insufficient");
  });

  it("counts one marketplace listing only once across repeated queries", () => {
    expect(
      robustReferencePrice([
        { ...offer("same-id", "same", 600), matchConfidence: 0.9 },
        { ...offer("same-id", "same", 600), matchConfidence: 0.95 },
        { ...offer("second", "same", 620), matchConfidence: 0.9 },
      ]).status,
    ).toBe("insufficient");
  });

  it("lets an explicit terminal state veto an active duplicate in either order", () => {
    const stableActiveRows = [
      { ...offer("stable-1", "same", 600), matchConfidence: 0.9 },
      { ...offer("stable-2", "same", 640), matchConfidence: 0.9 },
      { ...offer("stable-3", "same", 680), matchConfidence: 0.9 },
    ];
    const activeDuplicate = {
      ...offer("terminal-duplicate", "same", 620),
      matchConfidence: 0.99,
    };

    for (const terminalStatus of ["sold", "ended"] as const) {
      const terminalDuplicate = {
        ...activeDuplicate,
        status: terminalStatus,
      };
      for (const duplicates of [
        [activeDuplicate, terminalDuplicate],
        [terminalDuplicate, activeDuplicate],
      ]) {
        const result = robustReferencePrice([
          ...stableActiveRows,
          ...duplicates,
        ]);
        expect(result.status).toBe("ready");
        if (result.status === "ready") {
          expect(result.retained).toHaveLength(3);
          expect(
            result.retained.some(
              ({ sourceListingId }) => sourceListingId === "terminal-duplicate",
            ),
          ).toBe(false);
        }
      }
    }
  });

  it("quarantines conflicting active facts for one listing id", () => {
    expect(
      robustReferencePrice([
        { ...offer("stable-1", "same", 600), matchConfidence: 0.9 },
        { ...offer("stable-2", "same", 640), matchConfidence: 0.9 },
        { ...offer("conflict", "same", 620), matchConfidence: 0.95 },
        { ...offer("conflict", "same", 660), matchConfidence: 0.95 },
      ]).status,
    ).toBe("insufficient");
  });

  it("publishes the price of the representative listing, not an invented midpoint", () => {
    const result = robustReferencePrice([
      { ...offer("1", "same", 600), matchConfidence: 0.91 },
      { ...offer("2", "same", 620), matchConfidence: 0.95 },
      { ...offer("3", "same", 640), matchConfidence: 0.9 },
      { ...offer("4", "same", 660), matchConfidence: 0.89 },
    ]);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.referencePriceCny).toBe(result.representative.priceCny);
      expect(result.referencePriceCny).toBe(620);
    }
  });

  it("uses stable listing identity for an exact price-distance and confidence tie", () => {
    const rows = [
      { ...offer("edge-low", "same", 600), matchConfidence: 0.9 },
      { ...offer("zulu-low", "same", 620), matchConfidence: 0.9 },
      { ...offer("alpha-high", "same", 640), matchConfidence: 0.9 },
      { ...offer("edge-high", "same", 660), matchConfidence: 0.9 },
    ];
    const inputOrders = [
      rows,
      [...rows].reverse(),
      [rows[2]!, rows[0]!, rows[3]!, rows[1]!],
      [rows[1]!, rows[3]!, rows[0]!, rows[2]!],
    ];

    for (const input of inputOrders) {
      const result = robustReferencePrice(input);
      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.representative.sourceListingId).toBe("alpha-high");
        expect(result.representative.sourceUrl).toBe(
          "https://www.goofish.com/item?id=alpha-high",
        );
        expect(result.referencePriceCny).toBe(640);
      }
    }
  });

  it("does not let two widely separated prices create a false median", () => {
    const result = robustReferencePrice([
      { ...offer("low", "same", 600), matchConfidence: 0.9 },
      { ...offer("outlier", "same", 9_999), matchConfidence: 0.9 },
    ]);
    expect(result.status).toBe("insufficient");
  });
});
