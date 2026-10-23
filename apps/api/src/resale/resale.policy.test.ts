import { describe, expect, it } from "vitest";
import {
  approvalBlockReason,
  chinaDayStart,
  sourceBlockReason,
  suggestedResalePrice,
  validGoofishUrl,
} from "./resale.policy.js";

const now = new Date("2026-10-09T02:00:00Z");
const source = {
  status: "active" as const,
  archivedAt: null,
  ignored: false,
  listingType: "direct" as const,
  lastSeenAt: now,
  priceCurrent: 1000,
  shippingFee: null,
};
const listing = { sourcePriceJpy: 1000, sourceShippingJpy: null };

describe("resale publication eligibility", () => {
  it.each(["sold", "ended", "reserved", "unknown"] as const)(
    "blocks an unavailable or unverified %s source",
    (status) => {
      expect(
        sourceBlockReason({ ...source, status }, listing, 10, now),
      ).toBeTruthy();
    },
  );
  it("blocks changed Japanese shipping even when the headline price did not change", () => {
    expect(
      sourceBlockReason({ ...source, shippingFee: 700 }, listing, 10, now),
    ).toContain("邮费");
  });
  it("does not turn a stale observation into sold evidence", () => {
    expect(
      sourceBlockReason(
        { ...source, lastSeenAt: new Date(now.getTime() - 11 * 60_000) },
        listing,
        10,
        now,
      ),
    ).toContain("过期");
    expect(source.status).toBe("active");
  });
  it("blocks auctions and archived sources", () => {
    expect(
      sourceBlockReason(
        { ...source, listingType: "auction" },
        listing,
        10,
        now,
      ),
    ).toBeTruthy();
    expect(
      sourceBlockReason({ ...source, archivedAt: now }, listing, 10, now),
    ).toBeTruthy();
  });
  it("requires image usage and fulfillment confirmation", () => {
    const draft = {
      title: "二手商品",
      description: "缺少一个配件",
      priceCny: 80,
      imageUrls: ["https://example.com/image.jpg"],
      deliveryText: "预计两周，需先采购",
      rightsConfirmed: true,
      fulfillmentConfirmed: true,
    };
    expect(approvalBlockReason(draft)).toBeNull();
    expect(
      approvalBlockReason({ ...draft, rightsConfirmed: false }),
    ).toBeTruthy();
    expect(
      approvalBlockReason({ ...draft, fulfillmentConfirmed: false }),
    ).toBeTruthy();
    expect(approvalBlockReason({ ...draft, deliveryText: "" })).toBeTruthy();
  });
  it("uses total known Japanese cost and rounds Chinese price to cents", () => {
    expect(
      suggestedResalePrice(
        { priceCurrent: 1000, shippingFee: 700 },
        { exchangeRate: 0.05, extraCostCny: 20, markupPercent: 30 },
      ),
    ).toBe(136.5);
  });
  it("counts daily capacity by the China calendar day", () => {
    expect(chinaDayStart(new Date("2026-10-08T16:01:00Z")).toISOString()).toBe(
      "2026-10-08T16:00:00.000Z",
    );
  });
  it("rejects credential-bearing or lookalike result URLs", () => {
    expect(validGoofishUrl("https://www.goofish.com/item?id=123")).toBe(true);
    expect(
      validGoofishUrl("https://www.goofish.com.evil.test/item?id=123"),
    ).toBe(false);
    expect(
      validGoofishUrl("https://user:secret@www.goofish.com/item?id=123"),
    ).toBe(false);
  });
});
