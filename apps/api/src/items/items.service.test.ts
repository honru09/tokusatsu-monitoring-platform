import { describe, expect, it, vi } from "vitest";
import type { ListItemsQuery } from "./items.dto.js";
import { ItemsService, resolveAdapterKey } from "./items.service.js";

describe("resolveAdapterKey", () => {
  const firecrawlHosts = new Set(["item.fril.jp"]);

  it.each([
    "https://auctions.yahoo.co.jp/jp/auction/g1241924961",
    "https://page.auctions.yahoo.co.jp/jp/auction/g1241924961",
  ])("accepts current and legacy Yahoo Auctions product URLs: %s", (value) => {
    expect(resolveAdapterKey(new URL(value), firecrawlHosts, false)).toBe(
      "yahoo_auctions",
    );
  });

  it("does not treat a Yahoo search page as a product detail", () => {
    expect(
      resolveAdapterKey(
        new URL("https://auctions.yahoo.co.jp/search/search?p=DX"),
        firecrawlHosts,
        false,
      ),
    ).toBeUndefined();
  });

  it("uses Firecrawl only for configured hosts when a key is present", () => {
    const url = new URL("https://item.fril.jp/example-item");
    expect(resolveAdapterKey(url, firecrawlHosts, false)).toBeUndefined();
    expect(resolveAdapterKey(url, firecrawlHosts, true)).toBe(
      "firecrawl_market",
    );
  });

  it("falls back to the safe public-page adapter for other HTTPS product pages", () => {
    expect(
      resolveAdapterKey(
        new URL("https://shop.example.jp/item/123"),
        firecrawlHosts,
        false,
      ),
    ).toBe("public_page");
  });
});

describe("ItemsService.list", () => {
  it("filters one listing type while returning full-dataset auction/direct facets", async () => {
    const prisma = {
      item: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi
          .fn()
          .mockResolvedValueOnce(37)
          .mockResolvedValueOnce(37)
          .mockResolvedValueOnce(2_941),
      },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const service = new ItemsService(prisma as never);

    const result = await service.list({
      listingType: "auction",
      limit: 40,
      offset: 0,
    } as ListItemsQuery);

    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ listingType: "auction" }),
      }),
    );
    expect(prisma.item.count).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ listingType: "auction" }),
      }),
    );
    expect(prisma.item.count).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({ listingType: "direct" }),
      }),
    );
    expect(result).toMatchObject({
      total: 37,
      facets: { auction: 37, direct: 2_941 },
    });
  });
});
