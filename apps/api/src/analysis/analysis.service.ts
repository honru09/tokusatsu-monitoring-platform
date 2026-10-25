import { createHash } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, SourceChannel, ToyType } from "@tokusatsu/db";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  compareProcurementCandidates,
  procurementConfigFromEnv,
  procurementLogisticsEvidence,
  rankProcurementCandidates,
  type ProcurementAssessment,
  type ProcurementMissingFact,
} from "@tokusatsu/shared";
import {
  AiGatewayService,
  type AiGatewayResult,
} from "../ai/ai-gateway.service.js";
import { ProductAiService } from "../ai/product-ai.service.js";
import type { AiCostPolicy } from "../ai/ai-router.js";
import {
  SELLER_BATCH_SUMMARY_SCHEMA,
  SELLER_PROFILE_SCHEMA,
  itemTranslationSchema,
  priceJudgementSchema,
} from "../ai/ai-response-contracts.js";
import {
  batchTranslationSchema,
  detailFragmentsSchema,
} from "../ai/ai-response-schema.js";
import { activeMarketItemWhere } from "../items/active-market-scope.js";
import { classifySellerSegment } from "../items/seller-segments.js";
import { PrismaService } from "../prisma.service.js";
import type { TranslateDto } from "./analysis.dto.js";

const conditionWeight: Record<string, number> = {
  new_sealed: 5,
  like_new: 4,
  used: 3,
  stained_or_damaged: 2,
  junk: 1,
  unknown: 0,
};

const procurementMissingFactLabel: Record<ProcurementMissingFact, string> = {
  price: "价格",
  shipping_fee: "运费",
  quantity: "数量",
  volume: "体积",
  condition: "品相",
  listing_type: "交易方式",
};

function procurementReason(assessment: ProcurementAssessment) {
  const evidence = [...assessment.facts, ...assessment.reasons];
  if (assessment.missingFacts.length) {
    evidence.push(
      `待核验：${assessment.missingFacts
        .map((fact) => procurementMissingFactLabel[fact])
        .join("、")}。`,
    );
  }
  return evidence.join(" ");
}

function publicDetailStringNeedsTranslation(path: string, text: string) {
  const normalizedPath = path.replace(/\[\d+\]/g, "");
  const fieldName = normalizedPath.split(".").at(-1) ?? "";

  // Marketplace payloads commonly embed JSON-LD transport metadata beside
  // the human-readable listing facts. None of these values belong in a
  // translation request, and media arrays otherwise evade a simple
  // `path.endsWith("image")` check once they become `image[0]`.
  if (
    /^(?:@context|@type)$/i.test(fieldName) ||
    /(?:image|images|imageurl|imageurls|thumbnail|thumbnails|photo|photos|picture|pictures|url|uri|href)$/i.test(
      fieldName,
    )
  )
    return false;

  if (/^(?:https?:\/\/|data:image\/|blob:)/i.test(text)) return false;

  // Empty technical sentinels carry no customer-facing fact. Sending them to
  // an LLM wastes tokens and can make a strict all-fields response fail even
  // after the meaningful title, condition and seller description succeeded.
  if (/^(?:unknown|undefined|null|n\/a|none|not[_ -]?available)$/i.test(text))
    return false;

  if (/(?:currency|currencycode)$/i.test(fieldName) && /^[A-Z]{3}$/u.test(text))
    return false;

  return true;
}

export function publicDetailFields(value: unknown) {
  const rows: { path: string; value: string }[] = [];
  let totalLength = 0;
  const visit = (current: unknown, path: string, depth: number) => {
    // Keep a generous, bounded envelope for complete public product facts.
    // The previous 100-row/24k cap dropped long seller descriptions and
    // shipping/condition tables before they reached the translator.
    if (rows.length >= 500 || totalLength >= 80_000 || depth > 7) return;
    if (typeof current === "string") {
      const text = current.replace(/\s+/g, " ").trim();
      if (!text || !publicDetailStringNeedsTranslation(path, text)) return;
      if (
        /(?:^|\.)(?:bodyText)$/i.test(path) &&
        /(?:window\.[A-Z_$]|<\/?(?:div|script|style|a)\b|__NEXT_DATA__|webpack|function\s*\()/i.test(
          text,
        )
      )
        return;
      const clipped = text.slice(0, Math.max(0, 80_000 - totalLength));
      if (clipped) {
        rows.push({ path, value: clipped });
        totalLength += clipped.length;
      }
      return;
    }
    if (typeof current === "number" || typeof current === "boolean") {
      rows.push({ path, value: String(current) });
      return;
    }
    if (Array.isArray(current)) {
      current
        .slice(0, 30)
        .forEach((entry, index) =>
          visit(entry, `${path}[${index}]`, depth + 1),
        );
      return;
    }
    if (current && typeof current === "object") {
      Object.entries(current as Record<string, unknown>)
        .filter(
          ([key]) =>
            !/(?:html|script|style|cookie|token|authorization)/i.test(key),
        )
        .slice(0, 80)
        .forEach(([key, entry]) =>
          visit(entry, path ? `${path}.${key}` : key, depth + 1),
        );
    }
  };
  visit(value, "", 0);
  return rows;
}

type DetailFieldFragment = {
  fragmentKey: string;
  path: string;
  part: number;
  parts: number;
  value: string;
};

function splitDetailValue(value: string, maximum = 5_000) {
  const parts: string[] = [];
  let remaining = value;
  while (remaining.length > maximum) {
    const window = remaining.slice(0, maximum);
    const candidates = ["\n", "。", "！", "？", "；", ". ", "! ", "? "];
    const boundary = Math.max(
      ...candidates.map((separator) => window.lastIndexOf(separator)),
    );
    const cut = boundary >= Math.floor(maximum * 0.55) ? boundary + 1 : maximum;
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining) parts.push(remaining);
  return parts.length ? parts : [""];
}

/**
 * Keep every public field while staying below provider request limits. A
 * single marketplace payload may repeat a long body field, so oversized
 * values are split and later reassembled under their original path.
 */
export function publicDetailFieldChunks(
  fields: Array<{ path: string; value: string }>,
  maximumCharacters = 4_000,
  maximumRows = 24,
) {
  const fragments = fields.flatMap((field, fieldIndex) => {
    const parts = splitDetailValue(
      field.value,
      Math.max(500, maximumCharacters - field.path.length - 32),
    );
    return parts.map(
      (value, part): DetailFieldFragment => ({
        fragmentKey: `${fieldIndex}:${part}`,
        path: field.path,
        part,
        parts: parts.length,
        value,
      }),
    );
  });
  const chunks: DetailFieldFragment[][] = [];
  let current: DetailFieldFragment[] = [];
  let currentCharacters = 0;
  for (const fragment of fragments) {
    const size =
      fragment.fragmentKey.length +
      fragment.path.length +
      fragment.value.length;
    if (
      current.length > 0 &&
      (current.length >= maximumRows ||
        currentCharacters + size > maximumCharacters)
    ) {
      chunks.push(current);
      current = [];
      currentCharacters = 0;
    }
    current.push(fragment);
    currentCharacters += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function translationOutputTokenBudget(texts: readonly string[]) {
  const characters = texts.reduce((total, text) => total + text.length, 0);
  // JSON framing and one complete sentence per title consume a meaningful
  // fixed budget even when the source strings are short. Without a per-row
  // reserve, providers tend to return only the first few titles in a batch.
  return Math.max(
    800,
    Math.min(6_000, characters * 2, Number.MAX_SAFE_INTEGER),
    Math.min(6_000, texts.length * 500),
  );
}

function sourceShippingEvidence(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return {
    status:
      typeof source.shippingStatus === "string"
        ? source.shippingStatus
        : undefined,
    text:
      typeof source.shippingText === "string"
        ? source.shippingText.trim()
        : undefined,
  };
}

export function negotiationFallback(targetPrice?: number) {
  const priceJa =
    targetPrice == null
      ? "希望額"
      : `送料込みで¥${targetPrice.toLocaleString("ja-JP")}`;
  return {
    negotiationJa:
      targetPrice == null
        ? "コメント失礼いたします。商品の状態、付属品、発送方法について確認させていただけますでしょうか。購入を検討しておりますが、お値下げが可能な場合はご希望額を教えていただけますと幸いです。"
        : `コメント失礼いたします。商品の状態と付属品を確認のうえ購入を検討しております。大変恐縮ですが、${priceJa}までお値下げいただくことは可能でしょうか。可能でしたらすぐに購入いたします。ご検討よろしくお願いいたします。`,
    negotiationZh:
      targetPrice == null
        ? "打扰了。请问可以确认一下商品状态、配件和发货方式吗？我正在考虑购买，如果可以议价，烦请告知您能接受的价格。"
        : `打扰了。我在确认商品状态和配件后有意购买。冒昧询问，含运费降到 ¥${targetPrice.toLocaleString("ja-JP")} 可以吗？如果可以，我会立即购买。感谢考虑。`,
  };
}

@Injectable()
export class AnalysisService {
  private readonly translationRequests = new Map<
    string,
    Promise<AiGatewayResult<{ translations?: unknown; confidence?: unknown }>>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGatewayService,
    private readonly productAi: ProductAiService,
  ) {}

  async market() {
    const where = {
      archivedAt: null,
      deletedAt: null,
      channel: "online",
      purchaseRecord: null,
      ignored: false,
      status: { in: ["active", "unknown"] },
      categoryToyType: { not: "card" },
      AND: [
        {
          OR: [
            { descriptionRaw: null },
            {
              NOT: {
                descriptionRaw: {
                  contains: "カードダス",
                  mode: "insensitive",
                },
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
    } satisfies Prisma.ItemWhereInput;
    const select = {
      id: true,
      titleRaw: true,
      sourceUrl: true,
      priceCurrent: true,
      priceTotalEst: true,
      unitCostEst: true,
      quantityEst: true,
      categoryToyType: true,
      conditionGrade: true,
      status: true,
      imageCount: true,
      descriptionRaw: true,
      shippingFee: true,
      listingType: true,
      bidCount: true,
      auctionEndAt: true,
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
      source: { select: { key: true, displayName: true } },
    } satisfies Prisma.ItemSelect;
    const items: Prisma.ItemGetPayload<{ select: typeof select }>[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.item.findMany({
        where,
        select,
        orderBy: [{ detectedAt: "desc" }, { id: "asc" }],
        take: 1_000,
        cursor: cursor ? { id: cursor } : undefined,
        skip: cursor ? 1 : undefined,
      });
      items.push(...page);
      if (page.length < 1_000) break;
      cursor = page.at(-1)!.id;
    }
    const procurementConfig = procurementConfigFromEnv(process.env);
    const procurementItems = items.map((item) => ({
      ...item,
      logistics: procurementLogisticsEvidence(item.logistics),
    }));
    const rankedProcurement = rankProcurementCandidates(
      procurementItems,
      procurementConfig,
    );
    const fallbackBestValueEntry = rankedProcurement[0] ?? null;
    const fallbackBestValue = fallbackBestValueEntry?.candidate ?? null;
    const fallbackLargestQuantity =
      items
        .filter((item) => item.quantityEst != null)
        .sort((a, b) => (b.quantityEst ?? 0) - (a.quantityEst ?? 0))[0] ?? null;
    const fallbackBestCondition =
      items
        .filter((item) => (conditionWeight[item.conditionGrade] ?? 0) > 0)
        .sort(
          (a, b) =>
            (conditionWeight[b.conditionGrade] ?? 0) -
            (conditionWeight[a.conditionGrade] ?? 0),
        )[0] ?? null;
    let bestValue = fallbackBestValue;
    let largestQuantity = fallbackLargestQuantity;
    let bestCondition = fallbackBestCondition;
    const recommendation = fallbackBestValueEntry
      ? `建议先核验「${fallbackBestValueEntry.candidate.titleRaw.slice(0, 42)}」：${procurementReason(fallbackBestValueEntry.assessment)}`
      : "当前没有可分析的在售商品，等待下一轮市场扫描。";
    let mode: "rules" | "ai" = "rules";
    let engineLabel = "透明规则分析";
    let aiRecommendation: string | null = null;
    const fallbackRanked = rankedProcurement
      .slice(0, 5)
      .map(({ candidate, assessment }) => ({
        item: candidate,
        reason: procurementReason(assessment),
      }));
    let rankedRecommendations = fallbackRanked;
    let insights = [
      `本次分析读取 ${items.length} 件在售商品，其中拍卖 ${items.filter((item) => item.listingType === "auction").length} 件，直购 ${items.filter((item) => item.listingType === "direct").length} 件，交易方式待核验 ${items.filter((item) => item.listingType === "unknown").length} 件。`,
    ];
    let risks = [
      `${items.filter((item) => item.shippingFee == null).length} 件没有可靠固定运费，比较价格时需要到原平台确认最终配送成本。`,
      `${items.filter((item) => item.quantityEst == null).length} 件数量尚未可靠识别，不应直接按单件估值采购。`,
      `${rankedProcurement.filter(({ assessment }) => assessment.missingFacts.includes("volume")).length} 件缺少可靠体积，不能直接视为小体积商品。`,
    ];
    if (fallbackBestValue && this.gateway.configured()) {
      try {
        const promptEntries = rankedProcurement.slice(0, 80);
        const promptItems = promptEntries.map(({ candidate, assessment }) => ({
          id: candidate.id,
          title: candidate.titleRaw,
          price: candidate.priceCurrent,
          total: candidate.priceTotalEst,
          unitCost: candidate.unitCostEst,
          quantity: candidate.quantityEst,
          condition: candidate.conditionGrade,
          status: candidate.status,
          listingType: candidate.listingType,
          bidCount: candidate.bidCount,
          auctionEndAt: candidate.auctionEndAt,
          shippingFee: candidate.shippingFee,
          platform: candidate.source.displayName,
          description: candidate.descriptionRaw?.slice(0, 1_200) ?? null,
          logistics: candidate.logistics,
          ruleAssessment: {
            category: assessment.category,
            compactness: assessment.compactness,
            compactnessBasis: assessment.compactnessBasis,
            costBasis: assessment.costBasis,
            facts: assessment.facts,
            reasons: assessment.reasons,
            missingFacts: assessment.missingFacts,
          },
        }));
        const execution = await this.productAi.execute<{
          bestValueId?: unknown;
          largestQuantityId?: unknown;
          bestConditionId?: unknown;
          recommendation?: unknown;
          ranked?: unknown;
          insights?: unknown;
          risks?: unknown;
        }>("price_judgement", {
          responseSchema: priceJudgementSchema(
            promptItems.map((item) => item.id),
          ),
          messages: [
            {
              role: "system",
              content:
                '你是日本特摄中古商品采购顾问。目标是在事实可核验的前提下优先找总体积及单件体积更小、数量更多、价格更低的货。输入已经过透明规则预排序，ruleAssessment 是规则根据已知字段得出的分类、事实、推断依据和缺失事实，不包含数字评分。体积只可使用 logistics 中的已知总体积、三维尺寸和规则明确标注的推断；未知体积绝不能写成小体积。数量越多越优先，但数量未知时不得猜测。只有 shippingFee 已知时，才可把 (price + shippingFee) / quantity 称为已知的含运费单件成本；运费未知时，price / quantity 只能称为成本下限，绝不能称为已知低价。输入中的 total 和 unitCost 是历史估算字段，不能覆盖 shippingFee、quantity 或 ruleAssessment 的事实边界。严禁生成数字评分、虚构信息或把缺失事实写成事实。请完整结合标题、卖家描述、当前价、预计总价、运费、数量、品相、拍卖/直购方式、竞拍次数、截止时间、真实平台和规则事实，选择三个可核验的商品并给出中文采购判断。bestValueId 表示体积、数量、含运费单件成本和品相综合最值得核验，largestQuantityId 表示输入中已知数量最大，bestConditionId 表示输入中品相最好；ID 必须来自输入。ranked 返回最多 5 个输入中的商品，按采购优先级排列，每项包含 id 和不超过 80 字的具体 reason，reason 必须引用已知事实或明确指出待核验项。insights 与 risks 各返回 2 至 4 条具体结论，不得评分。只输出 JSON：{"bestValueId":"id","largestQuantityId":"id","bestConditionId":"id","recommendation":"...","ranked":[{"id":"id","reason":"..."}],"insights":["..."],"risks":["..."]}。',
            },
            { role: "user", content: JSON.stringify(promptItems) },
          ],
        });
        const result = execution.data;
        if (
          typeof result.recommendation === "string" &&
          result.recommendation.trim()
        ) {
          const byId = new Map(
            promptEntries.map(({ candidate }) => [candidate.id, candidate]),
          );
          const assessmentById = new Map(
            promptEntries.map(({ candidate, assessment }) => [
              candidate.id,
              assessment,
            ]),
          );
          const rulePositionById = new Map(
            promptEntries.map(({ candidate }, index) => [candidate.id, index]),
          );
          if (typeof result.bestValueId === "string") {
            const proposed = byId.get(result.bestValueId);
            const proposedAssessment = assessmentById.get(result.bestValueId);
            if (
              proposed &&
              proposedAssessment &&
              proposedAssessment.category !== "deprioritized" &&
              fallbackBestValue &&
              compareProcurementCandidates(
                proposed,
                fallbackBestValue,
                procurementConfig,
              ) === 0
            ) {
              bestValue = proposed;
            }
          }
          if (typeof result.largestQuantityId === "string") {
            const proposed = byId.get(result.largestQuantityId);
            if (
              proposed?.quantityEst != null &&
              proposed.quantityEst === fallbackLargestQuantity?.quantityEst
            ) {
              largestQuantity = proposed;
            }
          }
          if (typeof result.bestConditionId === "string") {
            const proposed = byId.get(result.bestConditionId);
            if (
              proposed &&
              (conditionWeight[proposed.conditionGrade] ?? 0) > 0 &&
              (conditionWeight[proposed.conditionGrade] ?? 0) >=
                (conditionWeight[fallbackBestCondition?.conditionGrade ?? ""] ??
                  0)
            ) {
              bestCondition = proposed;
            }
          }
          mode = "ai";
          engineLabel = execution.model;
          const selectedAssessment = bestValue
            ? assessmentById.get(bestValue.id)
            : undefined;
          const verifiedRecommendation =
            bestValue && selectedAssessment
              ? `建议先核验「${bestValue.titleRaw.slice(0, 42)}」：${procurementReason(selectedAssessment)}`
              : recommendation;
          // Model prose is not a trusted fact source. AI may choose only among
          // deterministic ties; all user-visible reasons stay rule-generated.
          aiRecommendation = verifiedRecommendation;
          if (Array.isArray(result.ranked)) {
            const aiOrderById = new Map<string, number>();
            const rankedById = new Map<
              string,
              (typeof fallbackRanked)[number]
            >();
            result.ranked.forEach((entry, index) => {
              if (!entry || typeof entry !== "object") return;
              const value = entry as Record<string, unknown>;
              if (typeof value.id !== "string") return;
              const item = byId.get(value.id);
              const assessment = assessmentById.get(value.id);
              if (!item || !assessment) return;
              if (rankedById.has(item.id)) return;
              aiOrderById.set(item.id, index);
              rankedById.set(item.id, {
                item,
                reason: `AI复核（仅同分候选可调整）。规则依据：${procurementReason(assessment)}`,
              });
            });
            for (const entry of fallbackRanked) {
              if (!rankedById.has(entry.item.id))
                rankedById.set(entry.item.id, entry);
            }
            const ranked = [...rankedById.values()].sort((left, right) => {
              const ruleDifference = compareProcurementCandidates(
                left.item,
                right.item,
                procurementConfig,
              );
              if (ruleDifference) return ruleDifference;
              const leftAiOrder = aiOrderById.get(left.item.id);
              const rightAiOrder = aiOrderById.get(right.item.id);
              if (leftAiOrder != null && rightAiOrder != null)
                return leftAiOrder - rightAiOrder;
              if (leftAiOrder != null) return -1;
              if (rightAiOrder != null) return 1;
              return (
                (rulePositionById.get(left.item.id) ??
                  Number.MAX_SAFE_INTEGER) -
                (rulePositionById.get(right.item.id) ?? Number.MAX_SAFE_INTEGER)
              );
            });
            if (ranked.length) rankedRecommendations = ranked.slice(0, 5);
          }
        }
      } catch {
        // AI is an enhancement; keep the deterministic analysis available.
      }
    }
    return {
      mode,
      engineLabel,
      generatedAt: new Date().toISOString(),
      sampleSize: items.length,
      bestValue,
      largestQuantity,
      bestCondition,
      recommendation: aiRecommendation ?? recommendation,
      rankedRecommendations,
      insights,
      risks,
    };
  }

  async translate(body: TranslateDto, costPolicy?: AiCostPolicy) {
    const texts = body.texts.map((text) => text.trim());
    const execution = await this.executeTranslation(texts, costPolicy);
    const result = execution.data;
    const translations = Array.isArray(result.translations)
      ? result.translations.map((value, index) =>
          typeof value === "string" && value.trim()
            ? value.trim()
            : texts[index],
        )
      : texts;
    if (body.itemIds?.length === translations.length) {
      await this.prisma.$transaction(
        body.itemIds.map((id, index) =>
          this.prisma.item.updateMany({
            where: { id, titleRaw: texts[index] },
            data: { titleZh: translations[index] },
          }),
        ),
      );
    }
    return { translations, model: execution.model, cached: execution.cached };
  }

  private async executeTranslation(texts: string[], costPolicy?: AiCostPolicy) {
    const key = createHash("sha256")
      .update(JSON.stringify({ texts, costPolicy: costPolicy ?? "default" }))
      .digest("hex");
    const existing = this.translationRequests.get(key);
    if (existing) return existing;

    const pending = this.productAi.execute<{
      translations?: unknown;
      confidence?: unknown;
    }>("translation", {
      responseSchema: batchTranslationSchema(texts),
      maxTokens: translationOutputTokenBudget(texts),
      ...(costPolicy ? { costPolicy } : {}),
      messages: [
        {
          role: "system",
          content:
            '你是日本特摄中古商品采购平台的专业翻译。逐条完整翻译输入文本，不得摘要、改写成关键词或省略句子。保留数量、角色、版本、编号、成色、缺件、套装、卖家备注、运费、时间和交易条件等全部事实；日语商品标题中的修饰词和括号内容也要翻译。无法确定的专有名词保留原文并在括号中说明，不要擅自补充信息。输出数组长度必须与输入相同，按输入顺序输出 JSON：{"translations":["完整中文翻译"]}。',
        },
        { role: "user", content: JSON.stringify({ texts }) },
      ],
    });
    this.translationRequests.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.translationRequests.get(key) === pending)
        this.translationRequests.delete(key);
    }
  }

  async itemTranslation(
    id: string,
    refresh = false,
    costPolicy?: AiCostPolicy,
  ) {
    const item = await this.prisma.item.findUnique({
      where: { id },
      select: {
        id: true,
        titleRaw: true,
        descriptionRaw: true,
        conditionRaw: true,
        shippingFee: true,
        sourceData: true,
        titleZh: true,
        descriptionZh: true,
        conditionZh: true,
        shippingZh: true,
        detailsZh: true,
        translationStatus: true,
        translatedAt: true,
      },
    });
    if (!item) return null;
    if (!refresh && item.translationStatus === "completed" && item.titleZh) {
      return { translation: item, cached: true };
    }
    await this.prisma.item.update({
      where: { id },
      data: { translationStatus: "processing" },
    });
    const shippingEvidence = sourceShippingEvidence(item.sourceData);
    const shippingRaw =
      item.shippingFee === 0
        ? "卖家承担运费/包邮"
        : item.shippingFee != null
          ? `固定运费 ${item.shippingFee} 日元`
          : shippingEvidence.status === "calculated"
            ? shippingEvidence.text || "运费由买家承担，按地区或配送方式计算"
            : shippingEvidence.status === "free"
              ? "卖家承担运费/包邮"
              : "平台未提供可靠的固定运费，可能按地区或配送方式计算";
    try {
      const execution = await this.productAi.execute<{
        titleZh?: unknown;
        descriptionZh?: unknown;
        conditionZh?: unknown;
        shippingZh?: unknown;
        confidence?: unknown;
      }>("translation", {
        responseSchema: itemTranslationSchema({
          titleZh: item.titleRaw,
          descriptionZh: item.descriptionRaw ?? "平台没有公开卖家正文",
          conditionZh: item.conditionRaw ?? "平台没有公开品相说明",
          shippingZh: shippingRaw,
        }),
        itemId: id,
        ...(costPolicy ? { costPolicy } : {}),
        messages: [
          {
            role: "system",
            content:
              '你是日本特摄中古商品的专业全量翻译员。必须把输入中的商品标题、卖家正文、品相和运费完整翻译成自然、准确、中文母语者可独立理解的简体中文。不得摘要，不得只翻译角色名，不得省略括号、数量、缺件、瑕疵、版本、型号、时间、配送和竞拍条件；品牌、型号或无法确定的专名可保留原文并给出中文说明。只做逐项翻译，不生成采购结论、包含物清单或风险推断。绝对不能因为输入里没有图片字段就声称卖家未提供实物照片、没有图片或缺图，只有公开文字明确写明无图时才可这样翻译。只输出 JSON：{"titleZh":"...","descriptionZh":"...","conditionZh":"...","shippingZh":"..."}。',
          },
          {
            role: "user",
            content: JSON.stringify({
              titleRaw: item.titleRaw,
              descriptionRaw: item.descriptionRaw ?? "平台没有公开卖家正文",
              conditionRaw: item.conditionRaw ?? "平台没有公开品相说明",
              shippingRaw,
            }),
          },
        ],
      });
      const result = execution.data;
      // The crawler resets detailsZh on every refresh, so the public detail
      // rows have to be rebuilt here or they are lost for good. Purchase
      // analysis rows (path "ai.*") live in the same column but are not
      // public fields, so carry those over and append the fresh rows.
      const preservedAiDetails = (
        Array.isArray(item.detailsZh) ? item.detailsZh : []
      ).filter((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row))
          return false;
        const path = (row as Record<string, unknown>).path;
        return typeof path === "string" && path.startsWith("ai.");
      });
      const detailFields = publicDetailFields(item.sourceData);
      const detailRows = await this.translateDetailFields(
        id,
        detailFields,
        costPolicy,
      );
      const translated = await this.prisma.item.update({
        where: { id },
        data: {
          titleZh:
            typeof result.titleZh === "string" && result.titleZh.trim()
              ? result.titleZh.trim()
              : item.titleRaw,
          descriptionZh:
            typeof result.descriptionZh === "string" &&
            result.descriptionZh.trim()
              ? result.descriptionZh.trim()
              : item.descriptionRaw,
          conditionZh:
            typeof result.conditionZh === "string" && result.conditionZh.trim()
              ? result.conditionZh.trim()
              : item.conditionRaw,
          shippingZh:
            typeof result.shippingZh === "string" && result.shippingZh.trim()
              ? result.shippingZh.trim()
              : shippingRaw,
          detailsZh: [...preservedAiDetails, ...detailRows],
          translationStatus: "completed",
          translatedAt: new Date(),
        },
        select: {
          id: true,
          titleZh: true,
          descriptionZh: true,
          conditionZh: true,
          shippingZh: true,
          detailsZh: true,
          translationStatus: true,
          translatedAt: true,
        },
      });
      return {
        translation: translated,
        cached: execution.cached,
        model: execution.model,
      };
    } catch (error) {
      await this.prisma.item.update({
        where: { id },
        data: {
          // Gateway/provider failures are temporary. Keep historical work in
          // the retryable backlog instead of creating permanent failures.
          translationStatus: "pending",
        },
      });
      throw error;
    }
  }

  private async translateDetailFields(
    itemId: string,
    fields: Array<{ path: string; value: string }>,
    costPolicy?: AiCostPolicy,
  ) {
    if (!fields.length) return [];
    const chunks = publicDetailFieldChunks(fields);
    const fragments = chunks.flat();
    const translatedFragments = new Map<
      string,
      { labelZh: string; valueZh: string }
    >();
    for (const chunk of chunks) {
      let missing = chunk.filter(
        (fragment) => !translatedFragments.has(fragment.fragmentKey),
      );
      for (let attempt = 0; missing.length && attempt < 3; attempt += 1) {
        const expectedKeys = new Set(
          missing.map((fragment) => fragment.fragmentKey),
        );
        const execution = await this.productAi.execute<{
          translations?: unknown;
        }>("translation", {
          responseSchema: detailFragmentsSchema(
            new Map(
              missing.map((fragment) => [fragment.fragmentKey, fragment.path]),
            ),
            new Map(
              missing.map((fragment) => [fragment.fragmentKey, fragment.value]),
            ),
          ),
          itemId,
          maxTokens: 4_000,
          ...(costPolicy ? { costPolicy } : {}),
          // A structurally incomplete response must not be replayed from the
          // long-lived translation cache. Retry only the omitted fragments.
          ...(attempt > 0 ? { bypassCache: true } : {}),
          messages: [
            {
              role: "system",
              content:
                '你是日本中古商品公开字段的完整翻译员。逐项完整翻译 value，不得摘要、删减数字、条件、配件、瑕疵、运费、时间或专有名词。fragmentKey 和 path 必须原样返回，顺序和数量必须与输入完全一致；labelZh 是普通中文用户能理解的简短字段名。只输出 JSON：{"translations":[{"fragmentKey":"...","path":"...","labelZh":"...","valueZh":"完整中文翻译"}]}。',
            },
            {
              role: "user",
              content: JSON.stringify({ fields: missing }),
            },
          ],
        });
        const rows = Array.isArray(execution.data.translations)
          ? execution.data.translations
          : [];
        for (const row of rows) {
          if (!row || typeof row !== "object" || Array.isArray(row)) continue;
          const value = row as Record<string, unknown>;
          if (
            typeof value.fragmentKey !== "string" ||
            !expectedKeys.has(value.fragmentKey) ||
            translatedFragments.has(value.fragmentKey) ||
            typeof value.valueZh !== "string" ||
            !value.valueZh.trim()
          )
            continue;
          translatedFragments.set(value.fragmentKey, {
            labelZh:
              typeof value.labelZh === "string" && value.labelZh.trim()
                ? value.labelZh.trim()
                : typeof value.path === "string" && value.path.trim()
                  ? value.path.trim()
                  : value.fragmentKey,
            valueZh: value.valueZh.trim(),
          });
        }
        missing = missing.filter(
          (fragment) => !translatedFragments.has(fragment.fragmentKey),
        );
      }
      if (missing.length)
        throw new Error(
          `Detail translation omitted ${missing.length} public field fragments after 3 attempts`,
        );
    }

    return fields.map((field, fieldIndex) => {
      // Reassemble the exact fragments produced by the chunker. Re-splitting
      // with a different character budget can silently drop or misorder long
      // marketplace descriptions.
      const fieldFragments = fragments
        .filter((fragment) => fragment.fragmentKey.startsWith(`${fieldIndex}:`))
        .sort((left, right) => left.part - right.part);
      const translated = fieldFragments.map((fragment) => {
        const row = translatedFragments.get(fragment.fragmentKey);
        if (!row)
          throw new Error(
            `Detail translation missing ${field.path} part ${fragment.part}`,
          );
        return row;
      });
      return {
        path: field.path,
        labelZh: translated[0]?.labelZh ?? field.path,
        valueZh: translated.map((part) => part.valueZh).join(""),
      };
    });
  }

  async seller(id: string, targetPrice?: number, page = 1, limit = 48) {
    const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(100, Math.floor(limit)))
      : 48;
    const seller = await this.prisma.seller.findUnique({
      where: { id },
      include: {
        source: { select: { key: true, displayName: true } },
        items: {
          where: activeMarketItemWhere(),
          select: {
            id: true,
            titleRaw: true,
            descriptionRaw: true,
            priceCurrent: true,
            shippingFee: true,
            priceTotalEst: true,
            listingType: true,
            conditionRaw: true,
            conditionGrade: true,
            categoryToyType: true,
            status: true,
            listedAt: true,
            sourceUrl: true,
            sourceData: true,
            source: { select: { key: true, displayName: true } },
            images: {
              select: { url: true, position: true },
              orderBy: { position: "asc" },
            },
          },
          orderBy: { detectedAt: "desc" },
        },
      },
    });
    if (!seller) return null;
    // Fetch the complete active catalogue for analysis. Pagination only
    // controls the visible slice returned to the dialog.
    const allItems = seller.items;
    const items = allItems.slice(
      (safePage - 1) * safeLimit,
      safePage * safeLimit,
    );
    const { items: _allItems, ...sellerProfile } = seller;
    const segment = classifySellerSegment({
      sellerType: seller.sellerType,
      sourceKey: seller.source.key,
      sourceDisplayName: seller.source.displayName,
      sourceData: seller.sourceData,
      visibleItems: allItems,
    });
    const sellerProfileWithSegment = { ...sellerProfile, segment };
    const fallbackNegotiation = negotiationFallback(targetPrice);
    const fallback = {
      sellerType: segment.label,
      profile: `该卖家在${seller.source.displayName}有 ${allItems.length} 条在售记录。请结合商品描述、成色、运费和成交状态核验。`,
      ...fallbackNegotiation,
      negotiation: fallbackNegotiation.negotiationJa,
      suggestedPrice: targetPrice ?? null,
      confidence: "依据当前可见商品记录",
    };
    const catalogStats = allItems.reduce(
      (stats, item) => {
        stats.listingType[item.listingType] =
          (stats.listingType[item.listingType] ?? 0) + 1;
        stats.status[item.status] = (stats.status[item.status] ?? 0) + 1;
        stats.condition[item.conditionGrade] =
          (stats.condition[item.conditionGrade] ?? 0) + 1;
        stats.priceMin = Math.min(stats.priceMin, item.priceCurrent);
        stats.priceMax = Math.max(stats.priceMax, item.priceCurrent);
        stats.shippingKnown += item.shippingFee == null ? 0 : 1;
        return stats;
      },
      {
        listingType: {} as Record<string, number>,
        status: {} as Record<string, number>,
        condition: {} as Record<string, number>,
        priceMin: Number.POSITIVE_INFINITY,
        priceMax: 0,
        shippingKnown: 0,
      },
    );
    // Seller-page stat bricks: counts and price band over the seller's whole
    // visible catalogue. Sold items sit outside the live market scope, so
    // they are counted separately; an empty catalogue reports null prices
    // instead of leaking the reducer's Infinity seed.
    const soldCount = await this.prisma.item.count({
      where: { sellerId: id, lifecycleStatus: "sold" },
    });
    const lastListedAt = allItems.reduce<Date | null>((latest, item) => {
      const listed = item.listedAt ? new Date(item.listedAt) : null;
      if (!listed || Number.isNaN(listed.getTime())) return latest;
      return latest && latest.getTime() >= listed.getTime() ? latest : listed;
    }, null);
    const stats = {
      activeCount: allItems.length,
      soldCount,
      priceMinJpy:
        allItems.length > 0 && Number.isFinite(catalogStats.priceMin)
          ? catalogStats.priceMin
          : null,
      priceMaxJpy: allItems.length > 0 ? catalogStats.priceMax : null,
      lastListedAt: lastListedAt ? lastListedAt.toISOString() : null,
    };
    if (!this.gateway.configured() || allItems.length === 0) {
      return {
        seller: sellerProfileWithSegment,
        items,
        stats,
        total: allItems.length,
        page: safePage,
        limit: safeLimit,
        pageCount: Math.max(1, Math.ceil(allItems.length / safeLimit)),
        analysis: fallback,
        mode: "rules",
      };
    }
    try {
      type SellerModelResult = {
        sellerType?: unknown;
        profile?: unknown;
        negotiation?: unknown;
        negotiationJa?: unknown;
        negotiationZh?: unknown;
        suggestedPrice?: unknown;
      };
      const sellerRows = allItems.map((item) => ({
        id: item.id,
        titleRaw: item.titleRaw,
        // Preserve every public description. Large catalogues are processed
        // in bounded batches so the model never receives keyword-sized data.
        descriptionRaw: (item.descriptionRaw ?? "").replace(/\s+/g, " "),
        priceCurrent: item.priceCurrent,
        shippingFee: item.shippingFee,
        listingType: item.listingType,
        conditionRaw: item.conditionRaw,
        conditionGrade: item.conditionGrade,
        status: item.status,
        listedAt: item.listedAt,
        sourceUrl: item.sourceUrl,
        sourceData: item.sourceData,
      }));
      const sellerPublicFacts = {
        name: seller.name,
        type: seller.sellerType,
        locationText: seller.locationText,
        profileUrl: seller.profileUrl,
        source: seller.source,
        sourceData: seller.sourceData,
      };
      const systemPrompt =
        '你是日本中古特摄采购谈判顾问。系统已经根据公开资料和全部可见商品确定卖家群体标签；你只能解释该标签，不得改写或推断私人身份。根据商品描述、价格、运费、成色和真实平台总结可核验的中文画像。针对用户给定预算生成礼貌、自然、可直接复制给日本卖家的日语砍价消息 negotiationJa，并提供逐意对应的简体中文小字翻译 negotiationZh。日语必须是主文，中文不能混进日语正文。明确询问商品状态、配件和运费，只有输入了预算才写入具体价格。禁止虚构卖家信息，禁止评分。只输出 JSON：{"profile":"...","negotiationJa":"...","negotiationZh":"...","suggestedPrice":数字或null}。';
      let execution: { data: SellerModelResult; model: string };
      if (sellerRows.length <= 120) {
        execution = await this.gateway.executeJson<SellerModelResult>({
          responseSchema: SELLER_PROFILE_SCHEMA,
          task: "seller_analysis",
          dataClass: "public_market",
          costPolicy: "free_first",
          sellerId: id,
          maxTokens: 5_000,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: JSON.stringify({
                targetPrice: targetPrice ?? null,
                seller: sellerPublicFacts,
                sellerSegment: segment,
                catalogStats,
                items: sellerRows,
              }),
            },
          ],
        });
      } else {
        const batchSummaries: unknown[] = [];
        for (let start = 0; start < sellerRows.length; start += 120) {
          const batch = sellerRows.slice(start, start + 120);
          const summary = await this.gateway.executeJson<{
            catalogSummary?: unknown;
            facts?: unknown;
            risks?: unknown;
          }>({
            responseSchema: SELLER_BATCH_SUMMARY_SCHEMA,
            task: "seller_analysis",
            dataClass: "public_market",
            costPolicy: "free_first",
            sellerId: id,
            maxTokens: 2_500,
            messages: [
              {
                role: "system",
                content:
                  '你是卖家目录分析助手。只依据输入的这一批商品及完整描述，提炼可核验的商品结构、成色、价格区间、运费、交易方式和风险；不得省略事实，不要评分，不要虚构。只输出 JSON：{"catalogSummary":"...","facts":["..."],"risks":["..."]}。',
              },
              {
                role: "user",
                content: JSON.stringify({
                  seller: sellerPublicFacts,
                  batch: `${start + 1}-${Math.min(start + 120, sellerRows.length)}`,
                  items: batch,
                }),
              },
            ],
          });
          batchSummaries.push(summary.data);
        }
        execution = await this.gateway.executeJson<SellerModelResult>({
          responseSchema: SELLER_PROFILE_SCHEMA,
          task: "seller_analysis",
          dataClass: "public_market",
          costPolicy: "free_first",
          sellerId: id,
          maxTokens: 5_000,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: JSON.stringify({
                targetPrice: targetPrice ?? null,
                seller: sellerPublicFacts,
                sellerSegment: segment,
                catalogStats,
                catalogueBatches: batchSummaries,
                instruction:
                  "这些批次覆盖卖家的全部商品和完整公开描述。综合所有批次，不要补写输入中没有的事实。",
              }),
            },
          ],
        });
      }
      const result = execution.data;
      const analysis = {
        sellerType: segment.label,
        // The operational segment remains deterministic. The narrative profile
        // may summarize only the complete public seller/catalogue evidence sent
        // above; the response schema prevents it from becoming an identity or
        // reliability score.
        profile:
          typeof result.profile === "string" && result.profile.trim()
            ? result.profile.trim()
            : fallback.profile,
        negotiationJa:
          typeof result.negotiationJa === "string" &&
          result.negotiationJa.trim()
            ? result.negotiationJa.trim()
            : typeof result.negotiation === "string" &&
                result.negotiation.trim()
              ? result.negotiation.trim()
              : fallback.negotiationJa,
        negotiationZh:
          typeof result.negotiationZh === "string" &&
          result.negotiationZh.trim()
            ? result.negotiationZh.trim()
            : fallback.negotiationZh,
        suggestedPrice: fallback.suggestedPrice,
        confidence: fallback.confidence,
      };
      return {
        seller: sellerProfileWithSegment,
        items,
        stats,
        total: allItems.length,
        page: safePage,
        limit: safeLimit,
        pageCount: Math.max(1, Math.ceil(allItems.length / safeLimit)),
        analysis: { ...analysis, negotiation: analysis.negotiationJa },
        mode: "ai",
        model: execution.model,
      };
    } catch {
      return {
        seller: sellerProfileWithSegment,
        items,
        stats,
        total: allItems.length,
        page: safePage,
        limit: safeLimit,
        pageCount: Math.max(1, Math.ceil(allItems.length / safeLimit)),
        analysis: fallback,
        mode: "rules",
      };
    }
  }

  async refreshSeller(id: string): Promise<
    | { enqueued: false; reason: "unsupported_source" | "fresh" }
    | { enqueued: true }
  > {
    const seller = await this.prisma.seller.findUnique({
      where: { id },
      select: {
        id: true,
        sourceData: true,
        source: { select: { key: true } },
      },
    });

    if (!seller) {
      throw new NotFoundException(`Seller ${id} not found`);
    }

    if (seller.source.key !== "mercari") {
      return { enqueued: false, reason: "unsupported_source" };
    }

    const sourceData = (seller.sourceData as Record<string, unknown> | null) ?? null;
    const lastCatalogueRefreshAt = sourceData?.lastCatalogueRefreshAt;
    if (typeof lastCatalogueRefreshAt === "string") {
      const lastTime = new Date(lastCatalogueRefreshAt).getTime();
      const sixHoursMs = 6 * 60 * 60 * 1000;
      if (Number.isFinite(lastTime) && Date.now() - lastTime < sixHoursMs) {
        return { enqueued: false, reason: "fresh" };
      }
    }

    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
    const queue = new Queue("seller-catalogue-refresh", { connection: redis });
    try {
      const jobId = `seller-catalogue-${seller.id}`;
      // A retained terminal job with the same id makes Queue.add a silent
      // no-op in BullMQ, which would block this seller from ever refreshing
      // again. Clear completed/failed leftovers so the add below schedules
      // real work; a waiting/active job is left untouched and dedupes.
      const existing = await queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === "completed" || state === "failed") {
          await existing.remove();
        }
      }
      await queue.add(
        "refresh",
        { sellerId: seller.id },
        {
          jobId,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } finally {
      await queue.close();
      await redis.quit();
    }

    return { enqueued: true };
  }
}
