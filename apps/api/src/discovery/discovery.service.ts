import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  CrossMarketOpportunityStatus,
  DiscoveryAction,
  ItemStatus,
  ListingType,
  Prisma,
} from "@tokusatsu/db";
import {
  assessProcurementCandidate,
  procurementCategories,
  procurementConfigFromEnv,
  procurementLogisticsEvidence,
  rankProcurementCandidates,
  type ProcurementAssessment,
} from "@tokusatsu/shared";
import { activeMarketItemWhere } from "../items/active-market-scope.js";
import { PrismaService } from "../prisma.service.js";
import {
  itemResponseWithChinaComparison,
  readyChinaComparisonRelation,
} from "../items/item-response.js";
import type { DiscoveryFeedbackDto } from "./discovery.dto.js";

const procurementConfig = procurementConfigFromEnv(process.env);
const procurementCategoryRank = new Map(
  procurementCategories.map((category, index) => [category, index]),
);

function noWorseProcurementCategory(
  candidate: ProcurementAssessment,
  displaced: ProcurementAssessment,
) {
  return (
    (procurementCategoryRank.get(candidate.category) ??
      Number.MAX_SAFE_INTEGER) <=
    (procurementCategoryRank.get(displaced.category) ?? Number.MAX_SAFE_INTEGER)
  );
}

const feedSelect = {
  id: true,
  productId: true,
  sourceUrl: true,
  titleRaw: true,
  titleZh: true,
  priceCurrent: true,
  shippingFee: true,
  priceTotalEst: true,
  listedAt: true,
  detectedAt: true,
  auctionEndAt: true,
  listingType: true,
  categoryIp: true,
  categoryToyType: true,
  conditionGrade: true,
  quantityEst: true,
  unitCostEst: true,
  note: true,
  logistics: {
    select: {
      volumeCm3: true,
      lengthMm: true,
      widthMm: true,
      heightMm: true,
      notes: true,
    },
  },
  source: { select: { key: true, displayName: true } },
  images: {
    orderBy: { position: "asc" as const },
    select: { url: true, position: true },
  },
  product: {
    select: {
      canonicalName: true,
      titleZh: true,
      series: { select: { nameZh: true, nameJa: true } },
      toyTypeEntity: { select: { nameZh: true, nameJa: true } },
      marketComparisons: readyChinaComparisonRelation,
    },
  },
} satisfies Prisma.ItemSelect;

type FeedItem = Prisma.ItemGetPayload<{ select: typeof feedSelect }>;

const collaborationSelect = {
  id: true,
  productId: true,
  favorite: true,
  ignored: true,
  ignoredAt: true,
  archivedAt: true,
  deletedAt: true,
  status: true,
  purchaseRecord: { select: { id: true } },
  note: true,
  updatedAt: true,
} satisfies Prisma.ItemSelect;
type CollaborationItem = Prisma.ItemGetPayload<{
  select: typeof collaborationSelect;
}>;

type PreferenceState = {
  favorite: boolean;
  ignored: boolean;
  ignoredAt: string | null;
};

function preferenceStateFromJson(
  value: Prisma.JsonValue,
): PreferenceState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const favorite = value.favorite;
  const ignored = value.ignored;
  const ignoredAt = value.ignoredAt;
  if (typeof favorite !== "boolean" || typeof ignored !== "boolean")
    return null;
  if (ignoredAt !== null && typeof ignoredAt !== "string") return null;
  if (typeof ignoredAt === "string" && Number.isNaN(Date.parse(ignoredAt)))
    return null;
  return {
    favorite,
    ignored,
    ignoredAt: ignoredAt ? new Date(ignoredAt).toISOString() : null,
  };
}

function preferenceStateFromItem(item: CollaborationItem): PreferenceState {
  return {
    favorite: item.favorite,
    ignored: item.ignored,
    ignoredAt: item.ignoredAt?.toISOString() ?? null,
  };
}

function samePreferenceState(
  item: CollaborationItem,
  expected: PreferenceState,
) {
  const current = preferenceStateFromItem(item);
  return (
    current.favorite === expected.favorite &&
    current.ignored === expected.ignored &&
    current.ignoredAt === expected.ignoredAt
  );
}

function canReturnToDiscovery(item: CollaborationItem) {
  return (
    !item.archivedAt &&
    !item.deletedAt &&
    !item.purchaseRecord &&
    (item.status === ItemStatus.active || item.status === ItemStatus.unknown) &&
    !item.favorite &&
    !item.ignored &&
    !item.ignoredAt
  );
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002",
  );
}

// Profit evidence is used only to order discovery candidates.
// Keep this projection local and minimal so it cannot become part of the
// public Item contract by accident.
const readyCrossMarketOpportunityRelation = {
  where: { status: CrossMarketOpportunityStatus.ready },
  select: {
    netProfitJpy: true,
    netMarginRatio: true,
  },
  orderBy: [
    { netProfitJpy: { sort: "desc" as const, nulls: "last" as const } },
    { evaluatedAt: "desc" as const },
  ],
  take: 1,
} satisfies Prisma.CrossMarketOpportunityFindManyArgs;

const rankingSelect = {
  id: true,
  listingType: true,
  titleRaw: true,
  priceCurrent: true,
  shippingFee: true,
  categoryToyType: true,
  conditionGrade: true,
  quantityEst: true,
  detectedAt: true,
  logistics: {
    select: {
      volumeCm3: true,
      lengthMm: true,
      widthMm: true,
      heightMm: true,
      notes: true,
    },
  },
  crossMarketOpportunities: readyCrossMarketOpportunityRelation,
} satisfies Prisma.ItemSelect;

type RankingItem = Prisma.ItemGetPayload<{ select: typeof rankingSelect }>;

function rankDiscoveryCandidates(candidates: readonly RankingItem[]) {
  return rankProcurementCandidates(candidates, procurementConfig).sort(
    (left, right) => {
      const leftOpportunity = left.candidate.crossMarketOpportunities?.[0];
      const rightOpportunity = right.candidate.crossMarketOpportunities?.[0];
      if (Boolean(leftOpportunity) !== Boolean(rightOpportunity))
        return leftOpportunity ? -1 : 1;
      if (leftOpportunity && rightOpportunity) {
        const profitDifference =
          Number(rightOpportunity.netProfitJpy ?? 0) -
          Number(leftOpportunity.netProfitJpy ?? 0);
        if (profitDifference) return profitDifference;
        const marginDifference =
          Number(rightOpportunity.netMarginRatio ?? 0) -
          Number(leftOpportunity.netMarginRatio ?? 0);
        if (marginDifference) return marginDifference;
      }
      return 0;
    },
  );
}

type RankedDiscoveryCandidate = ReturnType<
  typeof rankDiscoveryCandidates
>[number];
type DiscoveryRankingCacheKey = ListingType | "all";
type DiscoveryRankingSnapshot = {
  eligibilityKey: string;
  expiresAt: number;
  rankedCandidates: RankedDiscoveryCandidate[];
  total: number;
};
type DiscoveryRankingRequest = {
  eligibilityKey: string;
  revision: number;
  promise: Promise<DiscoveryRankingSnapshot>;
};

function boundedIntegerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(process.env[name]?.trim());
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, Math.floor(parsed)))
    : fallback;
}

function discoveryItemResponse(
  item: FeedItem,
  procurement: ProcurementAssessment = assessProcurementCandidate(
    { ...item, logistics: procurementLogisticsEvidence(item.logistics) },
    procurementConfig,
  ),
) {
  const { logistics: _logistics, ...publicItem } = item;
  return {
    ...itemResponseWithChinaComparison(publicItem),
    procurement,
  };
}

function eligibleWhere(
  excludedListingIds: string[],
  listingType?: ListingType,
): Prisma.ItemWhereInput {
  return {
    ...activeMarketItemWhere(),
    id: excludedListingIds.length ? { notIn: excludedListingIds } : undefined,
    favorite: false,
    listingType,
  };
}

function discoveryFacets(
  rows: ReadonlyArray<{
    listingType: ListingType;
    _count: { _all: number };
  }>,
) {
  const facets: Record<ListingType, number> = {
    direct: 0,
    auction: 0,
    unknown: 0,
  };
  for (const row of rows) facets[row.listingType] = row._count._all;
  return facets;
}

@Injectable()
export class DiscoveryService {
  private readonly rankingCache = new Map<
    DiscoveryRankingCacheKey,
    DiscoveryRankingSnapshot
  >();
  private readonly rankingRequests = new Map<
    DiscoveryRankingCacheKey,
    DiscoveryRankingRequest
  >();
  private readonly rankingCacheTtlMs = boundedIntegerEnv(
    "DISCOVERY_RANKING_CACHE_TTL_MS",
    1_000,
    250,
    5_000,
  );
  private readonly maxConcurrentScans = boundedIntegerEnv(
    "DISCOVERY_MAX_CONCURRENT_SCANS",
    2,
    1,
    4,
  );
  private readonly maxQueuedScans = boundedIntegerEnv(
    "DISCOVERY_MAX_QUEUED_SCANS",
    8,
    1,
    32,
  );
  private readonly scanWaiters: Array<() => void> = [];
  private activeScans = 0;
  private rankingRevision = 0;

  constructor(private readonly prisma: PrismaService) {}

  private cacheKey(listingType?: ListingType): DiscoveryRankingCacheKey {
    return listingType ?? "all";
  }

  private eligibilityKey(listingIds: readonly string[]) {
    return [...listingIds].sort().join("|");
  }

  private invalidateRankingCache() {
    this.rankingRevision += 1;
    this.rankingCache.clear();
  }

  private async acquireScanPermit() {
    if (this.activeScans < this.maxConcurrentScans) {
      this.activeScans += 1;
      return;
    }
    if (this.scanWaiters.length >= this.maxQueuedScans)
      throw new ServiceUnavailableException("发现流正在更新，请稍后重试");
    await new Promise<void>((resolve) => this.scanWaiters.push(resolve));
  }

  private releaseScanPermit() {
    const next = this.scanWaiters.shift();
    if (next) next();
    else this.activeScans -= 1;
  }

  private async withScanPermit<T>(work: () => Promise<T>) {
    await this.acquireScanPermit();
    try {
      return await work();
    } finally {
      this.releaseScanPermit();
    }
  }

  private rankingSnapshot(
    where: Prisma.ItemWhereInput,
    key: DiscoveryRankingCacheKey,
    eligibilityKey: string,
  ) {
    const cached = this.rankingCache.get(key);
    if (
      cached &&
      cached.expiresAt > Date.now() &&
      cached.eligibilityKey === eligibilityKey
    ) {
      return Promise.resolve(cached);
    }
    if (cached) this.rankingCache.delete(key);

    const revision = this.rankingRevision;
    const current = this.rankingRequests.get(key);
    if (
      current &&
      current.revision === revision &&
      current.eligibilityKey === eligibilityKey
    )
      return current.promise;

    const promise = this.withScanPermit(async () => {
      // Discovery is intentionally ranked against the complete eligible market,
      // not just the newest page. A single ordered projection preserves full-
      // library semantics while request coalescing prevents concurrent clients
      // from repeating the same database scan and application ranking work.
      const candidates = await this.prisma.item.findMany({
        where,
        select: rankingSelect,
        orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
      });
      const rankedCandidates = rankDiscoveryCandidates(
        candidates.map((candidate) => ({
          ...candidate,
          logistics: procurementLogisticsEvidence(candidate.logistics),
        })),
      );
      const snapshot = {
        eligibilityKey,
        expiresAt: Date.now() + this.rankingCacheTtlMs,
        rankedCandidates,
        total: candidates.length,
      } satisfies DiscoveryRankingSnapshot;
      if (this.rankingRevision === revision)
        this.rankingCache.set(key, snapshot);
      return snapshot;
    });
    const request = { eligibilityKey, revision, promise };
    this.rankingRequests.set(key, request);
    const clearRequest = () => {
      if (this.rankingRequests.get(key) === request)
        this.rankingRequests.delete(key);
    };
    void promise.then(clearRequest, clearRequest);
    return promise;
  }

  async feed(limit: number, listingType?: ListingType) {
    for (let attempt = 0; ; attempt += 1) {
      const consumed = await this.prisma.discoveryFeedback.findMany({
        where: {
          action: { in: [DiscoveryAction.dislike, DiscoveryAction.favorite] },
          undoEvents: { none: {} },
        },
        distinct: ["listingId"],
        select: { listingId: true },
      });
      const consumedIds = consumed.map(({ listingId }) => listingId);
      const where = eligibleWhere(consumedIds, listingType);
      const [snapshot, facetRows] = await Promise.all([
        this.rankingSnapshot(
          where,
          this.cacheKey(listingType),
          this.eligibilityKey(consumedIds),
        ),
        this.prisma.item.groupBy({
          by: ["listingType"],
          where: eligibleWhere(consumedIds),
          _count: { _all: true },
        }),
      ]);
      const items = snapshot.rankedCandidates.slice(0, limit);

      // Apply marketplace-mode diversity after procurement ranking so the
      // countdown card stays visible without weakening the rest of the order.
      if (!listingType && limit >= 3 && items.length >= 3) {
        const topTypes = new Set(
          items.slice(0, 3).map(({ candidate }) => candidate.listingType),
        );
        const missingType = !topTypes.has(ListingType.auction)
          ? ListingType.auction
          : !topTypes.has(ListingType.direct)
            ? ListingType.direct
            : null;

        if (missingType) {
          const promoted = snapshot.rankedCandidates.find(
            ({ candidate }) => candidate.listingType === missingType,
          );
          if (promoted) {
            const displaced = items[2];
            if (
              noWorseProcurementCategory(
                promoted.assessment,
                displaced.assessment,
              )
            ) {
              const currentIndex = items.findIndex(
                ({ candidate }) => candidate.id === promoted.candidate.id,
              );
              if (currentIndex >= 0) items.splice(currentIndex, 1);
              items.splice(2, 0, promoted);
              items.splice(limit);
            }
          }
        }
      }
      const itemIds = items.map(({ candidate }) => candidate.id);
      const hydrated = itemIds.length
        ? await this.prisma.item.findMany({
            where: { AND: [where, { id: { in: itemIds } }] },
            select: feedSelect,
          })
        : [];

      // A collaboration or lifecycle write can land after a snapshot was
      // ranked. Hydration always rechecks the canonical eligibility predicate;
      // if it rejected a card, rebuild once so the requested stack stays full.
      if (hydrated.length !== items.length && attempt === 0) {
        this.invalidateRankingCache();
        continue;
      }
      const hydratedById = new Map(hydrated.map((item) => [item.id, item]));
      return {
        items: items.flatMap(({ candidate, assessment }) => {
          const item = hydratedById.get(candidate.id);
          return item ? [discoveryItemResponse(item, assessment)] : [];
        }),
        total: snapshot.total,
        facets: discoveryFacets(facetRows),
        serverTime: new Date().toISOString(),
      };
    }
  }

  private async recordListingChange(
    tx: Prisma.TransactionClient,
    before: CollaborationItem,
    data: Prisma.ItemUpdateInput,
    reason: string,
    actor = "discovery",
  ) {
    const updated = await tx.item.update({
      where: { id: before.id },
      data,
      select: collaborationSelect,
    });
    await tx.manualReview.create({
      data: {
        itemId: before.id,
        actor,
        reason,
        beforeData: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue,
        afterData: JSON.parse(JSON.stringify(updated)) as Prisma.InputJsonValue,
      },
    });
  }

  async feedback(body: DiscoveryFeedbackDto) {
    const action = body.action as DiscoveryAction;
    const feedback = await this.prisma.$transaction(async (tx) => {
      const listing = await tx.item.findUnique({
        where: { id: body.listingId },
        select: collaborationSelect,
      });
      if (!listing || listing.archivedAt || listing.deletedAt)
        throw new NotFoundException("商品已下架或不存在");
      const record = await tx.discoveryFeedback.create({
        data: {
          listingId: listing.id,
          productId: listing.productId,
          action,
          position: body.position,
        },
      });
      if (
        action === DiscoveryAction.favorite &&
        (!listing.favorite || listing.ignored || listing.ignoredAt)
      ) {
        await this.recordListingChange(
          tx,
          listing,
          listing.ignored || listing.ignoredAt
            ? { favorite: true, ignored: false, ignoredAt: null }
            : { favorite: true },
          `discovery:${record.id}:favorite`,
          body.accountId,
        );
      }
      if (action === DiscoveryAction.dislike) {
        await this.recordListingChange(
          tx,
          listing,
          {
            favorite: false,
            ignored: true,
            ignoredAt: new Date(),
            ignoredReason: "manual",
          },
          `discovery:${record.id}:dislike`,
          body.accountId,
        );
      }
      if (
        body.accountId &&
        (action === DiscoveryAction.favorite ||
          action === DiscoveryAction.dislike)
      ) {
        const manager = await tx.managerAccount.findFirst({
          where: { id: body.accountId, active: true },
          select: { id: true },
        });
        if (manager) {
          await tx.managerActivity.create({
            data: {
              accountId: manager.id,
              action:
                action === DiscoveryAction.favorite ? "favorite" : "dislike",
              itemId: listing.id,
            },
          });
        }
      }
      return record;
    });
    this.invalidateRankingCache();
    return { feedback, serverTime: new Date().toISOString() };
  }

  async undo(feedbackId: string): Promise<{
    feedback: Awaited<
      ReturnType<Prisma.TransactionClient["discoveryFeedback"]["create"]>
    >;
    item: ReturnType<typeof discoveryItemResponse> | null;
    serverTime: string;
  }> {
    let result: {
      feedback: Awaited<
        ReturnType<Prisma.TransactionClient["discoveryFeedback"]["create"]>
      >;
      item: FeedItem | null;
    };
    for (let raceRetries = 0; ; raceRetries += 1) {
      try {
        result = await this.prisma.$transaction(async (tx) => {
          const original = await tx.discoveryFeedback.findUnique({
            where: { id: feedbackId },
            include: {
              undoEvents: { orderBy: { timestamp: "desc" }, take: 1 },
            },
          });
          if (!original) throw new NotFoundException("找不到可撤销的发现操作");
          if (
            original.action !== DiscoveryAction.dislike &&
            original.action !== DiscoveryAction.favorite
          )
            throw new BadRequestException("只有不感兴趣或收藏操作可以撤销");

          const sourceReview = await tx.manualReview.findFirst({
            where: {
              itemId: original.listingId,
              reason: `discovery:${original.id}:${original.action}`,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { beforeData: true, afterData: true },
          });
          const previousState = sourceReview
            ? preferenceStateFromJson(sourceReview.beforeData)
            : null;
          const appliedState = sourceReview
            ? preferenceStateFromJson(sourceReview.afterData)
            : null;

          const existingUndo = original.undoEvents[0];
          if (existingUndo) {
            if (!previousState) return { feedback: existingUndo, item: null };
            const current = await tx.item.findUnique({
              where: { id: original.listingId },
              select: collaborationSelect,
            });
            if (
              !current ||
              !samePreferenceState(current, previousState) ||
              !canReturnToDiscovery(current)
            )
              return { feedback: existingUndo, item: null };
            const item = await tx.item.findUnique({
              where: { id: original.listingId },
              select: feedSelect,
            });
            return { feedback: existingUndo, item };
          }

          // A repeated favorite on an already-favorited listing intentionally has
          // no change snapshot. Guessing a previous state here could undo another
          // collaborator's action, so historical/no-op feedback stays untouched.
          if (!previousState || !appliedState)
            throw new ConflictException(
              "原操作缺少可验证的状态记录，不能安全撤销",
            );

          const before = await tx.item.findUnique({
            where: { id: original.listingId },
            select: collaborationSelect,
          });
          if (!before) throw new NotFoundException("商品已不存在");
          if (before.archivedAt)
            throw new ConflictException("商品已归档，不能恢复到发现页");
          if (before.deletedAt)
            throw new ConflictException("商品已被删除，不能恢复到发现页");
          if (before.purchaseRecord)
            throw new ConflictException("已购买商品不能恢复到发现页");
          if (
            before.status !== ItemStatus.active &&
            before.status !== ItemStatus.unknown
          )
            throw new ConflictException("商品已下架或结束，不能恢复到发现页");
          if (!samePreferenceState(before, appliedState))
            throw new ConflictException(
              "商品状态已被其他操作更新，不能覆盖后续修改",
            );

          const feedback = await tx.discoveryFeedback.create({
            data: {
              listingId: original.listingId,
              productId: original.productId,
              action: DiscoveryAction.undo,
              position: original.position,
              undoOfId: original.id,
            },
          });
          const restored = await tx.item.updateMany({
            where: {
              id: before.id,
              favorite: appliedState.favorite,
              ignored: appliedState.ignored,
              ignoredAt: appliedState.ignoredAt
                ? new Date(appliedState.ignoredAt)
                : null,
              archivedAt: null,
              deletedAt: null,
              status: { in: [ItemStatus.active, ItemStatus.unknown] },
              purchaseRecord: { is: null },
            },
            data: {
              favorite: previousState.favorite,
              ignored: previousState.ignored,
              ignoredAt: previousState.ignoredAt
                ? new Date(previousState.ignoredAt)
                : null,
            },
          });
          if (restored.count !== 1)
            throw new ConflictException(
              "商品状态已被其他操作更新，不能覆盖后续修改",
            );
          const after = await tx.item.findUnique({
            where: { id: original.listingId },
            select: collaborationSelect,
          });
          if (!after) throw new NotFoundException("商品已不存在");
          await tx.manualReview.create({
            data: {
              itemId: before.id,
              actor: "discovery",
              reason: `discovery:${feedback.id}:undo`,
              beforeData: JSON.parse(
                JSON.stringify(before),
              ) as Prisma.InputJsonValue,
              afterData: JSON.parse(
                JSON.stringify(after),
              ) as Prisma.InputJsonValue,
            },
          });
          const item = canReturnToDiscovery(after)
            ? await tx.item.findUnique({
                where: { id: original.listingId },
                select: feedSelect,
              })
            : null;
          return { feedback, item };
        });
        break;
      } catch (error) {
        // undoOfId is unique. If another request won the race, repeat the read
        // path so both callers observe the same append-only undo event.
        if (raceRetries === 0 && isUniqueConstraintError(error)) continue;
        throw error;
      }
    }
    this.invalidateRankingCache();
    return {
      ...result,
      item: result.item ? discoveryItemResponse(result.item) : result.item,
      serverTime: new Date().toISOString(),
    };
  }
}
