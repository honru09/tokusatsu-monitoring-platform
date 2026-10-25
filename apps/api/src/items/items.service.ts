import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CategoryIp,
  CollectibleSeries,
  ConditionGrade,
  ListingType,
  Manufacturer,
  Prisma,
  ShfEdition,
  ShfLine,
  ShfRegion,
  ShfReleaseChannel,
  SourceChannel,
  ToyType,
} from "@tokusatsu/db";
import {
  classifyCollectibleSeries,
  classifyShfListing,
} from "@tokusatsu/shared";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma.service.js";
import { valueKingPeerRelation } from './value-king.js';
import {
  effectiveMemberQuantity,
  ensureInventoryOrderFromBundle,
  syncInventoryOrderFromBundle,
  type BundleMemberForInventory,
} from "../inventory-orders/inventory-order-from-bundle.js";
import type {
  CreatePurchaseBundleDto,
  ListItemsQuery,
  ListPurchaseBundlesQuery,
  PurchaseDto,
  PurchaseBundleMemberDto,
  PurchasePricingMode,
  UpdatePurchaseBundleDto,
  UpdateItemDto,
} from "./items.dto.js";
import {
  classifySellerSegment,
  sellerSegmentKeys,
  sellerSegmentStats,
  type SellerSegmentKey,
} from "./seller-segments.js";
import {
  itemResponseWithChinaComparison,
  publicReadyChinaComparisonWhere,
  publicValueKingOpportunityRelation,
  readyChinaComparisonDetailRelation,
  readyChinaComparisonRelation,
  readyValueKingOpportunityRelation,
} from "./item-response.js";
import { activeMarketItemWhere } from "./active-market-scope.js";

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
  crossMarketOpportunities: readyValueKingOpportunityRelation,
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
      _count: { select: { listings: true } },
    },
  },
};

/**
 * The lifecycle a row returns to when a dislike is lifted — the same
 * priority as the lifecycle backfill migration, minus the dislike
 * itself: deleted > purchased > sold > ended > live.
 */
function restoredLifecycleStatus(
  item: {
    status: string;
    archivedAt: Date | null;
    deletedAt: Date | null;
  },
  hasPurchaseRecord: boolean,
): "live" | "sold" | "ended" | "purchased" | "deleted" {
  if (item.deletedAt) return "deleted";
  if (hasPurchaseRecord) return "purchased";
  if (item.status === "sold") return "sold";
  if (item.status === "ended" || item.archivedAt) return "ended";
  return "live";
}

const itemResponseInclude = {
  ...include,
  product: {
    include: {
      ...include.product.include,
      marketComparisons: readyChinaComparisonRelation,
      listings: valueKingPeerRelation,
    },
  },
} satisfies Prisma.ItemInclude;

// Used by the collaborative dashboard sync path. Keeping this projection
// deliberately small avoids reloading image galleries, price history and
// purchase receipts when another operator only changes a favorite or note.
const syncSelect = {
  id: true,
  favorite: true,
  ignored: true,
  ignoredAt: true,
  ignoredReason: true,
  archivedAt: true,
  deletedAt: true,
  lifecycleStatus: true,
  note: true,
  updatedAt: true,
  product: {
    select: {
      marketComparisons: readyChinaComparisonRelation,
    },
  },
} satisfies Prisma.ItemSelect;

const syncPageSize = 500;
const syncCursorPrefix = "v1.";
const collaborativeSyncFields = [
  "favorite",
  "ignored",
  "ignoredAt",
  "ignoredReason",
  "note",
  "status",
  "lifecycleStatus",
  "archivedAt",
  "deletedAt",
  "auctionEndAt",
  "listingType",
  "priceCurrent",
  "shippingFee",
  "priceTotalEst",
  "bidCount",
] as const;

type SyncCursor = {
  at: Date;
  id?: string;
};

function jsonRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function decodeSyncCursor(value?: string): SyncCursor {
  if (value?.startsWith(syncCursorPrefix)) {
    try {
      const decoded = JSON.parse(
        Buffer.from(value.slice(syncCursorPrefix.length), "base64url").toString(
          "utf8",
        ),
      ) as { at?: unknown; id?: unknown };
      const at = typeof decoded.at === "string" ? new Date(decoded.at) : null;
      if (at && !Number.isNaN(at.getTime())) {
        return {
          at,
          id: typeof decoded.id === "string" ? decoded.id : undefined,
        };
      }
    } catch {
      // Fall through to the legacy timestamp parser.
    }
  }

  const parsed = value ? new Date(value) : new Date(Date.now() - 15_000);
  return {
    at: Number.isNaN(parsed.getTime()) ? new Date(Date.now() - 15_000) : parsed,
  };
}

function encodeSyncCursor(cursor: SyncCursor) {
  return `${syncCursorPrefix}${Buffer.from(
    JSON.stringify({ at: cursor.at.toISOString(), id: cursor.id }),
  ).toString("base64url")}`;
}

function collaborativeChangeFromReview(review: {
  itemId: string;
  createdAt: Date;
  beforeData: Prisma.JsonValue;
  afterData: Prisma.JsonValue;
}) {
  const before = jsonRecord(review.beforeData);
  const after = jsonRecord(review.afterData);
  const hasCollaborativeChange = collaborativeSyncFields.some(
    (field) => Object.hasOwn(after, field) && before[field] !== after[field],
  );
  if (!hasCollaborativeChange) return undefined;

  return {
    id: typeof after.id === "string" ? after.id : review.itemId,
    // Availability checks can write a partial audit event. Missing fields are
    // not a request to clear favorites, notes or an existing archived state.
    ...(typeof after.favorite === "boolean" ? { favorite: after.favorite } : {}),
    ...(typeof after.ignored === "boolean" ? { ignored: after.ignored } : {}),
    ...(Object.hasOwn(after, "ignoredAt")
      ? { ignoredAt: typeof after.ignoredAt === "string" ? after.ignoredAt : null }
      : {}),
    ...(Object.hasOwn(after, "ignoredReason")
      ? { ignoredReason: typeof after.ignoredReason === "string" ? after.ignoredReason : null }
      : {}),
    ...(Object.hasOwn(after, "archivedAt")
      ? { archivedAt: typeof after.archivedAt === "string" ? after.archivedAt : null }
      : {}),
    ...(Object.hasOwn(after, "deletedAt")
      ? { deletedAt: typeof after.deletedAt === "string" ? after.deletedAt : null }
      : {}),
    ...(Object.hasOwn(after, "note")
      ? { note: typeof after.note === "string" ? after.note : null }
      : {}),
    ...(typeof after.status === "string" ? { status: after.status } : {}),
    ...(typeof after.lifecycleStatus === "string"
      ? { lifecycleStatus: after.lifecycleStatus }
      : {}),
    ...(typeof after.listingType === "string" ? { listingType: after.listingType } : {}),
    ...(Object.hasOwn(after, "auctionEndAt")
      ? { auctionEndAt: typeof after.auctionEndAt === "string" ? after.auctionEndAt : null }
      : {}),
    ...(typeof after.priceCurrent === "number" ? { priceCurrent: after.priceCurrent } : {}),
    ...(Object.hasOwn(after, "shippingFee")
      ? { shippingFee: typeof after.shippingFee === "number" ? after.shippingFee : null }
      : {}),
    ...(typeof after.priceTotalEst === "number" ? { priceTotalEst: after.priceTotalEst } : {}),
    ...(Object.hasOwn(after, "bidCount")
      ? { bidCount: typeof after.bidCount === "number" ? after.bidCount : null }
      : {}),
    updatedAt:
      typeof after.updatedAt === "string"
        ? after.updatedAt
        : review.createdAt.toISOString(),
  };
}

function syncServerTime(cursor: SyncCursor) {
  return cursor.at.toISOString();
}

const purchaseReceiptSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
} satisfies Prisma.PurchaseReceiptSelect;

const purchaseBundleSnapshotInclude = {
  purchases: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    select: {
      id: true,
      itemId: true,
      purchaseAmount: true,
      amountAllocated: true,
      quantityOverride: true,
      purchasedAt: true,
      note: true,
      verifiedAt: true,
      createdAt: true,
    },
  },
} satisfies Prisma.PurchaseBundleInclude;

const purchaseBundleApiInclude = {
  purchases: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    include: {
      receipts: { select: purchaseReceiptSelect },
      item: { include },
    },
  },
} satisfies Prisma.PurchaseBundleInclude;

type PurchaseBundleSnapshotRow = Prisma.PurchaseBundleGetPayload<{
  include: typeof purchaseBundleSnapshotInclude;
}>;

function purchaseBundleSnapshot(bundle: PurchaseBundleSnapshotRow) {
  return {
    id: bundle.id,
    version: bundle.version,
    pricingMode: bundle.pricingMode,
    totalPurchaseAmountYen: bundle.totalPurchaseAmount,
    currency: bundle.currency,
    purchasedAt: bundle.purchasedAt.toISOString(),
    note: bundle.note,
    archivedAt: bundle.archivedAt?.toISOString() ?? null,
    members: bundle.purchases.map((purchase) => ({
      purchaseId: purchase.id,
      itemId: purchase.itemId,
      amountYen: purchase.amountAllocated ? purchase.purchaseAmount : null,
      amountAllocated: purchase.amountAllocated,
      quantityOverride: purchase.quantityOverride ?? null,
      purchasedAt: purchase.purchasedAt.toISOString(),
      note: purchase.note,
      verifiedAt: purchase.verifiedAt?.toISOString() ?? null,
    })),
  };
}

function auditJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parsedPurchaseDate(value?: string) {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime()))
    throw new BadRequestException("购买时间格式无效");
  return parsed;
}

export function normalizePurchaseMembers(
  members: PurchaseBundleMemberDto[],
  pricingMode: PurchasePricingMode,
  requestedTotal?: number,
) {
  const itemIds = members.map(({ itemId }) => itemId?.trim() ?? "");
  if (itemIds.some((itemId) => !itemId))
    throw new BadRequestException("购买批次成员商品 ID 不能为空");
  if (new Set(itemIds).size !== itemIds.length)
    throw new BadRequestException("购买批次不能重复包含同一商品");
  // Quantity corrections are independent of the pricing mode. Only a
  // positive integer counts; anything else keeps the recognised estimate.
  const quantityByItemId = new Map<string, number>();
  for (const member of members) {
    if (
      member.quantity != null &&
      Number.isInteger(member.quantity) &&
      member.quantity >= 1
    )
      quantityByItemId.set(member.itemId!.trim(), member.quantity);
  }

  if (pricingMode === "per_item") {
    if (members.some(({ amountYen }) => amountYen == null))
      throw new BadRequestException("按单价记录时，每个商品都必须填写金额");
    const totalPurchaseAmountYen = members.reduce(
      (sum, member) => sum + member.amountYen!,
      0,
    );
    if (requestedTotal != null && requestedTotal !== totalPurchaseAmountYen)
      throw new BadRequestException("批次总价必须等于全部商品单价之和");
    return {
      itemIds,
      amountByItemId: new Map(
        members.map((member) => [member.itemId!.trim(), member.amountYen!]),
      ),
      quantityByItemId,
      totalPurchaseAmountYen,
      amountAllocated: true,
    };
  }

  if (requestedTotal == null)
    throw new BadRequestException("打包购买时必须填写打包总价");
  if (members.some(({ amountYen }) => amountYen != null))
    throw new BadRequestException(
      "打包总价模式不分摊单品金额；如需记录单价请切换为按单价模式",
    );
  return {
    itemIds,
    amountByItemId: new Map<string, number>(),
    quantityByItemId,
    totalPurchaseAmountYen: requestedTotal,
    amountAllocated: false,
  };
}

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

const MAX_URLS_PER_IMPORT = 20;

type PreparedUrlImport = {
  url: string;
  adapterKey: string;
};

type UrlImportResult = {
  url: string;
  accepted: boolean;
  adapter?: string;
  importId?: string;
  jobId?: string | number;
  message?: string;
  error?: string;
};

export function splitAnalyzeUrlInputs(input: string | readonly string[]) {
  const values = (typeof input === "string" ? [input] : input)
    .flatMap((value) => value.split(/\s+/u))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

/**
 * Actual paid amounts keyed by URL. Only positive integers in the same
 * range as a purchase amount are kept; anything else is treated as if no
 * amount was entered. Keys are indexed both as submitted and in the
 * normalized form prepareUrlImport produces, so a trailing-slash
 * difference does not lose the amount.
 */
export function actualAmountsByUrl(
  amountsByUrl?: Record<string, number> | null,
) {
  const amounts = new Map<string, number>();
  if (!amountsByUrl) return amounts;
  for (const [key, value] of Object.entries(amountsByUrl)) {
    if (!Number.isInteger(value) || value <= 0 || value > 100_000_000)
      continue;
    amounts.set(key, value);
    try {
      amounts.set(new URL(key).href, value);
    } catch {}
  }
  return amounts;
}

export function actualAmountFromJobData(value: unknown) {
  return Number.isInteger(value) &&
    Number(value) > 0 &&
    Number(value) <= 100_000_000
    ? Number(value)
    : null;
}

/**
 * Snapshot stored on a purchase-origin UrlImport row. Written with the paid
 * amount at submission time and completed from the parsed listing when the
 * analysis finishes, so the purchase workspace can rebuild its state from
 * the database after a refresh or after the queue job has been evicted.
 */
export type PurchaseAnalysisResultData = {
  title: string | null;
  priceYen: number | null;
  shopName: string | null;
  sellerName: string | null;
  adapterKey: string;
  suggestedAmountYen: number | null;
  paidAmountYen: number | null;
};

export function purchaseResultData(input: {
  adapterKey: string;
  paidAmountYen: number | null;
  item?: {
    titleRaw: string;
    priceCurrent: number;
    sellerName?: string | null;
    shopName?: string | null;
  } | null;
}): PurchaseAnalysisResultData {
  const priceYen = input.item?.priceCurrent ?? null;
  return {
    title: input.item?.titleRaw ?? null,
    priceYen,
    shopName: input.item?.shopName ?? null,
    sellerName: input.item?.sellerName ?? null,
    adapterKey: input.adapterKey,
    suggestedAmountYen: input.paidAmountYen ?? priceYen,
    paidAmountYen: input.paidAmountYen,
  };
}

export function purchaseAmountsFromResultData(value: unknown): {
  paidAmountYen: number | null;
  suggestedAmountYen: number | null;
} {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    paidAmountYen: actualAmountFromJobData(record.paidAmountYen),
    suggestedAmountYen: actualAmountFromJobData(record.suggestedAmountYen),
  };
}

// UrlImport rows use the JobStatus vocabulary; the purchase workspace polls
// with BullMQ state names. Terminal rows must read the same either way.
const purchaseStateByImportStatus: Record<string, string> = {
  queued: "waiting",
  running: "active",
  succeeded: "completed",
  failed: "failed",
};

export function purchaseStateFromImportStatus(status: string) {
  return purchaseStateByImportStatus[status] ?? "waiting";
}

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

  private prepareUrlImport(
    rawUrl: string,
  ): PreparedUrlImport | UrlImportResult {
    let url: URL;
    try {
      url = new URL(rawUrl.trim());
    } catch {
      return {
        url: rawUrl,
        accepted: false,
        error: "请输入完整商品 URL（包含 https://）",
      };
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      return {
        url: rawUrl,
        accepted: false,
        error: "仅支持 http/https 商品链接",
      };
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
      return {
        url: url.toString(),
        accepted: false,
        error: "出于安全原因不支持本地或内网地址",
      };
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
        url: url.toString(),
        accepted: false,
        error:
          "无法识别此链接。请使用公开商品页，或在服务端配置通用网页分析来源。",
      };
    }
    return { url: url.toString(), adapterKey };
  }

  private async enqueueUrlImports(candidates: PreparedUrlImport[]) {
    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
    const queue = new Queue("url-analysis", { connection: redis });
    const results: UrlImportResult[] = [];
    try {
      for (const candidate of candidates) {
        let importRecord: { id: string } | undefined;
        try {
          importRecord = await this.prisma.urlImport.create({
            data: {
              sourceUrl: candidate.url,
              adapterKey: candidate.adapterKey,
              status: "queued",
              progress: 0,
              currentStep: "已排队",
            },
            select: { id: true },
          });
          const job = await queue.add(
            "analyze-url",
            {
              adapterKey: candidate.adapterKey,
              sourceUrl: candidate.url,
              importId: importRecord.id,
            },
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
          results.push({
            url: candidate.url,
            accepted: true,
            jobId: job.id,
            importId: importRecord.id,
            adapter: candidate.adapterKey,
            message: "链接已加入分析队列，完成后会进入链接专区。",
          });
        } catch {
          if (importRecord) {
            await this.prisma.urlImport
              .update({
                where: { id: importRecord.id },
                data: {
                  status: "failed",
                  progress: 100,
                  currentStep: "排队失败",
                  errorText: "任务队列暂时不可用，请稍后重试。",
                  finishedAt: new Date(),
                },
              })
              .catch(() => undefined);
          }
          results.push({
            url: candidate.url,
            accepted: false,
            adapter: candidate.adapterKey,
            importId: importRecord?.id,
            error: "任务队列暂时不可用，请稍后重试。",
          });
        }
      }
    } finally {
      await queue.close().catch(() => undefined);
      await redis.quit().catch(() => undefined);
    }
    return results;
  }

  async analyzeUrl(input: string | readonly string[]) {
    const batchRequested = Array.isArray(input);
    const rawUrls = splitAnalyzeUrlInputs(input);
    if (rawUrls.length === 0) {
      const emptyResult = {
        url: "",
        accepted: false,
        error: "请输入至少一个完整商品 URL（包含 https://）",
      } satisfies UrlImportResult;
      return batchRequested
        ? {
            accepted: false,
            results: [emptyResult],
            acceptedCount: 0,
            rejectedCount: 1,
          }
        : emptyResult;
    }
    if (rawUrls.length > MAX_URLS_PER_IMPORT) {
      throw new BadRequestException(
        `一次最多导入 ${MAX_URLS_PER_IMPORT} 个商品链接`,
      );
    }

    const prepared = rawUrls.map((rawUrl) => this.prepareUrlImport(rawUrl));
    const candidates = prepared.filter(
      (entry): entry is PreparedUrlImport => "adapterKey" in entry,
    );
    const queued = candidates.length
      ? await this.enqueueUrlImports(candidates)
      : [];
    const queuedByUrl = new Map(queued.map((entry) => [entry.url, entry]));
    const results = prepared.map((entry) =>
      "adapterKey" in entry ? queuedByUrl.get(entry.url)! : entry,
    );

    if (!batchRequested && results.length === 1) return results[0];
    const acceptedCount = results.filter((entry) => entry.accepted).length;
    return {
      accepted: acceptedCount > 0,
      results,
      acceptedCount,
      rejectedCount: results.length - acceptedCount,
    };
  }

  async retryUrlImport(id: string) {
    const record = await this.prisma.urlImport.findUnique({ where: { id } });
    if (!record) throw new NotFoundException("链接分析任务不存在");
    if ((record as { origin?: string }).origin === "purchase")
      throw new BadRequestException(
        "购买链接分析请在购买工作区重新粘贴链接提交",
      );
    if (record.status !== "failed")
      throw new BadRequestException("只有失败的链接分析任务可以重试");
    const prepared = this.prepareUrlImport(record.sourceUrl);
    if (!("adapterKey" in prepared))
      throw new BadRequestException(prepared.error);

    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
    const queue = new Queue("url-analysis", { connection: redis });
    try {
      if (record.queueJobId) {
        const existingJob = await queue.getJob(record.queueJobId);
        const existingState = await existingJob?.getState();
        if (
          existingJob &&
          existingState &&
          [
            "active",
            "waiting",
            "delayed",
            "prioritized",
            "waiting-children",
          ].includes(existingState)
        ) {
          await this.prisma.urlImport.update({
            where: { id },
            data: {
              status: existingState === "active" ? "running" : "queued",
              progress: existingState === "active" ? 10 : 0,
              currentStep:
                existingState === "active" ? "正在重新分析" : "等待自动重试",
              errorText: null,
              finishedAt: null,
            },
          });
          return {
            url: prepared.url,
            accepted: true,
            jobId: existingJob.id,
            importId: id,
            adapter: prepared.adapterKey,
            reused: true,
            message: "原任务仍在自动重试，无需重复排队。",
          };
        }
      }
      await this.prisma.urlImport.update({
        where: { id },
        data: {
          adapterKey: prepared.adapterKey,
          queueJobId: null,
          itemId: null,
          status: "queued",
          progress: 0,
          currentStep: "已重新排队",
          errorText: null,
          startedAt: null,
          finishedAt: null,
        },
      });
      const job = await queue.add(
        "analyze-url",
        {
          adapterKey: prepared.adapterKey,
          sourceUrl: prepared.url,
          importId: id,
        },
        {
          attempts: 3,
          backoff: { type: "exponential", delay: 10_000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
      await this.prisma.urlImport.update({
        where: { id },
        data: { queueJobId: String(job.id) },
      });
      return {
        url: prepared.url,
        accepted: true,
        jobId: job.id,
        importId: id,
        adapter: prepared.adapterKey,
        message: "失败任务已重新加入分析队列。",
      };
    } catch {
      await this.prisma.urlImport
        .update({
          where: { id },
          data: {
            status: "failed",
            progress: 100,
            currentStep: "重试排队失败",
            errorText: "任务队列暂时不可用，请稍后重试。",
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
      return {
        url: prepared.url,
        accepted: false,
        importId: id,
        adapter: prepared.adapterKey,
        error: "任务队列暂时不可用，请稍后重试。",
      };
    } finally {
      await queue.close().catch(() => undefined);
      await redis.quit().catch(() => undefined);
    }
  }

  async analyzePurchaseLinks(
    input: readonly string[],
    amountsByUrl?: Record<string, number> | null,
  ) {
    const actualAmounts = actualAmountsByUrl(amountsByUrl);
    const rawUrls = splitAnalyzeUrlInputs(input);
    if (rawUrls.length === 0)
      throw new BadRequestException("请输入至少一个完整商品 URL");
    if (rawUrls.length > MAX_URLS_PER_IMPORT)
      throw new BadRequestException(
        `一次最多分析 ${MAX_URLS_PER_IMPORT} 个购买链接`,
      );

    const prepared = rawUrls.map((rawUrl) => this.prepareUrlImport(rawUrl));
    const candidates = prepared.filter(
      (entry): entry is PreparedUrlImport => "adapterKey" in entry,
    );
    const queuedByUrl = new Map<string, UrlImportResult>();
    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
    const queue = new Queue("url-analysis", { connection: redis });
    try {
      for (const candidate of candidates) {
        const actualAmountYen = actualAmounts.get(candidate.url) ?? null;
        let importRecord: { id: string } | undefined;
        try {
          // Purchase analyses are persisted like ordinary imports (origin
          // "purchase") so a refresh does not lose them. The job carries the
          // record id, which is how the worker already writes status,
          // progress and the parsed item id back to UrlImport rows.
          importRecord = await this.prisma.urlImport.create({
            data: {
              sourceUrl: candidate.url,
              adapterKey: candidate.adapterKey,
              status: "queued",
              progress: 0,
              currentStep: "已排队",
              origin: "purchase",
              resultData: purchaseResultData({
                adapterKey: candidate.adapterKey,
                paidAmountYen: actualAmountYen,
              }) as Prisma.InputJsonValue,
            },
            select: { id: true },
          });
          const job = await queue.add(
            "analyze-purchase-url",
            {
              adapterKey: candidate.adapterKey,
              sourceUrl: candidate.url,
              importOrigin: "purchase",
              importId: importRecord.id,
              ...(actualAmountYen != null
                ? { actualAmountYen }
                : {}),
            },
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
          queuedByUrl.set(candidate.url, {
            url: candidate.url,
            accepted: true,
            jobId: job.id,
            importId: importRecord.id,
            adapter: candidate.adapterKey,
            message: "正在分析商品，完成后可填写单价或打包总价。",
          });
        } catch {
          if (importRecord) {
            await this.prisma.urlImport
              .update({
                where: { id: importRecord.id },
                data: {
                  status: "failed",
                  progress: 100,
                  currentStep: "排队失败",
                  errorText: "任务队列暂时不可用，请稍后重试。",
                  finishedAt: new Date(),
                },
              })
              .catch(() => undefined);
          }
          queuedByUrl.set(candidate.url, {
            url: candidate.url,
            accepted: false,
            adapter: candidate.adapterKey,
            importId: importRecord?.id,
            error: "任务队列暂时不可用，请稍后重试。",
          });
        }
      }
    } finally {
      await queue.close().catch(() => undefined);
      await redis.quit().catch(() => undefined);
    }

    const results = prepared.map((entry) =>
      "adapterKey" in entry ? queuedByUrl.get(entry.url)! : entry,
    );
    const acceptedCount = results.filter((entry) => entry.accepted).length;
    return {
      accepted: acceptedCount > 0,
      results,
      acceptedCount,
      rejectedCount: results.length - acceptedCount,
      createsOrdinaryLinkTasks: false,
    };
  }

  private async findPurchaseImportByJobId(jobId: string) {
    if (!this.prisma.urlImport?.findUnique) return null;
    const record = await this.prisma.urlImport
      .findUnique({ where: { queueJobId: jobId } })
      .catch(() => null);
    return record && record.origin === "purchase" ? record : null;
  }

  private purchaseAnalysisItemResponse(
    item: Prisma.ItemGetPayload<{ include: typeof include }>,
  ) {
    return {
      ...item,
      source: {
        ...item.source,
        displayName: sourceDisplayName(
          item.source.key,
          item.source.displayName,
          item.sourceData,
        ),
      },
    };
  }

  private purchaseAnalysisResponse(input: {
    jobId: string;
    importId?: string | null;
    state: string;
    progress: number;
    failedReason?: string | null;
    item: Prisma.ItemGetPayload<{ include: typeof include }> | null;
    paidAmountYen: number | null;
  }) {
    const item = input.item;
    return {
      jobId: input.jobId,
      importId: input.importId ?? null,
      state: input.state,
      progress: input.progress,
      failedReason: input.failedReason ?? null,
      item: item ? this.purchaseAnalysisItemResponse(item) : null,
      readyForPricing: input.state === "completed" && Boolean(item),
      pricingOptions: item
        ? {
            perItem: {
              itemId: item.id,
              suggestedAmountYen: input.paidAmountYen ?? item.priceCurrent,
              suggestedAmountSource:
                input.paidAmountYen != null ? "actual" : "listing",
            },
            bundleTotal: true,
          }
        : null,
      serverTime: new Date().toISOString(),
    };
  }

  // The worker updates the UrlImport row itself (status/progress/itemId via
  // the importId the job carries). The parsed snapshot lives only in the
  // parsed Item, so the first poll that observes completion copies it into
  // resultData; after that the row alone can answer polls and listings.
  private async persistPurchaseAnalysisCompletion(
    recordId: string,
    input: {
      item: Prisma.ItemGetPayload<{ include: typeof include }>;
      adapterKey: string;
      paidAmountYen: number | null;
    },
  ) {
    await this.prisma.urlImport
      .update({
        where: { id: recordId },
        data: {
          status: "succeeded",
          progress: 100,
          currentStep: "已完成",
          errorText: null,
          finishedAt: new Date(),
          itemId: input.item.id,
          resultData: purchaseResultData({
            adapterKey: input.adapterKey,
            paidAmountYen: input.paidAmountYen,
            item: {
              titleRaw: input.item.titleRaw,
              priceCurrent: input.item.priceCurrent,
              sellerName: input.item.seller?.name ?? null,
              shopName: sourceDisplayName(
                input.item.source.key,
                input.item.source.displayName,
                input.item.sourceData,
              ),
            },
          }) as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
  }

  async getPurchaseLinkAnalysis(jobId: string) {
    const persisted = await this.findPurchaseImportByJobId(jobId);
    if (persisted && (persisted.status === "succeeded" || persisted.status === "failed")) {
      const { paidAmountYen } = purchaseAmountsFromResultData(
        persisted.resultData,
      );
      const item =
        persisted.status === "succeeded" && persisted.itemId
          ? await this.prisma.item.findUnique({
              where: { id: persisted.itemId },
              include,
            })
          : null;
      return this.purchaseAnalysisResponse({
        jobId,
        importId: persisted.id,
        state: purchaseStateFromImportStatus(persisted.status),
        progress: persisted.progress,
        failedReason:
          persisted.status === "failed" ? persisted.errorText : null,
        item,
        paidAmountYen,
      });
    }

    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
    const queue = new Queue("url-analysis", { connection: redis });
    try {
      const job = await queue.getJob(jobId);
      if (!job || job.data?.importOrigin !== "purchase") {
        // The queue job is gone (evicted after completion). A persisted row
        // that is still in flight is the only source left; without one the
        // analysis really is unknown.
        if (persisted) {
          const { paidAmountYen } = purchaseAmountsFromResultData(
            persisted.resultData,
          );
          return this.purchaseAnalysisResponse({
            jobId,
            importId: persisted.id,
            state: purchaseStateFromImportStatus(persisted.status),
            progress: persisted.progress,
            item: null,
            paidAmountYen,
          });
        }
        throw new NotFoundException("购买链接分析任务不存在或已过期");
      }
      const state = await job.getState();
      const result = job.returnvalue as
        | { itemId?: string; title?: string }
        | undefined;
      const item = result?.itemId
        ? await this.prisma.item.findUnique({
            where: { id: result.itemId },
            include,
          })
        : null;
      const actualAmountYen =
        actualAmountFromJobData(job.data?.actualAmountYen) ??
        (persisted
          ? purchaseAmountsFromResultData(persisted.resultData).paidAmountYen
          : null);
      if (persisted && state === "completed" && item) {
        await this.persistPurchaseAnalysisCompletion(persisted.id, {
          item,
          adapterKey: persisted.adapterKey,
          paidAmountYen: actualAmountYen,
        });
      } else if (persisted && state === "failed") {
        await this.prisma.urlImport
          .update({
            where: { id: persisted.id },
            data: {
              status: "failed",
              progress: 100,
              currentStep: "分析失败",
              errorText: String(job.failedReason ?? "分析失败").slice(0, 1000),
              finishedAt: new Date(),
            },
          })
          .catch(() => undefined);
      }
      return this.purchaseAnalysisResponse({
        jobId: String(job.id),
        importId: persisted?.id ?? job.data?.importId ?? null,
        state,
        progress:
          typeof job.progress === "number" ? job.progress : persisted?.progress ?? 0,
        failedReason: state === "failed" ? job.failedReason : null,
        item,
        paidAmountYen: actualAmountYen,
      });
    } finally {
      await queue.close().catch(() => undefined);
      await redis.quit().catch(() => undefined);
    }
  }

  async listPurchaseAnalyses() {
    const records = await this.prisma.urlImport.findMany({
      where: { origin: "purchase" },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        item: { include },
      },
    });
    return {
      analyses: records.map((record) => {
        const { paidAmountYen, suggestedAmountYen } =
          purchaseAmountsFromResultData(record.resultData);
        const item = record.item
          ? this.purchaseAnalysisItemResponse(
              record.item as Prisma.ItemGetPayload<{ include: typeof include }>,
            )
          : null;
        return {
          id: record.id,
          jobId: record.queueJobId,
          url: record.sourceUrl,
          adapterKey: record.adapterKey,
          status: record.status,
          state: purchaseStateFromImportStatus(record.status),
          progress: record.progress,
          currentStep: record.currentStep,
          failedReason:
            record.status === "failed" ? record.errorText : null,
          itemId: record.itemId,
          item,
          suggestedAmountYen:
            suggestedAmountYen ?? item?.priceCurrent ?? null,
          suggestedAmountSource:
            paidAmountYen != null
              ? "actual"
              : item
                ? "listing"
                : null,
          paidAmountYen,
          resultData: record.resultData ?? null,
          createdAt: record.createdAt,
        };
      }),
      serverTime: new Date().toISOString(),
    };
  }

  async list(query: ListItemsQuery) {
    const where = activeMarketItemWhere({
      includeIgnored: query.includeIgnored,
    });
    if (query.ignored != null) where.ignored = query.ignored;
    if (query.favorite != null) where.favorite = query.favorite;
    if (query.monitoringCategoryId) {
      const categories = await this.prisma.monitoringCategory.findMany({
        select: { id: true, parentId: true },
      });
      const children = new Map<string, string[]>();
      for (const category of categories) {
        if (!category.parentId) continue;
        const siblings = children.get(category.parentId) ?? [];
        siblings.push(category.id);
        children.set(category.parentId, siblings);
      }
      const ids = new Set<string>([query.monitoringCategoryId]);
      const pending = [query.monitoringCategoryId];
      while (pending.length) {
        for (const child of children.get(pending.pop()!) ?? []) {
          if (ids.has(child)) continue;
          ids.add(child);
          pending.push(child);
        }
      }
      where.monitoringCategoryId = { in: [...ids] };
    }
    if (query.ip) where.categoryIp = query.ip as CategoryIp;
    if (query.collection)
      where.collectibleSeries = query.collection as CollectibleSeries;
    if (query.shfLine) where.shfLine = query.shfLine as ShfLine;
    if (query.shfReleaseChannel)
      where.shfReleaseChannel = query.shfReleaseChannel as ShfReleaseChannel;
    if (query.shfEdition) where.shfEdition = query.shfEdition as ShfEdition;
    if (query.shfRegion) where.shfRegion = query.shfRegion as ShfRegion;
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
        facets: { auction: 0, direct: 0, unknown: 0 },
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
    if (query.auctionMinutes != null) {
      where.auctionEndAt = {
        gt: new Date(),
        lte: new Date(Date.now() + query.auctionMinutes * 60_000),
      };
    } else if (query.auctionHours != null) {
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
        { titleZh: { contains: query.search, mode: "insensitive" } },
        { descriptionZh: { contains: query.search, mode: "insensitive" } },
        { conditionZh: { contains: query.search, mode: "insensitive" } },
        { shippingZh: { contains: query.search, mode: "insensitive" } },
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

    let valueKingRelation: ReturnType<
      typeof publicValueKingOpportunityRelation
    > = null;
    if (query.valueKing === true) {
      const valueKingNow = new Date();
      const opportunityRelation =
        publicValueKingOpportunityRelation(valueKingNow);
      if (
        (query.listingType && query.listingType !== "direct")
      )
        return {
          items: [],
          total: 0,
          facets: { auction: 0, direct: 0, unknown: 0 },
          serverTime: new Date().toISOString(),
        };
      where.listingType = ListingType.direct;
      where.status = "active";
      where.shippingFee = { not: null };
      where.quantityEst = { not: null };
      where.conditionGrade = {
        in: [
          ConditionGrade.new_sealed,
          ConditionGrade.like_new,
          ConditionGrade.used,
        ],
      };
      valueKingRelation = opportunityRelation;
    }

    const requestsXianyuComparison =
      query.hasXianyuComparison === true ||
      Boolean(query.xianyuPriceBand) ||
      query.sortBy === "xianyuPrice";
    const xianyuComparisonWhere = requestsXianyuComparison
      ? publicReadyChinaComparisonWhere(query.xianyuPriceBand)
      : null;
    if (requestsXianyuComparison && !xianyuComparisonWhere) {
      return {
        items: [],
        total: 0,
        facets: { auction: 0, direct: 0, unknown: 0 },
        serverTime: new Date().toISOString(),
      };
    }
    if (xianyuComparisonWhere) {
      where.product = {
        is: { marketComparisons: { some: xianyuComparisonWhere } },
      };
    }

    const facetWhere: Prisma.ItemWhereInput = { ...where };
    if (query.listingType) where.listingType = query.listingType as ListingType;
    const sortOrder = query.sortOrder ?? "asc";
    const orderBy: Prisma.ItemOrderByWithRelationInput[] =
      query.sortBy === "price"
        ? [{ priceCurrent: sortOrder }, { detectedAt: "desc" }, { id: "asc" }]
        : query.sortBy === "auctionEndAt"
          ? [
              { auctionEndAt: { sort: sortOrder, nulls: "last" } },
              { detectedAt: "desc" },
              { id: "asc" },
            ]
          : [{ detectedAt: "desc" }, { listedAt: "desc" }, { id: "asc" }];

    if (query.sortBy === "xianyuPrice" && xianyuComparisonWhere) {
      const [rankedRows, auctionTotal, directTotal, unknownTotal] =
        await this.prisma.$transaction([
          this.prisma.item.findMany({
            where,
            select: {
              id: true,
              detectedAt: true,
              priceCurrent: true,
              product: {
                select: {
                  marketComparisons: {
                    where: xianyuComparisonWhere,
                    select: { referencePriceCny: true },
                    orderBy: [
                      { observedAt: "desc" as const },
                      { updatedAt: "desc" as const },
                    ],
                    take: 1,
                  },
                },
              },
            },
          }),
          this.prisma.item.count({
            where: { ...facetWhere, listingType: ListingType.auction },
          }),
          this.prisma.item.count({
            where: { ...facetWhere, listingType: ListingType.direct },
          }),
          this.prisma.item.count({
            where: { ...facetWhere, listingType: ListingType.unknown },
          }),
        ]);
      const direction = sortOrder === "desc" ? -1 : 1;
      rankedRows.sort((left, right) => {
        const leftPrice = Number(
          left.product?.marketComparisons[0]?.referencePriceCny ?? 0,
        );
        const rightPrice = Number(
          right.product?.marketComparisons[0]?.referencePriceCny ?? 0,
        );
        const priceDifference = (leftPrice - rightPrice) * direction;
        if (priceDifference) return priceDifference;
        if (left.priceCurrent !== right.priceCurrent)
          return left.priceCurrent - right.priceCurrent;
        const detectedDifference =
          right.detectedAt.getTime() - left.detectedAt.getTime();
        return detectedDifference || left.id.localeCompare(right.id);
      });
      const pageIds = rankedRows
        .slice(query.offset, query.offset + query.limit)
        .map((row) => row.id);
      const pageRows = pageIds.length
        ? await this.prisma.item.findMany({
            where: { ...where, id: { in: pageIds } },
            include: itemResponseInclude,
          })
        : [];
      const position = new Map(pageIds.map((id, index) => [id, index]));
      pageRows.sort(
        (left, right) =>
          (position.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (position.get(right.id) ?? Number.MAX_SAFE_INTEGER),
      );
      return {
        items: pageRows.map((item) =>
          itemResponseWithChinaComparison({
            ...item,
            source: {
              ...item.source,
              displayName: sourceDisplayName(
                item.source.key,
                item.source.displayName,
                item.sourceData,
              ),
            },
          }),
        ),
        total: rankedRows.length,
        facets: {
          auction: auctionTotal,
          direct: directTotal,
          unknown: unknownTotal,
        },
        serverTime: new Date().toISOString(),
      };
    }

    if (query.valueKing === true) {
      const candidates = await this.prisma.item.findMany({
        where,
        include: {
          ...itemResponseInclude,
          crossMarketOpportunities:
            valueKingRelation ?? readyValueKingOpportunityRelation,
        },
        orderBy: [{ detectedAt: "desc" }, { id: "asc" }],
      });
      const verified = candidates
        .map((item) =>
          itemResponseWithChinaComparison({
            ...item,
            source: {
              ...item.source,
              displayName: sourceDisplayName(
                item.source.key,
                item.source.displayName,
                item.sourceData,
              ),
            },
          }),
        )
        .filter((item) => item.valueKing != null)
        .sort((left, right) => {
          if (query.sortBy === "price")
            return (
              (left.priceCurrent - right.priceCurrent) *
              (query.sortOrder === "desc" ? -1 : 1)
            );
          return (
            Number(right.valueKing?.savingsJpy ?? right.valueKing?.netProfitJpy ?? 0) -
              Number(left.valueKing?.savingsJpy ?? left.valueKing?.netProfitJpy ?? 0) ||
            Number(left.valueKing?.unitCostJpy ?? 0) - Number(right.valueKing?.unitCostJpy ?? 0) ||
            right.detectedAt.getTime() - left.detectedAt.getTime()
          );
        });
      return {
        items: verified.slice(query.offset, query.offset + query.limit),
        total: verified.length,
        facets: { auction: 0, direct: verified.length, unknown: 0 },
        serverTime: new Date().toISOString(),
      };
    }

    const [items, total, auctionTotal, directTotal, unknownTotal] =
      await this.prisma.$transaction([
        this.prisma.item.findMany({
          where,
          include: itemResponseInclude,
          orderBy,
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
        this.prisma.item.count({
          where: { ...facetWhere, listingType: ListingType.unknown },
        }),
      ]);
    return {
      items: items.map((item) =>
        itemResponseWithChinaComparison({
          ...item,
          source: {
            ...item.source,
            displayName: sourceDisplayName(
              item.source.key,
              item.source.displayName,
              item.sourceData,
            ),
          },
        }),
      ),
      total,
      facets: {
        auction: auctionTotal,
        direct: directTotal,
        unknown: unknownTotal,
      },
      serverTime: new Date().toISOString(),
    };
  }

  async changes(since?: string) {
    const cursor = decodeSyncCursor(since);
    const reviews = await this.prisma.manualReview.findMany({
      where: cursor.id
        ? {
            OR: [
              { createdAt: { gt: cursor.at } },
              { createdAt: cursor.at, id: { gt: cursor.id } },
            ],
          }
        : { createdAt: { gt: cursor.at } },
      select: {
        id: true,
        itemId: true,
        createdAt: true,
        beforeData: true,
        afterData: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: syncPageSize + 1,
    });
    const page = reviews.slice(0, syncPageSize);
    const latestByItem = new Map<
      string,
      NonNullable<ReturnType<typeof collaborativeChangeFromReview>>
    >();
    for (const review of page) {
      const change = collaborativeChangeFromReview(review);
      if (change)
        latestByItem.set(change.id, { ...latestByItem.get(change.id), ...change });
    }
    const last = page.at(-1);
    const nextCursor = encodeSyncCursor(
      last ? { at: last.createdAt, id: last.id } : cursor,
    );
    return {
      changes: [...latestByItem.values()],
      nextCursor,
      serverTime: syncServerTime(last ? { at: last.createdAt } : cursor),
      hasMore: reviews.length > syncPageSize,
    };
  }

  async get(id: string) {
    const item = await this.prisma.item.findUnique({
      where: { id },
      include: {
        ...itemResponseInclude,
        product: {
          include: {
            ...include.product.include,
            marketComparisons: readyChinaComparisonDetailRelation,
          },
        },
        classifications: { orderBy: { createdAt: "desc" } },
        manualReviews: { orderBy: { createdAt: "desc" } },
        reviewQueue: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!item || item.deletedAt) throw new NotFoundException("Item not found");
    return {
      item: itemResponseWithChinaComparison(
        {
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
        { includeOffers: true },
      ),
      serverTime: new Date().toISOString(),
    };
  }

  private async readPurchaseBundleSnapshot(
    tx: Prisma.TransactionClient,
    id: string,
  ) {
    const bundle = await tx.purchaseBundle.findUnique({
      where: { id },
      include: purchaseBundleSnapshotInclude,
    });
    if (!bundle) throw new NotFoundException("购买批次不存在");
    return { row: bundle, snapshot: purchaseBundleSnapshot(bundle) };
  }

  private async appendPurchaseBundleAudit(
    tx: Prisma.TransactionClient,
    input: {
      bundleId: string;
      eventType:
        | "created"
        | "price_changed"
        | "members_changed"
        | "updated"
        | "archived";
      actor: string;
      reason: string;
      before?: unknown;
      after: unknown;
    },
  ) {
    return tx.purchaseBundleAudit.create({
      data: {
        bundleId: input.bundleId,
        eventType: input.eventType,
        actor: input.actor.trim(),
        reason: input.reason.trim(),
        ...(input.before === undefined
          ? {}
          : { beforeData: auditJson(input.before) }),
        afterData: auditJson(input.after),
      },
    });
  }

  private async loadBundleMembersForInventory(
    tx: Prisma.TransactionClient,
    purchases: Array<{ itemId: string; quantityOverride?: number | null }>,
  ): Promise<BundleMemberForInventory[]> {
    if (purchases.length === 0) return [];
    const itemIds = purchases.map((purchase) => purchase.itemId);
    const items = await tx.item.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true,
        quantityEst: true,
        titleRaw: true,
        titleZh: true,
        source: { select: { displayName: true } },
        images: {
          orderBy: { position: "asc" as const },
          take: 1,
          select: { url: true },
        },
      },
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    const overrideByItemId = new Map(
      purchases.map((purchase) => [purchase.itemId, purchase.quantityOverride ?? null]),
    );
    return itemIds.map((itemId) => {
      const item = byId.get(itemId);
      return {
        quantityEst: item?.quantityEst ?? 1,
        quantityOverride: overrideByItemId.get(itemId) ?? null,
        titleZh: item?.titleZh ?? null,
        titleRaw: item?.titleRaw ?? itemId,
        platform: item?.source.displayName ?? null,
        imageUrl: item?.images[0]?.url ?? null,
      };
    });
  }

  /**
   * A registered purchase closes the negotiation for that item: a case that
   * was still in progress reads as a success from now on. Cases already
   * marked success keep their original statusChangedAt, and failed cases
   * are left alone (the purchase may belong to a different listing round).
   */
  /**
   * A registered purchase is the terminal decision for its catalog
   * items, so record decision=bought alongside the negotiation close.
   * The bundle DTO only carries the free-text actor: the decider is
   * whoever that actor resolves to (the same lookup the favorite /
   * dislike activity attribution uses). An actor that is not a manager
   * account id leaves decisions untouched rather than attributing the
   * purchase to the wrong person.
   */
  private async markItemsBoughtDecision(
    tx: Prisma.TransactionClient,
    itemIds: string[],
    actor: string,
  ) {
    if (!itemIds.length) return;
    const decider = await tx.managerAccount.findFirst({
      where: { id: actor, active: true },
      select: { id: true },
    });
    if (!decider) return;
    const now = new Date();
    for (const itemId of itemIds) {
      await tx.itemDecision.upsert({
        where: { itemId },
        create: {
          itemId,
          status: "bought",
          decidedById: decider.id,
          decidedAt: now,
        },
        update: { status: "bought", decidedById: decider.id, decidedAt: now },
      });
    }
  }

  private async closeNegotiationCasesForPurchasedItems(
    tx: Prisma.TransactionClient,
    itemIds: string[],
  ) {
    if (!itemIds.length) return;
    await tx.negotiationCase.updateMany({
      where: { itemId: { in: itemIds }, status: "in_progress" },
      data: { status: "success", statusChangedAt: new Date() },
    });
  }

  /**
   * Dual-write purchase bundle → inventory order.
   * Cost/qty resync only when remaining===initial and no sales yet; otherwise
   * metadata may update but sold state is never clobbered.
   */
  private async syncLinkedInventoryOrder(
    tx: Prisma.TransactionClient,
    bundle: {
      id: string;
      totalPurchaseAmount: number;
      purchasedAt: Date;
      note: string | null;
      purchases: Array<{ itemId: string; quantityOverride?: number | null }>;
    },
  ) {
    const members = await this.loadBundleMembersForInventory(
      tx,
      bundle.purchases,
    );
    return syncInventoryOrderFromBundle(tx, {
      bundleId: bundle.id,
      purchaseCost: bundle.totalPurchaseAmount,
      purchasedAt: bundle.purchasedAt,
      note: bundle.note,
      members,
    });
  }

  private async archiveMergedSingletonBundle(
    tx: Prisma.TransactionClient,
    sourceBundleId: string,
    actor: string,
    reason: string,
  ) {
    const before = await this.readPurchaseBundleSnapshot(tx, sourceBundleId);
    if (before.row.purchases.length !== 1)
      throw new ConflictException(
        "商品已属于多商品购买批次，请先在原批次中调整成员",
      );
    const archivedAt = new Date();
    const updated = await tx.purchaseBundle.updateMany({
      where: {
        id: sourceBundleId,
        version: before.row.version,
        archivedAt: null,
      },
      data: { archivedAt, version: { increment: 1 } },
    });
    if (updated.count !== 1)
      throw new ConflictException("购买批次已被其他用户修改，请刷新后重试");
    return { before: before.snapshot, archivedAt };
  }

  async createPurchaseBundle(body: CreatePurchaseBundleDto) {
    // Off-catalog members have no itemId: they get a placeholder id here so
    // the normalisation below treats them like any other member, and the
    // item row itself is created inside the transaction further down.
    const offCatalogByItemId = new Map<
      string,
      {
        title: string;
        platform: string | null;
        imageUrl: string | null;
        sourceUrl: string | null;
        amountYen: number | null;
        quantity: number | null;
      }
    >();
    const resolvedMembers = body.members.map((member) => {
      if (member.itemId?.trim()) return member;
      const title = member.title?.trim();
      if (!title)
        throw new BadRequestException(
          "站外购买的商品需要填写名称，或先通过链接分析生成商品",
        );
      const placeholderId = randomUUID();
      offCatalogByItemId.set(placeholderId, {
        title,
        platform: member.platform?.trim() || body.platform?.trim() || null,
        imageUrl: member.imageUrl?.trim() || null,
        sourceUrl: member.sourceUrl?.trim() || null,
        amountYen: member.amountYen ?? null,
        quantity: member.quantity ?? null,
      });
      return { ...member, itemId: placeholderId };
    });
    const normalized = normalizePurchaseMembers(
      resolvedMembers,
      body.pricingMode,
      body.totalPurchaseAmountYen,
    );
    const purchasedAt = parsedPurchaseDate(body.purchasedAt);
    const actor = body.actor.trim();
    const reason = body.reason.trim();

    try {
      const bundle = await this.prisma.$transaction(async (tx) => {
        for (const [placeholderId, offCatalog] of offCatalogByItemId) {
          const source = await tx.source.upsert({
            where: { key: "manual_purchase" },
            create: { key: "manual_purchase", displayName: "站外购买" },
            update: {},
          });
          await tx.item.create({
            data: {
              id: placeholderId,
              sourceId: source.id,
              sourceItemId: `manual-${placeholderId}`,
              sourceUrl: offCatalog.sourceUrl ?? "",
              titleRaw: offCatalog.title,
              titleZh: offCatalog.title,
              priceCurrent: offCatalog.amountYen ?? 0,
              priceTotalEst: offCatalog.amountYen ?? 0,
              quantityEst: offCatalog.quantity ?? 1,
              importOrigin: "purchase",
              ...(offCatalog.imageUrl
                ? {
                    images: {
                      create: [{ url: offCatalog.imageUrl, position: 0 }],
                    },
                  }
                : {}),
            },
          });
        }
        const items = await tx.item.findMany({
          where: { id: { in: normalized.itemIds } },
          select: {
            id: true,
            productId: true,
            quantityEst: true,
            titleRaw: true,
            titleZh: true,
            source: { select: { displayName: true } },
            images: {
              orderBy: { position: "asc" as const },
              take: 1,
              select: { url: true },
            },
            purchaseRecord: {
              include: {
                bundle: {
                  include: { purchases: { select: { id: true } } },
                },
              },
            },
          },
        });
        if (items.length !== normalized.itemIds.length)
          throw new NotFoundException("部分购买商品不存在，请重新分析链接");
        for (const item of items) {
          if (
            item.purchaseRecord &&
            item.purchaseRecord.bundle.purchases.length !== 1
          )
            throw new ConflictException(
              "已有商品属于多商品购买批次，不能直接拆出合并",
            );
        }

        const created = await tx.purchaseBundle.create({
          data: {
            pricingMode: body.pricingMode,
            totalPurchaseAmount: normalized.totalPurchaseAmountYen,
            purchasedAt,
            note: body.note,
          },
        });

        for (const item of items) {
          const amountYen = normalized.amountByItemId.get(item.id) ?? 0;
          const quantityOverride =
            normalized.quantityByItemId.get(item.id) ?? null;
          if (item.purchaseRecord) {
            const sourceBundleId = item.purchaseRecord.bundleId;
            const source = await this.archiveMergedSingletonBundle(
              tx,
              sourceBundleId,
              actor,
              reason,
            );
            const previousQuantity = effectiveMemberQuantity({
              quantityEst: item.quantityEst,
              quantityOverride:
                (item.purchaseRecord as { quantityOverride?: number | null })
                  .quantityOverride ?? null,
            });
            await tx.purchaseRecord.update({
              where: { id: item.purchaseRecord.id },
              data: {
                bundleId: created.id,
                purchaseAmount: amountYen,
                amountAllocated: normalized.amountAllocated,
                quantityOverride,
                purchasedAt,
              },
            });
            const sourceAfter = await this.readPurchaseBundleSnapshot(
              tx,
              sourceBundleId,
            );
            await this.appendPurchaseBundleAudit(tx, {
              bundleId: sourceBundleId,
              eventType: "archived",
              actor,
              reason,
              before: source.before,
              after: sourceAfter.snapshot,
            });
          } else {
            await tx.purchaseRecord.create({
              data: {
                itemId: item.id,
                bundleId: created.id,
                purchaseAmount: amountYen,
                amountAllocated: normalized.amountAllocated,
                quantityOverride,
                purchasedAt,
                note: body.note,
              },
            });
          }
          await tx.item.update({
            where: { id: item.id },
            data: {
              favorite: false,
              ignored: false,
              archivedAt: new Date(),
              lifecycleStatus: "purchased",
            },
          });
        }

        const after = await this.readPurchaseBundleSnapshot(tx, created.id);
        await this.appendPurchaseBundleAudit(tx, {
          bundleId: created.id,
          eventType: "created",
          actor,
          reason,
          after: after.snapshot,
        });
        await this.closeNegotiationCasesForPurchasedItems(
          tx,
          normalized.itemIds,
        );
        await this.markItemsBoughtDecision(tx, normalized.itemIds, actor);
        await ensureInventoryOrderFromBundle(tx, {
          bundleId: created.id,
          purchaseCost: normalized.totalPurchaseAmountYen,
          purchasedAt,
          note: body.note,
          members: items.map((item) => ({
            quantityEst: item.quantityEst,
            quantityOverride:
              normalized.quantityByItemId.get(item.id) ?? null,
            titleZh: item.titleZh,
            titleRaw: item.titleRaw,
            platform:
              offCatalogByItemId.get(item.id)?.platform ??
              item.source.displayName,
            imageUrl: item.images[0]?.url ?? null,
          })),
        });
        return tx.purchaseBundle.findUniqueOrThrow({
          where: { id: created.id },
          include: {
            ...purchaseBundleApiInclude,
            audits: { orderBy: { createdAt: "desc" }, take: 20 },
          },
        });
      });
      return { bundle, serverTime: new Date().toISOString() };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("部分商品已被其他用户登记购买");
      throw error;
    }
  }

  async updatePurchaseBundle(id: string, body: UpdatePurchaseBundleDto) {
    const actor = body.actor.trim();
    const reason = body.reason.trim();
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await this.readPurchaseBundleSnapshot(tx, id);
      if (before.row.archivedAt)
        throw new ConflictException("已归档的购买批次不能修改");
      if (before.row.version !== body.expectedVersion)
        throw new ConflictException("购买批次已被其他用户修改，请刷新后重试");

      const pricingMode = (body.pricingMode ??
        before.row.pricingMode) as PurchasePricingMode;
      let totalPurchaseAmount = before.row.totalPurchaseAmount;
      let membersChanged = false;
      let memberAmountsChanged = false;
      let memberQuantitiesChanged = false;
      const purchasedAt = body.purchasedAt
        ? parsedPurchaseDate(body.purchasedAt)
        : before.row.purchasedAt;

      if (body.members) {
        const requestedTotal =
          pricingMode === "bundle_total"
            ? (body.totalPurchaseAmountYen ?? before.row.totalPurchaseAmount)
            : body.totalPurchaseAmountYen;
        const normalized = normalizePurchaseMembers(
          body.members,
          pricingMode,
          requestedTotal,
        );
        totalPurchaseAmount = normalized.totalPurchaseAmountYen;
        const currentByItem = new Map(
          before.row.purchases.map((purchase) => [purchase.itemId, purchase]),
        );
        const desired = new Set(normalized.itemIds);
        const removed = before.row.purchases.filter(
          (purchase) => !desired.has(purchase.itemId),
        );
        const addedIds = normalized.itemIds.filter(
          (itemId) => !currentByItem.has(itemId),
        );
        membersChanged = removed.length > 0 || addedIds.length > 0;

        if (removed.some((purchase) => !purchase.amountAllocated))
          throw new BadRequestException(
            "打包总价尚未分摊，移除成员前请先切换为按单价模式并填写全部单价",
          );

        const desiredItems = await tx.item.findMany({
          where: { id: { in: normalized.itemIds } },
          select: {
            id: true,
            productId: true,
            quantityEst: true,
            purchaseRecord: {
              include: {
                bundle: {
                  include: { purchases: { select: { id: true } } },
                },
              },
            },
          },
        });
        if (desiredItems.length !== normalized.itemIds.length)
          throw new NotFoundException("部分购买商品不存在，请重新分析链接");

        for (const purchase of removed) {
          const detached = await tx.purchaseBundle.create({
            data: {
              pricingMode: "per_item",
              totalPurchaseAmount: purchase.purchaseAmount,
              purchasedAt: purchase.purchasedAt,
              note: purchase.note,
            },
          });
          await tx.purchaseRecord.update({
            where: { id: purchase.id },
            data: { bundleId: detached.id },
          });
          const detachedAfter = await this.readPurchaseBundleSnapshot(
            tx,
            detached.id,
          );
          await this.appendPurchaseBundleAudit(tx, {
            bundleId: detached.id,
            eventType: "created",
            actor,
            reason,
            after: detachedAfter.snapshot,
          });
        }

        for (const item of desiredItems) {
          const amountYen = normalized.amountByItemId.get(item.id) ?? 0;
          const quantityOverride =
            normalized.quantityByItemId.get(item.id) ?? null;
          const current = currentByItem.get(item.id);
          if (current) {
            if (
              current.purchaseAmount !== amountYen ||
              current.amountAllocated !== normalized.amountAllocated
            )
              memberAmountsChanged = true;
            const previousQuantity = effectiveMemberQuantity({
              quantityEst: item.quantityEst,
              quantityOverride:
                (current as { quantityOverride?: number | null })
                  .quantityOverride ?? null,
            });
            const nextQuantity = effectiveMemberQuantity({
              quantityEst: item.quantityEst,
              quantityOverride,
            });
            if (previousQuantity !== nextQuantity)
              memberQuantitiesChanged = true;
            await tx.purchaseRecord.update({
              where: { id: current.id },
              data: {
                purchaseAmount: amountYen,
                amountAllocated: normalized.amountAllocated,
                quantityOverride,
                purchasedAt,
              },
            });
            continue;
          }

          if (item.purchaseRecord) {
            if (item.purchaseRecord.bundle.purchases.length !== 1)
              throw new ConflictException(
                "新增商品已属于多商品购买批次，不能直接拆出合并",
              );
            const sourceBundleId = item.purchaseRecord.bundleId;
            const source = await this.archiveMergedSingletonBundle(
              tx,
              sourceBundleId,
              actor,
              reason,
            );
            const previousQuantity = effectiveMemberQuantity({
              quantityEst: item.quantityEst,
              quantityOverride:
                (item.purchaseRecord as { quantityOverride?: number | null })
                  .quantityOverride ?? null,
            });
            await tx.purchaseRecord.update({
              where: { id: item.purchaseRecord.id },
              data: {
                bundleId: id,
                purchaseAmount: amountYen,
                amountAllocated: normalized.amountAllocated,
                quantityOverride,
                purchasedAt,
              },
            });
            const sourceAfter = await this.readPurchaseBundleSnapshot(
              tx,
              sourceBundleId,
            );
            await this.appendPurchaseBundleAudit(tx, {
              bundleId: sourceBundleId,
              eventType: "archived",
              actor,
              reason,
              before: source.before,
              after: sourceAfter.snapshot,
            });
          } else {
            await tx.purchaseRecord.create({
              data: {
                itemId: item.id,
                bundleId: id,
                purchaseAmount: amountYen,
                amountAllocated: normalized.amountAllocated,
                quantityOverride,
                purchasedAt,
                note: body.note ?? before.row.note,
              },
            });
          }
          await tx.item.update({
            where: { id: item.id },
            data: {
              favorite: false,
              ignored: false,
              archivedAt: new Date(),
              lifecycleStatus: "purchased",
            },
          });
        }
        // Members (re)confirmed by an edit are purchases too: close any
        // negotiation that is still open for them, same as on create.
        await this.closeNegotiationCasesForPurchasedItems(
          tx,
          normalized.itemIds,
        );
        await this.markItemsBoughtDecision(tx, normalized.itemIds, actor);
      } else {
        if (pricingMode !== before.row.pricingMode)
          throw new BadRequestException(
            "切换计价模式时必须同时提交完整成员及其金额",
          );
        if (
          pricingMode === "per_item" &&
          body.totalPurchaseAmountYen != null &&
          body.totalPurchaseAmountYen !== before.row.totalPurchaseAmount
        )
          throw new BadRequestException(
            "按单价模式请通过 members 修改商品金额，批次总价会自动计算",
          );
        if (body.totalPurchaseAmountYen != null)
          totalPurchaseAmount = body.totalPurchaseAmountYen;
        if (body.purchasedAt)
          await tx.purchaseRecord.updateMany({
            where: { bundleId: id },
            data: { purchasedAt },
          });
      }

      const priceChanged =
        totalPurchaseAmount !== before.row.totalPurchaseAmount ||
        pricingMode !== before.row.pricingMode ||
        memberAmountsChanged ||
        memberQuantitiesChanged;
      const updated = await tx.purchaseBundle.updateMany({
        where: { id, version: body.expectedVersion, archivedAt: null },
        data: {
          pricingMode,
          totalPurchaseAmount,
          purchasedAt,
          ...(body.note === undefined ? {} : { note: body.note }),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new ConflictException("购买批次已被其他用户修改，请刷新后重试");

      const after = await this.readPurchaseBundleSnapshot(tx, id);
      await this.appendPurchaseBundleAudit(tx, {
        bundleId: id,
        eventType: membersChanged
          ? "members_changed"
          : priceChanged
            ? "price_changed"
            : "updated",
        actor,
        reason,
        before: before.snapshot,
        after: after.snapshot,
      });
      // Dual-write: create linked inventory order if missing; resync
      // purchaseCost/initialQuantity only when remaining===initial and no sales.
      await this.syncLinkedInventoryOrder(tx, after.row);
      return tx.purchaseBundle.findUniqueOrThrow({
        where: { id },
        include: {
          ...purchaseBundleApiInclude,
          audits: { orderBy: { createdAt: "desc" }, take: 100 },
        },
      });
    });
    return { bundle: result, serverTime: new Date().toISOString() };
  }

  async listPurchaseBundles(query: ListPurchaseBundlesQuery) {
    const page = Math.max(1, query.page);
    const limit = Math.max(1, Math.min(100, query.limit));
    const where = {
      archivedAt: null,
    } satisfies Prisma.PurchaseBundleWhereInput;
    const [bundles, total, aggregate] = await this.prisma.$transaction([
      this.prisma.purchaseBundle.findMany({
        where,
        include: purchaseBundleApiInclude,
        orderBy: [{ purchasedAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.purchaseBundle.count({ where }),
      this.prisma.purchaseBundle.aggregate({
        where,
        _sum: { totalPurchaseAmount: true },
      }),
    ]);
    return {
      bundles,
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
      grandTotalPurchaseAmountYen: aggregate._sum.totalPurchaseAmount ?? 0,
      serverTime: new Date().toISOString(),
    };
  }

  async getPurchaseBundle(id: string) {
    const bundle = await this.prisma.purchaseBundle.findUnique({
      where: { id },
      include: {
        ...purchaseBundleApiInclude,
        audits: { orderBy: { createdAt: "desc" }, take: 500 },
      },
    });
    if (!bundle) throw new NotFoundException("购买批次不存在");
    return { bundle, serverTime: new Date().toISOString() };
  }

  // Legacy single-item endpoint. Registration itself goes through
  // createPurchaseBundle so both entry points share one field handling,
  // one inventory dual-write and one negotiation auto-close; this method
  // only adds the receipt attachment the bundle API does not carry.
  async purchase(id: string, body: PurchaseDto) {
    const receiptSize = body.receiptDataBase64
      ? Buffer.byteLength(body.receiptDataBase64, "base64")
      : 0;
    if (receiptSize > 3 * 1024 * 1024)
      throw new BadRequestException("购买凭证图片不能超过 3MB");
    if (body.receiptDataBase64 && !body.receiptMimeType?.startsWith("image/"))
      throw new BadRequestException("购买凭证必须是图片文件");
    const verified = receiptSize > 0;

    const { bundle } = await this.createPurchaseBundle({
      pricingMode: "per_item",
      members: [
        {
          itemId: id,
          amountYen: body.purchaseAmount,
          ...(body.quantity != null ? { quantity: body.quantity } : {}),
        },
      ],
      totalPurchaseAmountYen: body.purchaseAmount,
      purchasedAt: body.purchasedAt,
      note: body.note,
      actor: body.actor?.trim() || "shared-user",
      reason:
        body.reason?.trim() || "通过单商品购买接口记录或更新购买信息",
    } as CreatePurchaseBundleDto);
    const recordSummary = bundle.purchases.find(
      (entry) => entry.itemId === id,
    );
    if (!recordSummary) throw new NotFoundException("Item not found");

    const record = await this.prisma.$transaction(async (tx) => {
      if (body.receiptDataBase64) {
        await tx.purchaseRecord.update({
          where: { id: recordSummary.id },
          data: { verifiedAt: new Date() },
        });
        await tx.purchaseReceipt.create({
          data: {
            purchaseId: recordSummary.id,
            fileName:
              body.receiptFileName?.slice(0, 200) ?? "purchase-receipt.png",
            mimeType: body.receiptMimeType!,
            sizeBytes: receiptSize,
            dataBase64: body.receiptDataBase64!,
          },
        });
      }
      return tx.purchaseRecord.findUniqueOrThrow({
        where: { id: recordSummary.id },
        include: {
          receipts: { select: purchaseReceiptSelect },
          bundle: true,
          item: { include },
        },
      });
    });
    return {
      purchase: record,
      verified,
      serverTime: new Date().toISOString(),
    };
  }

  async listPurchases() {
    const [purchases, totals] = await this.prisma.$transaction([
      this.prisma.purchaseRecord.findMany({
        include: {
          receipts: { select: purchaseReceiptSelect },
          bundle: true,
          item: { include },
        },
        orderBy: { purchasedAt: "desc" },
      }),
      this.prisma.purchaseBundle.aggregate({
        where: { archivedAt: null },
        _sum: { totalPurchaseAmount: true },
      }),
    ]);
    return {
      purchases,
      total: purchases.length,
      totalPurchaseAmountYen: totals._sum.totalPurchaseAmount ?? 0,
      serverTime: new Date().toISOString(),
    };
  }

  async listSellers(search?: string, page = 1, limit = 60, segment?: string) {
    const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(100, Math.floor(limit)))
      : 60;
    const visibleItemWhere = activeMarketItemWhere();
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
      ...activeMarketItemWhere(),
      sellerId: id,
    } satisfies Prisma.ItemWhereInput;
    const [seller, segmentItems] = await Promise.all([
      this.prisma.seller.findUnique({
        where: { id },
        include: {
          source: { select: { key: true, displayName: true } },
          items: {
            where: activeMarketItemWhere(),
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

  async update(id: string, body: UpdateItemDto) {
    const current = await this.ensureExists(id);
    const { actor = "operator", reason, ...changes } = body;
    if (changes.note != null && changes.note.length > 25)
      throw new BadRequestException("采购备注不能超过 25 个字符");
    if (changes.favorite === true && changes.ignored === true)
      throw new BadRequestException("商品不能同时收藏并标记为不感兴趣");
    if (changes.ignored === true) {
      (changes as Prisma.ItemUpdateInput).ignoredAt = new Date();
      (changes as Prisma.ItemUpdateInput).ignoredReason = "manual";
      (changes as Prisma.ItemUpdateInput).lifecycleStatus = "disliked";
      changes.favorite = false;
    } else if (changes.ignored === false) {
      (changes as Prisma.ItemUpdateInput).ignoredAt = null;
      (changes as Prisma.ItemUpdateInput).ignoredReason = null;
      // Lifting a dislike returns the row to the lifecycle its other
      // fields imply; on a row that was not disliked nothing changes.
      if (current.ignored)
        (changes as Prisma.ItemUpdateInput).lifecycleStatus =
          await this.restoredLifecycle(id, current);
    }
    if (changes.favorite === true) {
      changes.ignored = false;
      (changes as Prisma.ItemUpdateInput).ignoredAt = null;
      (changes as Prisma.ItemUpdateInput).ignoredReason = null;
      if (current.ignored)
        (changes as Prisma.ItemUpdateInput).lifecycleStatus =
          await this.restoredLifecycle(id, current);
    }
    const changedKeys = Object.entries(changes)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    const isCollaborativePatch =
      changedKeys.length > 0 &&
      changedKeys.every((key) =>
        [
          "favorite",
          "ignored",
          "ignoredAt",
          "ignoredReason",
          "lifecycleStatus",
          "note",
        ].includes(
          key,
        ),
      );
    if (isCollaborativePatch) {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.item.update({
          where: { id },
          data: changes as Prisma.ItemUpdateInput,
          select: syncSelect,
        });
        const managerAction =
          updated.favorite && !current.favorite
            ? "favorite"
            : updated.ignored && !current.ignored
              ? "dislike"
              : null;
        if (managerAction) {
          const manager = await tx.managerAccount.findFirst({
            where: { id: actor, active: true },
            select: { id: true },
          });
          if (manager) {
            await tx.managerActivity.create({
              data: {
                accountId: manager.id,
                action: managerAction,
                itemId: id,
              },
            });
          }
        }
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
        const normalized = itemResponseWithChinaComparison(updated);
        const { product: _comparisonRelation, ...item } = normalized;
        return { item, serverTime: new Date().toISOString() };
      });
    }
    const quantity = changes.quantityEst ?? current.quantityEst;
    const unitCostEst =
      quantity &&
      quantity > 0 &&
      current.listingType === "direct" &&
      current.shippingFee != null
        ? Math.round((current.priceCurrent + current.shippingFee) / quantity)
        : null;
    const shf =
      changes.categoryIp !== undefined
        ? classifyShfListing({
            titleRaw: current.titleRaw,
            descriptionRaw: current.descriptionRaw,
            categoryIp: changes.categoryIp,
          })
        : undefined;
    const collectibleSeries =
      changes.categoryIp !== undefined
        ? classifyCollectibleSeries({
            titleRaw: current.titleRaw,
            descriptionRaw: current.descriptionRaw,
            categoryIp: changes.categoryIp,
          })
        : undefined;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.item.update({
        where: { id },
        data: {
          ...changes,
          categoryIp: changes.categoryIp as CategoryIp | undefined,
          categoryToyType: changes.categoryToyType as ToyType | undefined,
          ...(shf !== undefined
            ? {
                shfLine: shf?.line ?? null,
                shfReleaseChannel: shf?.releaseChannel ?? null,
                shfEdition: shf?.edition ?? null,
                shfRegion: shf?.region ?? null,
                collectibleSeries,
              }
            : {}),
          manufacturer: changes.manufacturer as Manufacturer | undefined,
          conditionGrade: changes.conditionGrade as ConditionGrade | undefined,
          unitCostEst,
          needsReview:
            changes.confidence != null
              ? changes.confidence < 0.9
              : current.needsReview,
          matchDecision: "manually_matched",
        },
        include: itemResponseInclude,
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
      return {
        item: itemResponseWithChinaComparison(updated),
        serverTime: new Date().toISOString(),
      };
    });
  }

  // Pure delete: stamp the tombstone only. The row stays as the
  // (sourceId, sourceItemId) marker so the listing never comes back, and
  // nothing here touches ignored/archivedAt/status or any preference log.
  async removeItem(
    id: string,
    body: { actor?: string } = {},
  ) {
    const current = await this.ensureExists(id);
    if (current.deletedAt) {
      return { deleted: true, serverTime: new Date().toISOString() };
    }
    const actor = body.actor?.trim() || "operator";
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.item.findUnique({
        where: { id },
        select: {
          deletedAt: true,
          purchaseRecord: { select: { id: true } },
          resaleListing: { select: { id: true } },
        },
      });
      if (!existing) throw new NotFoundException("Item not found");
      if (existing.deletedAt) return;
      if (existing.purchaseRecord || existing.resaleListing)
        throw new ConflictException(
          "已购买或已建转售记录的商品不能删除",
        );
      const deletedAt = new Date();
      const updated = await tx.item.update({
        where: { id },
        data: { deletedAt, lifecycleStatus: "deleted" },
        select: syncSelect,
      });
      await tx.shoppingCartItem.deleteMany({ where: { itemId: id } });
      await tx.manualReview.create({
        data: {
          itemId: id,
          actor,
          reason: "manual_delete",
          beforeData: JSON.parse(
            JSON.stringify(current),
          ) as Prisma.InputJsonValue,
          afterData: JSON.parse(
            JSON.stringify(updated),
          ) as Prisma.InputJsonValue,
        },
      });
    });
    return { deleted: true, serverTime: new Date().toISOString() };
  }

  private async restoredLifecycle(
    id: string,
    current: { status: string; archivedAt: Date | null; deletedAt: Date | null },
  ) {
    const purchase = await this.prisma.purchaseRecord.findUnique({
      where: { itemId: id },
      select: { id: true },
    });
    return restoredLifecycleStatus(current, Boolean(purchase));
  }

  private async ensureExists(id: string) {
    const item = await this.prisma.item.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("Item not found");
    return item;
  }
}
