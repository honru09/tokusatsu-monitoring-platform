import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, ShippingBasis, SourceChannel } from "@tokusatsu/db";
import { UNVERIFIED_AI_ESTIMATE_MARKER } from "@tokusatsu/shared";
import { PrismaService } from "../prisma.service.js";
import { AiGatewayService } from "../ai/ai-gateway.service.js";
import { ProductAiService } from "../ai/product-ai.service.js";
import {
  LOGISTICS_EXPLANATION_SCHEMA,
  LOGISTICS_PREDICTION_SCHEMA,
} from "../ai/ai-response-contracts.js";
import type {
  CreateCarrierDto,
  CreateTariffDto,
  LogisticsPatchDto,
  OptimizeLogisticsDto,
  UpdateCarrierDto,
  UpdateTariffDto,
} from "./logistics.dto.js";

type ItemRow = Prisma.ItemGetPayload<{
  include: {
    source: { select: { key: true; displayName: true } };
    images: { orderBy: { position: "asc" } };
    logistics: true;
  };
}>;

type GroupQuote = {
  itemIds: string[];
  weightGrams: number | null;
  volumeCm3: number | null;
  carrier: { id: string; key: string; displayName: string } | null;
  serviceName: string;
  basis: "weight" | "volume" | "fallback";
  priceYen: number | null;
  known: boolean;
  note: string;
};

type Plan = {
  groups: GroupQuote[];
  shippingYen: number | null;
  itemCostYen: number;
  saleYen: number | null;
  profitYen: number | null;
  missingSalePrice: number;
};

const itemSelect = {
  id: true,
  titleRaw: true,
  titleZh: true,
  priceCurrent: true,
  shippingFee: true,
  quantityEst: true,
  favorite: true,
  purchaseRecord: {
    select: {
      id: true,
      purchaseAmount: true,
      amountAllocated: true,
      purchasedAt: true,
    },
  },
  source: { select: { key: true, displayName: true } },
  images: { orderBy: { position: "asc" as const } },
  logistics: true,
} satisfies Prisma.ItemFindManyArgs["select"];

type LogisticsCandidateItem = Prisma.ItemGetPayload<{
  select: typeof itemSelect;
}>;

const logisticsCandidateBatchSize = 100;

function asPositiveInt(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function predictionInt(value: unknown, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.min(Math.round(number), maximum)
    : undefined;
}

function productVolume(logistics: ItemRow["logistics"]) {
  if (!logistics) return null;
  if (logistics.volumeCm3 && logistics.volumeCm3 > 0)
    return logistics.volumeCm3;
  const dimensions = [
    logistics.lengthMm,
    logistics.widthMm,
    logistics.heightMm,
  ];
  if (dimensions.every((value) => value != null && value > 0)) {
    return Math.round(
      (dimensions[0]! * dimensions[1]! * dimensions[2]!) / 1000,
    );
  }
  return null;
}

function groupKey(groups: GroupQuote[]) {
  return groups
    .map((group) => [...group.itemIds].sort().join(","))
    .sort()
    .join("|");
}

function itemAcquisitionCostYen(item: LogisticsCandidateItem) {
  if (item.purchaseRecord?.amountAllocated) {
    return item.purchaseRecord.purchaseAmount;
  }
  return item.priceCurrent + (item.shippingFee ?? 0);
}

@Injectable()
export class LogisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGatewayService,
    private readonly productAi: ProductAiService,
  ) {}

  async listItems(ids?: string[]) {
    const where: Prisma.ItemWhereInput = {
      ...(ids?.length ? { id: { in: ids } } : {}),
      channel: SourceChannel.online,
      categoryToyType: { not: "card" },
      OR: [{ favorite: true }, { purchaseRecord: { isNot: null } }],
    };
    const items: LogisticsCandidateItem[] = [];
    let cursorId: string | undefined;
    while (true) {
      const page = await this.prisma.item.findMany({
        where,
        select: itemSelect,
        orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
        take: logisticsCandidateBatchSize,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      items.push(...page);
      if (page.length < logisticsCandidateBatchSize) break;

      const nextCursorId = page.at(-1)?.id;
      if (!nextCursorId || nextCursorId === cursorId) {
        throw new Error("物流候选分页游标未前进");
      }
      cursorId = nextCursorId;
    }
    return { items, total: items.length, serverTime: new Date().toISOString() };
  }

  async predictItem(id: string) {
    const item = await this.prisma.item.findUnique({
      where: { id },
      select: {
        id: true,
        titleRaw: true,
        titleZh: true,
        descriptionRaw: true,
        descriptionZh: true,
        priceCurrent: true,
        shippingFee: true,
        favorite: true,
        purchaseRecord: { select: { id: true, purchaseAmount: true } },
        images: {
          orderBy: { position: "asc" },
          take: 20,
          select: { url: true },
        },
        logistics: true,
      },
    });
    if (!item || (!item.favorite && !item.purchaseRecord))
      throw new NotFoundException("只能分析已收藏或已购买的商品");

    const response = await this.productAi.execute<{
      weightGrams?: unknown;
      packageWeightGrams?: unknown;
      lengthMm?: unknown;
      widthMm?: unknown;
      heightMm?: unknown;
      estimatedSalePriceYen?: unknown;
      reasoningZh?: unknown;
      cautionsZh?: unknown;
    }>("image_analysis", {
      responseSchema: LOGISTICS_PREDICTION_SCHEMA,
      // These URLs were loaded from this exact public marketplace item above.
      dataClass: "public_market",
      publicImageUrlsVerified: true,
      costPolicy: "free_first",
      itemId: item.id,
      // The gateway reads at most two images per request; like readItem,
      // send the first two in listing order.
      imageUrls: item.images.slice(0, 2).map((image) => image.url),
      maxTokens: 2_000,
      temperature: 0.1,
      cacheTtlMs: 7 * 24 * 60 * 60_000,
      messages: [
        {
          role: "system",
          content:
            '你是日本特摄中古商品物流估算员。查看全部图片和文字，只预测可供用户修正的物流参数。不得把估算写成事实，不得编造快递公司或实际快递费。只输出 JSON：{"weightGrams":正整数或null,"packageWeightGrams":正整数或null,"lengthMm":正整数或null,"widthMm":正整数或null,"heightMm":正整数或null,"estimatedSalePriceYen":正整数或null,"reasoningZh":"完整中文依据","cautionsZh":"不确定项"}。',
        },
        {
          role: "user",
          content: JSON.stringify({
            titleRaw: item.titleRaw,
            titleZh: item.titleZh,
            descriptionRaw: item.descriptionRaw,
            descriptionZh: item.descriptionZh,
            listingPriceYen: item.priceCurrent,
            listingShippingYen: item.shippingFee,
            purchaseAmountYen: item.purchaseRecord?.purchaseAmount ?? null,
            imageCount: item.images.length,
          }),
        },
      ],
    });
    const predicted = {
      weightGrams: predictionInt(response.data.weightGrams, 2_000_000),
      packageWeightGrams: predictionInt(
        response.data.packageWeightGrams,
        2_000_000,
      ),
      lengthMm: predictionInt(response.data.lengthMm, 5_000),
      widthMm: predictionInt(response.data.widthMm, 5_000),
      heightMm: predictionInt(response.data.heightMm, 5_000),
      estimatedSalePriceYen: predictionInt(
        response.data.estimatedSalePriceYen,
        100_000_000,
      ),
    };
    const resolved = {
      weightGrams: item.logistics?.weightGrams ?? predicted.weightGrams,
      packageWeightGrams:
        item.logistics?.packageWeightGrams ?? predicted.packageWeightGrams,
      lengthMm: item.logistics?.lengthMm ?? predicted.lengthMm,
      widthMm: item.logistics?.widthMm ?? predicted.widthMm,
      heightMm: item.logistics?.heightMm ?? predicted.heightMm,
      estimatedSalePriceYen:
        item.logistics?.estimatedSalePriceYen ??
        predicted.estimatedSalePriceYen,
    };
    const predictionWasUsed = (
      [
        "weightGrams",
        "packageWeightGrams",
        "lengthMm",
        "widthMm",
        "heightMm",
        "estimatedSalePriceYen",
      ] as const
    ).some(
      (field) => item.logistics?.[field] == null && predicted[field] != null,
    );
    const volumeCm3 =
      resolved.lengthMm && resolved.widthMm && resolved.heightMm
        ? Math.round(
            (resolved.lengthMm * resolved.widthMm * resolved.heightMm) / 1000,
          )
        : undefined;
    const notes = [
      ...(predictionWasUsed ? [UNVERIFIED_AI_ESTIMATE_MARKER] : []),
      item.logistics?.notes,
      ...(predictionWasUsed
        ? [response.data.reasoningZh, response.data.cautionsZh]
        : []),
    ]
      .filter(
        (value): value is string =>
          typeof value === "string" && Boolean(value.trim()),
      )
      .join("\n")
      .slice(0, 500);
    const logistics = {
      ...(item.logistics ?? {}),
      ...resolved,
      volumeCm3,
      notes: notes || undefined,
    };
    return {
      logistics,
      prediction: predicted,
      listingPriceYen: item.priceCurrent,
      listingShippingYen: item.shippingFee,
      model: response.model,
      cached: response.cached,
      fallbackUsed: response.fallbackUsed,
      serverTime: new Date().toISOString(),
    };
  }

  async updateItem(id: string, body: LogisticsPatchDto) {
    const item = await this.prisma.item.findUnique({
      where: { id },
      select: { id: true, priceCurrent: true, shippingFee: true },
    });
    if (!item) throw new NotFoundException("Item not found");
    const sale = body.estimatedSalePriceYen;
    const computedProfit =
      sale == null
        ? body.estimatedProfitYen
        : sale - item.priceCurrent - (item.shippingFee ?? 0);
    const data: Prisma.ItemLogisticsUpsertArgs["create"] = {
      itemId: id,
      ...body,
      volumeCm3:
        body.volumeCm3 ??
        (body.lengthMm && body.widthMm && body.heightMm
          ? Math.round((body.lengthMm * body.widthMm * body.heightMm) / 1000)
          : undefined),
      estimatedProfitYen: computedProfit,
    };
    const logistics = await this.prisma.itemLogistics.upsert({
      where: { itemId: id },
      create: data,
      update: data,
    });
    return { logistics, serverTime: new Date().toISOString() };
  }

  async listCarriers() {
    const carriers = await this.prisma.shippingCarrier.findMany({
      include: {
        tariffs: { orderBy: [{ basis: "asc" }, { minValue: "asc" }] },
      },
      orderBy: [{ enabled: "desc" }, { displayName: "asc" }],
    });
    return { carriers, serverTime: new Date().toISOString() };
  }

  async createCarrier(body: CreateCarrierDto) {
    const carrier = await this.prisma.shippingCarrier.create({
      data: { ...body, currency: body.currency ?? "JPY" },
    });
    return { carrier, serverTime: new Date().toISOString() };
  }

  async updateCarrier(id: string, body: UpdateCarrierDto) {
    const carrier = await this.prisma.shippingCarrier.update({
      where: { id },
      data: body,
    });
    return { carrier, serverTime: new Date().toISOString() };
  }

  async createTariff(carrierId: string, body: CreateTariffDto) {
    const tariff = await this.prisma.shippingTariff.create({
      data: {
        carrierId,
        serviceName: body.serviceName,
        basis: body.basis as ShippingBasis,
        minValue: body.minValue,
        maxValue: body.maxValue,
        priceYen: body.priceYen,
        zone: body.zone ?? "JP",
        sourceNote: body.sourceNote,
      },
    });
    return { tariff, serverTime: new Date().toISOString() };
  }

  async updateTariff(id: string, body: UpdateTariffDto) {
    const tariff = await this.prisma.shippingTariff.update({
      where: { id },
      data: {
        serviceName: body.serviceName,
        basis: body.basis as ShippingBasis,
        minValue: body.minValue,
        maxValue: body.maxValue,
        priceYen: body.priceYen,
        zone: body.zone ?? "JP",
        sourceNote: body.sourceNote,
      },
    });
    return { tariff, serverTime: new Date().toISOString() };
  }

  async deleteTariff(id: string) {
    await this.prisma.shippingTariff.delete({ where: { id } });
    return { deleted: true, serverTime: new Date().toISOString() };
  }

  async optimize(body: OptimizeLogisticsDto) {
    const zone = body.zone?.trim() || "JP";
    const rows = await this.prisma.item.findMany({
      where: {
        id: { in: body.itemIds },
        channel: SourceChannel.online,
        categoryToyType: { not: "card" },
        OR: [{ favorite: true }, { purchaseRecord: { isNot: null } }],
      },
      select: itemSelect,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const missingIds = body.itemIds.filter((id) => !byId.has(id));
    if (missingIds.length)
      throw new NotFoundException(`商品不存在: ${missingIds.join(", ")}`);
    const ordered = body.itemIds.map((id) => byId.get(id)!);
    const carriers = await this.prisma.shippingCarrier.findMany({
      where: { enabled: true },
      include: { tariffs: true },
    });
    const manualCarrier = body.carrierId
      ? carriers.find((carrier) => carrier.id === body.carrierId)
      : null;
    if (body.carrierId && !manualCarrier) {
      throw new NotFoundException("所选快递公司不存在或未启用");
    }
    if ((body.carrierId == null) !== (body.shippingFeeYen == null)) {
      throw new BadRequestException("快递公司和实际快递费需要同时填写");
    }

    const quoteGroup = (indices: number[]): GroupQuote => {
      const selected = indices.map((index) => ordered[index]);
      const weightValues = selected.map((item) =>
        asPositiveInt(
          item.logistics?.packageWeightGrams ?? item.logistics?.weightGrams,
        ),
      );
      const volumeValues = selected.map((item) =>
        productVolume(item.logistics),
      );
      const weightGrams = weightValues.every(Boolean)
        ? weightValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)
        : null;
      const volumeCm3 = volumeValues.every(Boolean)
        ? volumeValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)
        : null;
      const candidates = carriers.flatMap((carrier) =>
        carrier.tariffs.flatMap((tariff) => {
          const value =
            tariff.basis === ShippingBasis.weight ? weightGrams : volumeCm3;
          if (
            value == null ||
            tariff.zone !== zone ||
            value < tariff.minValue ||
            (tariff.maxValue != null && value > tariff.maxValue)
          )
            return [];
          return [{ carrier, tariff, value }];
        }),
      );
      const best = candidates.sort(
        (a, b) => a.tariff.priceYen - b.tariff.priceYen,
      )[0];
      if (best) {
        return {
          itemIds: selected.map((item) => item.id),
          weightGrams,
          volumeCm3,
          carrier: {
            id: best.carrier.id,
            key: best.carrier.key,
            displayName: best.carrier.displayName,
          },
          serviceName: best.tariff.serviceName,
          basis: best.tariff.basis,
          priceYen: best.tariff.priceYen,
          known: true,
          note: `${best.tariff.basis === ShippingBasis.weight ? "按重量" : "按体积"}阶梯 · ${zone}`,
        };
      }
      const fallbackKnown = selected.every((item) => item.shippingFee != null);
      return {
        itemIds: selected.map((item) => item.id),
        weightGrams,
        volumeCm3,
        carrier: null,
        serviceName: fallbackKnown ? "商品已知邮费合计" : "待维护报价",
        basis: "fallback",
        priceYen: fallbackKnown
          ? selected.reduce((sum, item) => sum + (item.shippingFee ?? 0), 0)
          : null,
        known: fallbackKnown,
        note: fallbackKnown
          ? "缺少包裹参数，按商品现有邮费保守估算"
          : "请补充重量/体积并维护对应地区阶梯",
      };
    };

    const buildPlan = (groups: number[][]): Plan => {
      const quotes = groups.map(quoteGroup);
      const itemCostYen = ordered.reduce(
        (sum, item) => sum + itemAcquisitionCostYen(item),
        0,
      );
      const saleValues = ordered.map(
        (item) => item.logistics?.estimatedSalePriceYen ?? null,
      );
      const saleYen = saleValues.every((value) => value != null)
        ? saleValues.reduce((sum, value) => sum + (value ?? 0), 0)
        : null;
      const missingSalePrice = saleValues.filter(
        (value) => value == null,
      ).length;
      const shippingYen = quotes.every((quote) => quote.priceYen != null)
        ? quotes.reduce<number>((sum, quote) => sum + (quote.priceYen ?? 0), 0)
        : null;
      return {
        groups: quotes,
        shippingYen,
        itemCostYen,
        saleYen,
        profitYen:
          saleYen == null || shippingYen == null
            ? null
            : saleYen - itemCostYen - shippingYen,
        missingSalePrice,
      };
    };

    const singlePlan = buildPlan(ordered.map((_, index) => [index]));
    const allPlan = buildPlan([ordered.map((_, index) => index)]);
    type Candidate = { groups: number[][]; plan: Plan };
    const memo = new Map<number, Candidate[]>();
    const topPartitions = (mask: number): Candidate[] => {
      if (!mask) return [{ groups: [], plan: buildPlan([]) }];
      const cached = memo.get(mask);
      if (cached) return cached;
      const anchor = mask & -mask;
      const candidates: Candidate[] = [];
      for (let subset = mask; subset; subset = (subset - 1) & mask) {
        if ((subset & anchor) === 0) continue;
        const remainder = mask ^ subset;
        const child = topPartitions(remainder);
        const group = Array.from(
          { length: ordered.length },
          (_, index) => index,
        ).filter((index) => subset & (1 << index));
        for (const option of child) {
          const groups = [group, ...option.groups];
          candidates.push({ groups, plan: buildPlan(groups) });
        }
      }
      const deduped = new Map<string, Candidate>();
      for (const candidate of candidates.sort(
        (a, b) =>
          (a.plan.shippingYen ?? Number.MAX_SAFE_INTEGER) -
          (b.plan.shippingYen ?? Number.MAX_SAFE_INTEGER),
      )) {
        const key = groupKey(candidate.plan.groups);
        if (!deduped.has(key)) deduped.set(key, candidate);
        if (deduped.size >= 8) break;
      }
      const result = [...deduped.values()]
        .sort(
          (a, b) =>
            (a.plan.shippingYen ?? Number.MAX_SAFE_INTEGER) -
            (b.plan.shippingYen ?? Number.MAX_SAFE_INTEGER),
        )
        .slice(0, 8);
      memo.set(mask, result);
      return result;
    };
    const generated = topPartitions((1 << ordered.length) - 1).map(
      (entry) => entry.plan,
    );
    const manualPlan: Plan | null =
      manualCarrier && body.shippingFeeYen != null
        ? (() => {
            const calculated = buildPlan([ordered.map((_, index) => index)]);
            const group = calculated.groups[0]!;
            return {
              ...calculated,
              groups: [
                {
                  ...group,
                  carrier: {
                    id: manualCarrier.id,
                    key: manualCarrier.key,
                    displayName: manualCarrier.displayName,
                  },
                  serviceName: "用户填写的实际运费",
                  basis: "fallback",
                  priceYen: body.shippingFeeYen,
                  known: true,
                  note: "按用户填写的快递公司与实际快递费计算",
                },
              ],
              shippingYen: body.shippingFeeYen,
              profitYen:
                calculated.saleYen == null
                  ? null
                  : calculated.saleYen -
                    calculated.itemCostYen -
                    body.shippingFeeYen,
            };
          })()
        : null;
    const options = (
      manualPlan ? [manualPlan] : [singlePlan, allPlan, ...generated]
    )
      .filter(
        (plan, index, list) =>
          list.findIndex(
            (other) => groupKey(other.groups) === groupKey(plan.groups),
          ) === index,
      )
      .sort(
        (a, b) =>
          (a.shippingYen ?? Number.MAX_SAFE_INTEGER) -
          (b.shippingYen ?? Number.MAX_SAFE_INTEGER),
      )
      .slice(0, 8);
    const knownProfit = options
      .filter((plan) => plan.profitYen != null)
      .map((plan) => plan.profitYen as number);
    const knownShipping = options
      .filter((plan) => plan.shippingYen != null)
      .map((plan) => plan.shippingYen as number);
    const optimalIndex = options.findIndex((plan) =>
      knownProfit.length > 0
        ? plan.profitYen === Math.max(...knownProfit)
        : knownShipping.length > 0
          ? plan.shippingYen === Math.min(...knownShipping)
          : plan === options[0],
    );
    const serializedOptions = options.map((plan, index) => ({
      ...plan,
      isOptimal: index === optimalIndex,
      groups: plan.groups.map((group) => ({
        ...group,
        items: group.itemIds.map((id) => {
          const item = byId.get(id)!;
          return {
            id: item.id,
            titleRaw: item.titleRaw,
            titleZh: item.titleZh,
            priceCurrent: item.priceCurrent,
            shippingFee: item.shippingFee,
            source: item.source,
          };
        }),
      })),
    }));
    const best = serializedOptions[optimalIndex] ?? serializedOptions[0];
    let ai: unknown = null;
    if (body.withAi) {
      try {
        const result = await this.gateway.executeJson<{
          summaryZh?: string;
          cautionsZh?: string[];
          recommendationZh?: string;
        }>({
          responseSchema: LOGISTICS_EXPLANATION_SCHEMA,
          task: "logistics_analysis",
          dataClass: "user_private",
          costPolicy: "free_first",
          maxTokens: 1_500,
          temperature: 0.1,
          cacheTtlMs: 15 * 60_000,
          messages: [
            {
              role: "system",
              content:
                "你是采购物流顾问。只能依据提供的商品参数、快递报价阶梯和确定性计算结果给出中文解释，不得改写金额或编造缺失参数。只输出 JSON：{summaryZh, cautionsZh, recommendationZh}。",
            },
            {
              role: "user",
              content: JSON.stringify({
                zone,
                tariffs: carriers,
                options: serializedOptions,
                best,
              }),
            },
          ],
        });
        ai = {
          ...result.data,
          model: result.model,
          cached: result.cached,
          fallbackUsed: result.fallbackUsed,
        };
      } catch (error) {
        ai = { error: error instanceof Error ? error.message : "AI 暂不可用" };
      }
    }
    return {
      zone,
      items: ordered,
      carriers,
      options: serializedOptions,
      best,
      ai,
      units: { weight: "g", dimensions: "mm", volume: "cm³", money: "JPY" },
      serverTime: new Date().toISOString(),
    };
  }
}
