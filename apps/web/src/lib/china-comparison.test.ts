import { describe, expect, it } from "vitest";
import { chinaComparisonSummary } from "./china-comparison";

const DAY = 86_400_000;

function ready(overrides: Record<string, unknown> = {}) {
  const observedAt = new Date();
  return {
    status: "ready",
    source: { key: "xianyu", displayName: "闲鱼" },
    referencePriceCny: 268,
    referenceUrl: "https://www.goofish.com/item?id=offer-123&track=x",
    observedAt: observedAt.toISOString(),
    expiresAt: new Date(observedAt.getTime() + DAY).toISOString(),
    ...overrides,
  };
}

describe("china comparison evidence", () => {
  it("returns one atomic verified evidence tuple", () => {
    expect(chinaComparisonSummary({ chinaComparison: ready() })).toMatchObject({
      platformName: "闲鱼",
      priceCny: 268,
      sourceUrl: "https://www.goofish.com/item?id=offer-123",
    });
  });

  it.each([
    { status: "failed" },
    { source: { key: "taobao", displayName: "淘宝" } },
    { referenceUrl: "https://example.com/item/1" },
    { expiresAt: new Date(Date.now() - 1).toISOString() },
    { referencePriceCny: Number.NaN },
  ])("does not expose a partial or stale comparison", (overrides) => {
    expect(
      chinaComparisonSummary({ chinaComparison: ready(overrides) }),
    ).toMatchObject({ priceCny: null, sourceUrl: null, offers: [] });
  });
});
