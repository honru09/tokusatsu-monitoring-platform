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

  it.each([
    [
      "https://paypayfleamarket.yahoo.co.jp/item/z671469566",
      "yahoo_fleamarket",
    ],
    ["https://item.fril.jp/fb35ad389e21cc34ce20553c2112d713", "rakuma"],
    ["https://www.suruga-ya.jp/product/detail/607224616", "surugaya"],
  ])("routes supported public marketplace product URLs: %s", (value, key) => {
    expect(resolveAdapterKey(new URL(value), firecrawlHosts, false)).toBe(key);
  });

  it.each([
    "https://paypayfleamarket.yahoo.co.jp/search/DX",
    "https://fril.jp/s?query=DX",
    "https://www.suruga-ya.jp/search?search_word=DX",
  ])(
    "does not accept a marketplace search page as one product: %s",
    (value) => {
      expect(
        resolveAdapterKey(new URL(value), firecrawlHosts, false),
      ).toBeUndefined();
    },
  );

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

describe("ItemsService seller pagination", () => {
  it("returns the real seller-directory total instead of the current page length", async () => {
    const prisma = {
      seller: {
        findMany: vi.fn().mockResolvedValue([{ id: "seller-61" }]),
        count: vi.fn().mockResolvedValue(1_105),
      },
    };
    const service = new ItemsService(prisma as never);

    const result = await service.listSellers("", 3, 60);

    expect(prisma.seller.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 120, take: 60 }),
    );
    expect(result).toMatchObject({ total: 1_105, page: 3, pageCount: 19 });
  });

  it("pages through every active item from one seller", async () => {
    const rows = Array.from({ length: 48 }, (_, index) => ({
      id: `item-${index + 49}`,
    }));
    const prisma = {
      seller: {
        findUnique: vi.fn().mockResolvedValue({
          id: "seller-large",
          name: "large seller",
          source: { key: "yahoo_auctions", displayName: "Yahoo!オークション" },
          items: rows,
        }),
      },
      item: { count: vi.fn().mockResolvedValue(237) },
    };
    const service = new ItemsService(prisma as never);

    const result = await service.getSeller("seller-large", 2, 48);

    expect(prisma.seller.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          items: expect.objectContaining({ skip: 48, take: 48 }),
        }),
      }),
    );
    expect(result).toMatchObject({
      total: 237,
      page: 2,
      pageCount: 5,
      items: rows,
    });
  });
});

describe("ItemsService.purchase receipt limits", () => {
  const item = {
    id: "receipt-test-item",
    productId: null,
    quantityEst: 1,
  };

  it("accepts an image whose decoded payload is exactly 3MB", async () => {
    const receiptDataBase64 = Buffer.alloc(3 * 1024 * 1024).toString("base64");
    const tx = {
      purchaseRecord: {
        upsert: vi.fn().mockResolvedValue({ id: "purchase-1" }),
        findUnique: vi.fn().mockResolvedValue({
          id: "purchase-1",
          verifiedAt: new Date(),
          receipts: [],
        }),
      },
      purchaseReceipt: {
        create: vi.fn().mockResolvedValue({ id: "receipt-1" }),
      },
      item: { update: vi.fn().mockResolvedValue(item) },
    };
    const prisma = {
      item: { findUnique: vi.fn().mockResolvedValue(item) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new ItemsService(prisma as never);

    const result = await service.purchase(item.id, {
      purchaseAmount: 1_000,
      receiptFileName: "receipt.png",
      receiptMimeType: "image/png",
      receiptDataBase64,
    });

    expect(result.verified).toBe(true);
    expect(tx.purchaseReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sizeBytes: 3 * 1024 * 1024 }),
      }),
    );
  });

  it("rejects an image whose decoded payload exceeds 3MB", async () => {
    const prisma = {
      item: { findUnique: vi.fn().mockResolvedValue(item) },
      $transaction: vi.fn(),
    };
    const service = new ItemsService(prisma as never);

    await expect(
      service.purchase(item.id, {
        purchaseAmount: 1_000,
        receiptMimeType: "image/png",
        receiptDataBase64: Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64"),
      }),
    ).rejects.toThrow("购买凭证图片不能超过 3MB");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
