import { describe, expect, it } from "vitest";
import {
  classifySellerSegment,
  sellerSegmentStats,
} from "./seller-segments.js";

const items = (count: number, categoryToyType = "figure") =>
  Array.from({ length: count }, () => ({ categoryToyType }));

describe("classifySellerSegment", () => {
  it("uses an explicit public store marker before catalogue thresholds", () => {
    expect(
      classifySellerSegment({
        sellerType: "store",
        sourceKey: "yahoo_auctions",
        visibleItems: items(1),
      }),
    ).toMatchObject({ key: "professional_store", label: "专业店铺" });
  });

  it("recognizes a retailer source even when an adapter has not set sellerType", () => {
    expect(
      classifySellerSegment({
        sellerType: "unknown",
        sourceKey: "surugaya",
        sourceDisplayName: "駿河屋",
        visibleItems: items(1),
      }),
    ).toMatchObject({
      key: "professional_store",
      reasons: ["駿河屋属于公开零售商来源。"],
    });
  });

  it("classifies a large non-store catalogue as high-volume", () => {
    expect(
      classifySellerSegment({
        sellerType: "individual",
        visibleItems: items(20),
      }).key,
    ).toBe("high_volume");
  });

  it("classifies a concentrated catalogue as a specialist", () => {
    const visibleItems = [
      ...items(7, "sofubi"),
      ...items(2, "figure"),
      ...items(1, "unknown"),
    ];
    expect(
      classifySellerSegment({ sellerType: "individual", visibleItems }),
    ).toMatchObject({
      key: "specialist",
      reasons: [expect.stringContaining("7 件属于软胶")],
    });
  });

  it("keeps a varied multi-item catalogue in the active second-hand group", () => {
    expect(
      classifySellerSegment({
        sellerType: "unknown",
        visibleItems: [...items(2, "sofubi"), ...items(2, "figure")],
      }).key,
    ).toBe("active_individual");
  });

  it("does not infer a professional identity from a seller name", () => {
    expect(
      classifySellerSegment({
        sellerType: "individual",
        sourceData: {},
        visibleItems: items(1),
        // Names are intentionally not part of the classifier input.
      }).key,
    ).toBe("occasional");
  });

  it("returns all five definitions in a stable order, including zero counts", () => {
    const segments = [
      classifySellerSegment({ sellerType: "store", visibleItems: items(1) }),
      classifySellerSegment({
        sellerType: "individual",
        visibleItems: items(20),
      }),
    ];
    expect(sellerSegmentStats(segments)).toEqual([
      expect.objectContaining({ key: "professional_store", count: 1 }),
      expect.objectContaining({ key: "high_volume", count: 1 }),
      expect.objectContaining({ key: "specialist", count: 0 }),
      expect.objectContaining({ key: "active_individual", count: 0 }),
      expect.objectContaining({ key: "occasional", count: 0 }),
    ]);
  });
});
