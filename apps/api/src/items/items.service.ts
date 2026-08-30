import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CategoryIp,
  ConditionGrade,
  ListingType,
  Manufacturer,
  Prisma,
  SourceChannel,
  ToyType,
} from "@tokusatsu/db";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { PrismaService } from "../prisma.service.js";
import type {
  ListItemsQuery,
  PurchaseDto,
  UpdateItemDto,
} from "./items.dto.js";
import {
  classifySellerSegment,
  sellerSegmentKeys,
  sellerSegmentStats,
  type SellerSegmentKey,
} from "./seller-segments.js";

const include = {
  source: { select: { key: true, displayName: true } },
  seller: {
    select: {
      id: true,
      name: true,
      sellerType: true,
      locationText: true,
      profileUrl: true,
      sourceData: true,
    },
  },
  images: { orderBy: { position: "asc" as const } },
  logistics: true,
  priceHistory: { orderBy: { observedAt: "desc" as const }, take: 8 },
  purchaseRecord: {
    include: {
      receipts: {
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
      },
    },
  },
  product: {
    include: {
      franchise: true,
      series: true,
      manufacturerEntity: true,
      toyTypeEntity: true,
      inventory: true,
      _count: { select: { listings: true } },
    },
  },
};

// Used by the collaborative dashboard sync path. Keeping this projection
// deliberately small avoids reloading image galleries, price history and
// purchase receipts when another operator only changes a favorite or note.
const syncSelect = {
  id: true,
  favorite: true,
  ignored: true,
  ignoredAt: true,
  archivedAt: true,
  note: true,
  updatedAt: true,
} satisfies Prisma.ItemSelect;

const sourceLabels: Record<string, string> = {
  mandarake: "Mandarake",
  mercari: "Mercari",
  yahoo_auctions: "Yahoo!オークション",
  yahoo_fleamarket: "Yahoo!フリマ",
  yahoo_shopping: "Yahoo!ショッピング",
  rakuma: "ラクマ",
  surugaya: "駿河屋",
  firecrawl_market: "Firecrawl",
  apify_ecommerce: "Apify",
  playwright_page: "Playwright",
  public_page: "网页来源",
  mock: "本地测试来源",
};

function sourceDisplayName(
  key: string,
  fallback: string,
  sourceData: Prisma.JsonValue | null,
) {
  if (
    ![
      "firecrawl_market",
      "apify_ecommerce",
      "public_page",
      "playwright_page",
    ].includes(key)
  ) {
    return sourceLabels[key] ?? fallback;
  }
  if (
    sourceData &&
    typeof sourceData === "object" &&
    !Array.isArray(sourceData)
  ) {
    const value = sourceData as Prisma.JsonObject;
    const marketplaceName = value.marketplaceName;
    const marketplaceHost = value.marketplaceHost;
    if (typeof marketplaceName === "string" && marketplaceName.trim())
      return marketplaceName.trim();
    if (typeof marketplaceHost === "string" && marketplaceHost.trim())
      return marketplaceHost.trim();
  }
  return sourceLabels[key] ?? fallback;
}

export function resolveAdapterKey(
  url: URL,
  firecrawlHosts: Set<string>,
  firecrawlConfigured: boolean,
) {
  const host = url.hostname.toLowerCase();
  if (host.endsWith("mandarake.co.jp")) return "mandarake";
  if (host === "example.com") return "mock";
  if (
    host === "shopping.yahoo.co.jp" ||
    host.endsWith(".shopping.yahoo.co.jp") ||
    host === "store.shopping.yahoo.co.jp"
  )
    return process.env.YAHOO_SHOPPING_CLIENT_ID?.trim()
      ? "yahoo_shopping"
      : firecrawlConfigured && firecrawlHosts.has(host)
        ? "firecrawl_market"
        : "public_page";
  if (host === "jp.mercari.com" || host.endsWith(".mercari.com"))
    return "mercari";
  if (
    ["auctions.yahoo.co.jp", "page.auctions.yahoo.co.jp"].includes(host) &&
    /^\/jp\/auction\/[a-z0-9]+\/?$/i.test(url.pathname)
  )
    return "yahoo_auctions";
  if (["auctions.yahoo.co.jp", "page.auctions.yahoo.co.jp"].includes(host))
    return undefined;
  if (
    host === "paypayfleamarket.yahoo.co.jp" &&
    /^\/item\/z\d+\/?$/i.test(url.pathname)
  )
    return "yahoo_fleamarket";
  if (host === "paypayfleamarket.yahoo.co.jp")
    return firecrawlConfigured && firecrawlHosts.has(host)
      ? "firecrawl_market"
      : undefined;
  if (host === "item.fril.jp" && /^\/[a-f0-9]{20,64}\/?$/i.test(url.pathname))
    return "rakuma";
  if (host === "fril.jp" || host === "item.fril.jp")
    return firecrawlConfigured && firecrawlHosts.has(host)
      ? "firecrawl_market"
      : undefined;
  if (
    host === "www.suruga-ya.jp" &&
    /^\/product\/(?:detail|other)\/\d+\/?$/i.test(url.pathname)
  )
    return "surugaya";
  if (host === "www.suruga-ya.jp")
    return firecrawlConfigured && firecrawlHosts.has(host)
      ? "firecrawl_market"
      : undefined;
  if (
    host.endsWith("mandarake.co.jp") ||
    host === "jp.mercari.com" ||
    host.endsWith(".mercari.com")
  )
    return undefined;
  const allowAnyFirecrawl = process.env.FIRECRAWL_ALLOW_ANY_DOMAIN === "true";
  if (firecrawlHosts.has(host))
    return firecrawlConfigured ? "firecrawl_market" : undefined;
  if (firecrawlConfigured && allowAnyFirecrawl) return "firecrawl_market";
  if (url.protocol === "https:") return "public_page";
  return undefined;
}

@Injectable()
export class ItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async analyzeUrl(rawUrl: string) {
    let url: URL;
    try {
      url = new URL(rawUrl.trim());
    } catch {
      return { accepted: false, error: "请输入完整商品 URL（包含 https://）" };
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      return { accepted: false, error: "仅支持 http/https 商品链接" };
    }
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      /^(10|127)\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    ) {
      return { accepted: false, error: "出于安全原因不支持本地或内网地址" };
    }
    const firecrawlHosts = new Set(
      (process.env.FIRECRAWL_INCLUDE_DOMAINS ?? "")
        .split(",")
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    );
    const adapterKey = resolveAdapterKey(
      url,
      firecrawlHosts,
      Boolean(process.env.FIRECRAWL_API_KEY),
    );
    if (!adapterKey) {
      return {
        accepted: false,
        error:
          "无法识别此链接。请使用公开商品页，或在服务端配置通用网页分析来源。",
      };
    }
    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
    const queue = new Queue("url-analysis", { connection: redis });
    const importRecord = await this.prisma.urlImport.create({
      data: {
        sourceUrl: url.toString(),
        adapterKey,
        status: "queued",
        progress: 0,
        currentStep: "已排队",
      },
    });
    const job = await queue.add(
      "analyze-url",
      { adapterKey, sourceUrl: url.toString(), importId: importRecord.id },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    await this.prisma.urlImport.update({
      where: { id: importRecord.id },
      data: { queueJobId: String(job.id) },
    });
    await queue.close();
    await redis.quit();
    return {
      accepted: true,
      jobId: job.id,
      importId: importRecord.id,
      adapter: adapterKey,
      message: "链接已加入分析队列，完成后会进入链接专区。",
    };
  }

  async list(query: ListItemsQuery) {
    const where: Prisma.ItemWhereInput = {
      archivedAt: null,
      channel: SourceChannel.online,
      purchaseRecord: null,
      categoryToyType: { not: ToyType.card },
      AND: [
        {
          OR: [
            { descriptionRaw: null },
            {
              NOT: {
                descriptionRaw: { contains: "カードダス", mode: "insensitive" },
              },
            },
          ],
        },
      ],
      NOT: [
        { titleRaw: { contains: "トレカ", mode: "insensitive" } },
        { titleRaw: { contains: "trading card", mode: "insensitive" } },
        { titleRaw: { contains: "card game", mode: "insensitive" } },
        { titleRaw: { contains: "mook", mode: "insensitive" } },
        { titleRaw: { contains: "magazine", mode: "insensitive" } },
        { titleRaw: { contains: "comic", mode: "insensitive" } },
        { titleRaw: { contains: "novel", mode: "insensitive" } },
        { titleRaw: { contains: "書籍", mode: "insensitive" } },
        { titleRaw: { contains: "漫画", mode: "insensitive" } },
        { titleRaw: { contains: "マンガ", mode: "insensitive" } },
        { titleRaw: { contains: "コミック", mode: "insensitive" } },
        { titleRaw: { contains: "写真集", mode: "insensitive" } },
        { titleRaw: { contains: "攻略本", mode: "insensitive" } },
        { titleRaw: { contains: "図鑑", mode: "insensitive" } },
        { titleRaw: { contains: "辞典", mode: "insensitive" } },
        { titleRaw: { contains: "事典", mode: "insensitive" } },
        { titleRaw: { contains: "図録", mode: "insensitive" } },
        { titleRaw: { contains: "資料集", mode: "insensitive" } },
        { titleRaw: { contains: "雑誌", mode: "insensitive" } },
        { titleRaw: { contains: "絵本", mode: "insensitive" } },
        { titleRaw: { contains: "小説", mode: "insensitive" } },
        { titleRaw: { contains: "パンフレット", mode: "insensitive" } },
      ],
    };
    if (!query.includeIgnored) where.ignored = false;
    if (query.ignored != null) where.ignored = query.ignored;
    if (query.favorite != null) where.favorite = query.favorite;
    if (query.ip) where.categoryIp = query.ip as CategoryIp;
    if (query.condition)
      where.conditionGrade = query.condition as ConditionGrade;
    if (query.toyType && query.toyType !== "card")
      where.categoryToyType = query.toyType as ToyType;
    if (query.manufacturer)
      where.manufacturer = query.manufacturer as Manufacturer;
    // 采购范围只保留线上商品；历史线下记录不会进入在售库。
    if (query.channel === "physical_store")
      return {
        items: [],
        total: 0,
        facets: { auction: 0, direct: 0 },
        serverTime: new Date().toISOString(),
      };
    if (query.platform) where.source = { key: query.platform };
    if (query.importOrigin)
      where.importOrigin = query.importOrigin as "search" | "url";
    if (query.minQuantity != null)
      where.quantityEst = { gte: query.minQuantity };
    if (query.maxUnitCost != null)
      where.unitCostEst = { lte: query.maxUnitCost };
    if (query.needsReview != null) where.needsReview = query.needsReview;
    if (query.auctionHours != null) {
      where.auctionEndAt = {
        gt: new Date(),
        lte: new Date(Date.now() + query.auctionHours * 3_600_000),
      };
    }
    if (query.listedWithinHours != null)
      where.listedAt = {
        gte: new Date(Date.now() - query.listedWithinHours * 3_600_000),
      };
    if (query.detectedWithinHours != null)
      where.detectedAt = {
        gte: new Date(Date.now() - query.detectedWithinHours * 3_600_000),
      };
    if (query.search) {
      where.OR = [
        { titleRaw: { contains: query.search, mode: "insensitive" } },
        { descriptionRaw: { contains: query.search, mode: "insensitive" } },
        { seller: { name: { contains: query.search, mode: "insensitive" } } },
      ];
    }
    if (query.priceBand) {
      where.priceCurrent =
        query.priceBand === "lt_1000"
          ? { lt: 1000 }
          : query.priceBand === "1000_2999"
            ? { gte: 1000, lte: 2999 }
            : query.priceBand === "3000_4999"
              ? { gte: 3000, lte: 4999 }
              : { gte: 5000 };
    }

    const facetWhere: Prisma.ItemWhereInput = { ...where };
    if (query.listingType) where.listingType = query.listingType as ListingType;

    const [items, total, auctionTotal, directTotal] =
      await this.prisma.$transaction([
        this.prisma.item.findMany({
          where,
          include,
          orderBy: [{ detectedAt: "desc" }, { listedAt: "desc" }],
          skip: query.offset,
          take: query.limit,
        }),
        this.prisma.item.count({ where }),
        this.prisma.item.count({
          where: { ...facetWhere, listingType: ListingType.auction },
        }),
        this.prisma.item.count({
          where: { ...facetWhere, listingType: ListingType.direct },
        }),
      ]);
    return {
      items: items.map((item) => ({
        ...item,
        source: {
          ...item.source,
          displayName: sourceDisplayName(
            item.source.key,
            item.source.displayName,
            item.sourceData,
          ),
        },
      })),
      total,
      facets: { auction: auctionTotal, direct: directTotal },
      serverTime: new Date().toISOString(),
    };
  }

  async changes(since?: string) {
    const parsed = since ? new Date(since) : new Date(Date.now() - 15_000);
    const sinceDate = Number.isNaN(parsed.getTime())
      ? new Date(Date.now() - 15_000)
      : parsed;
    const changes = await this.prisma.item.findMany({
      where: { updatedAt: { gt: sinceDate } },
      select: syncSelect,
      orderBy: { updatedAt: "asc" },
      take: 500,
    });
    return {
      changes,
      serverTime: new Date().toISOString(),
    };
  }

  async get(id: string) {
    const item = await this.prisma.item.findUnique({
      where: { id },
      include: {
        ...include,
        classifications: { orderBy: { createdAt: "desc" } },
        manualReviews: { orderBy: { createdAt: "desc" } },
        reviewQueue: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!item) throw new NotFoundException("Item not found");
    return {
      item: {
        ...item,
        source: {
          ...item.source,
          displayName: sourceDisplayName(
            item.source.key,
            item.source.displayName,
            item.sourceData,
          ),
        },
      },
      serverTime: new Date().toISOString(),
    };
  }

  async purchase(id: string, body: PurchaseDto) {
    const current = await this.ensureExists(id);
    const purchasedAt = body.purchasedAt
      ? new Date(body.purchasedAt)
      : new Date();
    if (Number.isNaN(purchasedAt.getTime()))
      throw new Error("购买时间格式无效");
    const receiptSize = body.receiptDataBase64
      ? Buffer.byteLength(body.receiptDataBase64, "base64")
      : 0;
    if (receiptSize > 3 * 1024 * 1024) {
      throw new BadRequestException("购买凭证图片不能超过 3MB");
    }
    if (body.receiptDataBase64 && !body.receiptMimeType?.startsWith("image/")) {
      throw new BadRequestException("购买凭证必须是图片文件");
    }
    const verified = receiptSize > 0;
    const record = await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchaseRecord.upsert({
        where: { itemId: id },
        update: {
          purchaseAmount: body.purchaseAmount,
          purchasedAt,
          note: body.note,
          verifiedAt: verified ? new Date() : null,
        },
        create: {
          itemId: id,
          purchaseAmount: body.purchaseAmount,
          purchasedAt,
          note: body.note,
          verifiedAt: verified ? new Date() : null,
        },
      });
      if (body.receiptDataBase64) {
        const mimeType = body.receiptMimeType?.startsWith("image/")
          ? body.receiptMimeType
          : "image/png";
        await tx.purchaseReceipt.create({
          data: {
            purchaseId: purchase.id,
            fileName:
              body.receiptFileName?.slice(0, 200) ?? "purchase-receipt.png",
            mimeType,
            sizeBytes: receiptSize,
            dataBase64: body.receiptDataBase64,
          },
        });
      }
      await tx.item.update({
        where: { id },
        data: { favorite: false, archivedAt: new Date() },
      });
      if (current.productId) {
        const quantity = Math.max(1, current.quantityEst ?? 1);
        const inventory = await tx.inventory.findUnique({
          where: { productId: current.productId },
        });
        const existingQuantity = inventory?.quantity ?? 0;
        const existingAverage = inventory?.averageCost
          ? Number(inventory.averageCost)
          : 0;
        const averageCost =
          (existingAverage * existingQuantity + body.purchaseAmount) /
          (existingQuantity + quantity);
        await tx.inventory.upsert({
          where: { productId: current.productId },
          update: {
            quantity: { increment: quantity },
            averageCost,
          },
          create: {
            productId: current.productId,
            quantity,
            averageCost: body.purchaseAmount / quantity,
          },
        });
      }
      return tx.purchaseRecord.findUnique({
        where: { id: purchase.id },
        include: {
          receipts: {
            select: {
              id: true,
              fileName: true,
              mimeType: true,
              sizeBytes: true,
              createdAt: true,
            },
          },
          item: { include },
        },
      });
    });
    return {
      purchase: record,
      verified: Boolean(record?.verifiedAt),
      serverTime: new Date().toISOString(),
    };
  }

  async listPurchases() {
    const purchases = await this.prisma.purchaseRecord.findMany({
      include: {
        receipts: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
        },
        item: { include },
      },
      orderBy: { purchasedAt: "desc" },
    });
    return {
      purchases,
      total: purchases.length,
      serverTime: new Date().toISOString(),
    };
  }

  async listSellers(search?: string, page = 1, limit = 60, segment?: string) {
    const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(100, Math.floor(limit)))
      : 60;
    const visibleItemWhere = {
      archivedAt: null,
      channel: SourceChannel.online,
      purchaseRecord: null,
      categoryToyType: { not: ToyType.card },
    } satisfies Prisma.ItemWhereInput;
    const where: Prisma.SellerWhereInput = {
      AND: [
        ...(search?.trim()
          ? [
              {
                name: {
                  contains: search.trim(),
                  mode: "insensitive" as const,
                },
              },
            ]
          : []),
        { items: { some: visibleItemWhere } },
      ],
    };
    const sellerRows = await this.prisma.seller.findMany({
      where,
      select: {
        id: true,
        name: true,
        sellerType: true,
        locationText: true,
        sourceData: true,
        profileUrl: true,
        createdAt: true,
        updatedAt: true,
        source: { select: { key: true, displayName: true } },
        items: {
          where: visibleItemWhere,
          select: { categoryToyType: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    const classified = sellerRows.map(({ items, sourceData, ...seller }) => ({
      ...seller,
      _count: { items: items.length },
      segment: classifySellerSegment({
        sellerType: seller.sellerType,
        sourceKey: seller.source.key,
        sourceDisplayName: seller.source.displayName,
        sourceData,
        visibleItems: items,
      }),
    }));
    const segments = sellerSegmentStats(classified.map((row) => row.segment));
    const activeSegment = sellerSegmentKeys.includes(
      segment as SellerSegmentKey,
    )
      ? (segment as SellerSegmentKey)
      : null;
    const filtered = activeSegment
      ? classified.filter((row) => row.segment.key === activeSegment)
      : classified;
    const total = filtered.length;
    const sellers = filtered.slice(
      (safePage - 1) * safeLimit,
      safePage * safeLimit,
    );
    return {
      sellers,
      segments,
      activeSegment,
      total,
      page: safePage,
      limit: safeLimit,
      pageCount: Math.max(1, Math.ceil(total / safeLimit)),
      serverTime: new Date().toISOString(),
    };
  }

  async getSeller(id: string, page = 1, limit = 48) {
    const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(100, Math.floor(limit)))
      : 48;
    const itemWhere = {
      sellerId: id,
      archivedAt: null,
      channel: SourceChannel.online,
      purchaseRecord: null,
      categoryToyType: { not: ToyType.card },
    } satisfies Prisma.ItemWhereInput;
    const [seller, segmentItems] = await Promise.all([
      this.prisma.seller.findUnique({
        where: { id },
        include: {
          source: { select: { key: true, displayName: true } },
          items: {
            where: {
              archivedAt: null,
              channel: SourceChannel.online,
              purchaseRecord: null,
              categoryToyType: { not: ToyType.card },
            },
            include,
            orderBy: { detectedAt: "desc" },
            skip: (safePage - 1) * safeLimit,
            take: safeLimit,
          },
        },
      }),
      this.prisma.item.findMany({
        where: itemWhere,
        select: { categoryToyType: true },
      }),
    ]);
    if (!seller) throw new NotFoundException("Seller not found");
    const total = segmentItems.length;
    const { items, ...sellerProfile } = seller;
    const segment = classifySellerSegment({
      sellerType: seller.sellerType,
      sourceKey: seller.source.key,
      sourceDisplayName: seller.source.displayName,
      sourceData: seller.sourceData,
      visibleItems: segmentItems,
    });
    return {
      seller: { ...sellerProfile, segment },
      items,
      total,
      page: safePage,
      limit: safeLimit,
      pageCount: Math.max(1, Math.ceil(total / safeLimit)),
      serverTime: new Date().toISOString(),
    };
  }

  async receipt(id: string, receiptId: string) {
    const row = await this.prisma.purchaseReceipt.findFirst({
      where: { id: receiptId, purchase: { itemId: id } },
    });
    if (!row) throw new NotFoundException("Purchase receipt not found");
    return row;
  }

  async audit(id: string) {
    await this.ensureExists(id);
    return this.prisma.manualReview.findMany({
      where: { itemId: id },
      orderBy: { createdAt: "desc" },
    });
  }

  async pendingReviews() {
    const reviews = await this.prisma.reviewQueue.findMany({
      where: { status: "pending" },
      include: {
        item: {
          include: {
            source: { select: { key: true, displayName: true } },
            images: { orderBy: { position: "asc" } },
          },
        },
        product: {
          include: {
            franchise: true,
            series: true,
            manufacturerEntity: true,
            toyTypeEntity: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return {
      reviews,
      total: await this.prisma.reviewQueue.count({
        where: { status: "pending" },
      }),
      serverTime: new Date().toISOString(),
    };
  }

  async update(id: string, body: UpdateItemDto) {
    const current = await this.ensureExists(id);
    const { actor = "operator", reason, ...changes } = body;
    if (changes.ignored === true) {
      (changes as Prisma.ItemUpdateInput).ignoredAt = new Date();
    } else if (changes.ignored === false) {
      (changes as Prisma.ItemUpdateInput).ignoredAt = null;
    }
    const changedKeys = Object.entries(changes)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    const isCollaborativePatch =
      changedKeys.length > 0 &&
      changedKeys.every((key) =>
        ["favorite", "ignored", "ignoredAt", "note"].includes(key),
      );
    if (isCollaborativePatch) {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.item.update({
          where: { id },
          data: changes as Prisma.ItemUpdateInput,
          select: syncSelect,
        });
        await tx.manualReview.create({
          data: {
            itemId: id,
            actor,
            reason,
            beforeData: JSON.parse(
              JSON.stringify(current),
            ) as Prisma.InputJsonValue,
            afterData: JSON.parse(
              JSON.stringify(updated),
            ) as Prisma.InputJsonValue,
          },
        });
        await tx.reviewQueue.updateMany({
          where: { itemId: id, status: "pending" },
          data: {
            status: "confirmed",
            resolvedBy: actor,
            resolvedAt: new Date(),
          },
        });
        return { item: updated, serverTime: new Date().toISOString() };
      });
    }
    const quantity = changes.quantityEst ?? current.quantityEst;
    const priceTotal = current.priceTotalEst;
    const unitCostEst = quantity ? Math.round(priceTotal / quantity) : null;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.item.update({
        where: { id },
        data: {
          ...changes,
          categoryIp: changes.categoryIp as CategoryIp | undefined,
          categoryToyType: changes.categoryToyType as ToyType | undefined,
          manufacturer: changes.manufacturer as Manufacturer | undefined,
          conditionGrade: changes.conditionGrade as ConditionGrade | undefined,
          unitCostEst,
          needsReview:
            changes.confidence != null
              ? changes.confidence < 0.9
              : current.needsReview,
          matchDecision: "manually_matched",
        },
        include,
      });
      await tx.manualReview.create({
        data: {
          itemId: id,
          actor,
          reason,
          beforeData: JSON.parse(
            JSON.stringify(current),
          ) as Prisma.InputJsonValue,
          afterData: JSON.parse(
            JSON.stringify(updated),
          ) as Prisma.InputJsonValue,
        },
      });
      await tx.reviewQueue.updateMany({
        where: { itemId: id, status: "pending" },
        data: {
          status: "confirmed",
          resolvedBy: actor,
          resolvedAt: new Date(),
        },
      });
      return { item: updated, serverTime: new Date().toISOString() };
    });
  }

  private async ensureExists(id: string) {
    const item = await this.prisma.item.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("Item not found");
    return item;
  }
}
