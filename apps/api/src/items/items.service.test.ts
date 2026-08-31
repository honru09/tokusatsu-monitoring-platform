import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { validate } from "class-validator";
import {
  CreatePurchaseBundleDto,
  ListItemsQuery,
  UpdateItemDto,
} from "./items.dto.js";
import {
  ItemsService,
  normalizePurchaseMembers,
  resolveAdapterKey,
} from "./items.service.js";

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

  it("sorts a fully filtered page by price without losing pagination", async () => {
    const prisma = {
      item: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const service = new ItemsService(prisma as never);

    await service.list({
      favorite: true,
      listingType: "direct",
      sortBy: "price",
      sortOrder: "desc",
      limit: 20,
      offset: 60,
    } as ListItemsQuery);

    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          favorite: true,
          listingType: "direct",
        }),
        orderBy: [
          { priceCurrent: "desc" },
          { detectedAt: "desc" },
          { id: "asc" },
        ],
        skip: 60,
        take: 20,
      }),
    );
  });

  it("uses minute precision for closing auctions and supports deadline ordering", async () => {
    const prisma = {
      item: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const service = new ItemsService(prisma as never);
    const before = Date.now();

    await service.list({
      listingType: "auction",
      auctionMinutes: 30,
      auctionHours: 12,
      sortBy: "auctionEndAt",
      sortOrder: "asc",
      limit: 30,
      offset: 0,
    } as ListItemsQuery);

    const call = prisma.item.findMany.mock.calls[0][0];
    expect(call.where.listingType).toBe("auction");
    expect(call.where.auctionEndAt.gt.getTime()).toBeGreaterThanOrEqual(before);
    expect(call.where.auctionEndAt.lte.getTime()).toBeGreaterThanOrEqual(
      before + 30 * 60_000,
    );
    expect(call.where.auctionEndAt.lte.getTime()).toBeLessThan(
      before + 30 * 60_000 + 2_000,
    );
    expect(call.orderBy).toEqual([
      { auctionEndAt: { sort: "asc", nulls: "last" } },
      { detectedAt: "desc" },
      { id: "asc" },
    ]);
  });
});

describe("UpdateItemDto note validation", () => {
  it("accepts 25 characters and rejects 26", async () => {
    const accepted = Object.assign(new UpdateItemDto(), {
      note: "购".repeat(25),
    });
    const rejected = Object.assign(new UpdateItemDto(), {
      note: "购".repeat(26),
    });

    expect(await validate(accepted)).toHaveLength(0);
    expect(await validate(rejected)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: "note" })]),
    );
  });
});

describe("ItemsService collaborative states", () => {
  it("moves an item into the shared ignored warehouse without deleting it", async () => {
    const current = {
      id: "ignored-item",
      favorite: true,
      ignored: false,
      ignoredAt: null,
      note: null,
      quantityEst: 1,
      priceTotalEst: 1_000,
      needsReview: false,
    };
    const tx = {
      item: {
        update: vi.fn().mockImplementation(({ data }) => ({
          ...current,
          ...data,
          updatedAt: new Date(),
        })),
      },
      manualReview: { create: vi.fn().mockResolvedValue({}) },
      reviewQueue: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      item: { findUnique: vi.fn().mockResolvedValue(current) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new ItemsService(prisma as never);

    await service.update("ignored-item", { ignored: true });

    expect(tx.item.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ignored-item" },
        data: expect.objectContaining({
          ignored: true,
          ignoredAt: expect.any(Date),
          favorite: false,
        }),
      }),
    );
    expect(prisma.item).not.toHaveProperty("delete");
  });

  it("rejects a direct service call whose procurement note exceeds 25 characters", async () => {
    const prisma = {
      item: {
        findUnique: vi.fn().mockResolvedValue({ id: "item-1" }),
      },
    };
    const service = new ItemsService(prisma as never);

    await expect(
      service.update("item-1", { note: "购".repeat(26) }),
    ).rejects.toThrow("采购备注不能超过 25 个字符");
  });
});

describe("ItemsService seller pagination", () => {
  const sellerRow = (
    id: string,
    sellerType: "individual" | "store" | "unknown" = "individual",
    categoryToyTypes = ["figure"],
  ) => ({
    id,
    name: id,
    sellerType,
    locationText: null,
    sourceData: null,
    profileUrl: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    source: { key: "yahoo_auctions", displayName: "Yahoo!オークション" },
    items: categoryToyTypes.map((categoryToyType) => ({ categoryToyType })),
  });

  it("returns the real seller-directory total and paginates after classification", async () => {
    const rows = Array.from({ length: 1_105 }, (_, index) =>
      sellerRow(`seller-${index + 1}`),
    );
    const prisma = {
      seller: {
        findMany: vi.fn().mockResolvedValue(rows),
      },
    };
    const service = new ItemsService(prisma as never);

    const result = await service.listSellers("", 3, 60);

    expect(result).toMatchObject({ total: 1_105, page: 3, pageCount: 19 });
    expect(result.sellers[0]).toMatchObject({ id: "seller-121" });
    expect(result.sellers).toHaveLength(60);
    expect(result.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "occasional", count: 1_105 }),
      ]),
    );
  });

  it("filters by one segment while returning counts and descriptions for every group", async () => {
    const rows = [
      sellerRow("store", "store"),
      sellerRow("volume", "individual", Array(20).fill("figure")),
      sellerRow("specialist", "individual", Array(4).fill("sofubi")),
      sellerRow("active", "individual", ["figure", "sofubi"]),
      sellerRow("occasional", "unknown"),
    ];
    const prisma = { seller: { findMany: vi.fn().mockResolvedValue(rows) } };
    const service = new ItemsService(prisma as never);

    const result = await service.listSellers("", 1, 60, "specialist");

    expect(result).toMatchObject({
      total: 1,
      activeSegment: "specialist",
      sellers: [
        expect.objectContaining({
          id: "specialist",
          segment: expect.objectContaining({ key: "specialist" }),
        }),
      ],
      segments: [
        expect.objectContaining({ key: "professional_store", count: 1 }),
        expect.objectContaining({ key: "high_volume", count: 1 }),
        expect.objectContaining({ key: "specialist", count: 1 }),
        expect.objectContaining({ key: "active_individual", count: 1 }),
        expect.objectContaining({ key: "occasional", count: 1 }),
      ],
    });
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
      item: {
        findMany: vi.fn().mockResolvedValue(
          Array.from({ length: 237 }, () => ({
            categoryToyType: "figure",
          })),
        ),
      },
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
      seller: expect.objectContaining({
        segment: expect.objectContaining({ key: "high_volume" }),
      }),
    });
  });
});

describe("purchase bundle pricing contract", () => {
  it("computes per-item totals and rejects a mismatching explicit total", () => {
    expect(
      normalizePurchaseMembers(
        [
          { itemId: "item-a", amountYen: 400 },
          { itemId: "item-b", amountYen: 600 },
        ],
        "per_item",
      ),
    ).toMatchObject({ totalPurchaseAmountYen: 1_000, amountAllocated: true });
    expect(() =>
      normalizePurchaseMembers(
        [
          { itemId: "item-a", amountYen: 400 },
          { itemId: "item-b", amountYen: 600 },
        ],
        "per_item",
        999,
      ),
    ).toThrow("批次总价必须等于全部商品单价之和");
  });

  it("keeps package totals authoritative and unallocated", () => {
    expect(
      normalizePurchaseMembers(
        [{ itemId: "item-a" }, { itemId: "item-b" }],
        "bundle_total",
        1_800,
      ),
    ).toMatchObject({ totalPurchaseAmountYen: 1_800, amountAllocated: false });
    expect(() =>
      normalizePurchaseMembers(
        [{ itemId: "item-a", amountYen: 900 }],
        "bundle_total",
        1_800,
      ),
    ).toThrow("打包总价模式不分摊单品金额");
  });

  it("validates nested member prices in the create DTO", async () => {
    const dto = Object.assign(new CreatePurchaseBundleDto(), {
      pricingMode: "per_item",
      members: [{ itemId: "item-a", amountYen: -1 }],
      actor: "wangxr",
      reason: "登记购买",
    });
    const errors = await validate(dto);
    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: "members" })]),
    );
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
    const now = new Date("2026-08-31T00:00:00Z");
    const purchase = {
      id: "purchase-1",
      itemId: item.id,
      bundleId: "bundle-1",
      purchaseAmount: 1_000,
      amountAllocated: true,
      purchasedAt: now,
      note: null,
      verifiedAt: now,
      createdAt: now,
    };
    const tx = {
      purchaseBundle: {
        create: vi.fn().mockResolvedValue({ id: "bundle-1" }),
        findUnique: vi.fn().mockResolvedValue({
          id: "bundle-1",
          version: 1,
          pricingMode: "per_item",
          totalPurchaseAmount: 1_000,
          currency: "JPY",
          purchasedAt: now,
          note: null,
          archivedAt: null,
          purchases: [purchase],
        }),
      },
      purchaseRecord: {
        create: vi.fn().mockResolvedValue(purchase),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...purchase,
          receipts: [],
        }),
      },
      purchaseBundleAudit: {
        create: vi.fn().mockResolvedValue({ id: "audit-1" }),
      },
      purchaseReceipt: {
        create: vi.fn().mockResolvedValue({ id: "receipt-1" }),
      },
      item: {
        findUnique: vi.fn().mockResolvedValue({
          ...item,
          purchaseRecord: null,
        }),
        update: vi.fn().mockResolvedValue(item),
      },
    };
    const prisma = {
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
