import { Injectable } from "@nestjs/common";
import { SourceChannel, ToyType } from "@tokusatsu/db";
import { AiGatewayService } from "../ai/ai-gateway.service.js";
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
      if (!text || /(?:image|thumbnail|photo|url)$/i.test(path)) return;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGatewayService,
  ) {}

  async market() {
    const items = await this.prisma.item.findMany({
      where: {
        archivedAt: null,
        channel: "online",
        purchaseRecord: null,
        ignored: false,
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
      },
      select: {
        id: true,
        titleRaw: true,
        sourceUrl: true,
        priceCurrent: true,
        priceTotalEst: true,
        unitCostEst: true,
        quantityEst: true,
        conditionGrade: true,
        status: true,
        imageCount: true,
        descriptionRaw: true,
        shippingFee: true,
        listingType: true,
        bidCount: true,
        auctionEndAt: true,
        detectedAt: true,
        source: { select: { key: true, displayName: true } },
      },
      orderBy: { detectedAt: "desc" },
      take: 1000,
    });
    const fallbackBestValue =
      items
        .filter((item) => item.unitCostEst != null)
        .sort(
          (a, b) =>
            (a.unitCostEst ?? Number.MAX_SAFE_INTEGER) -
              (b.unitCostEst ?? Number.MAX_SAFE_INTEGER) ||
            (b.quantityEst ?? 0) - (a.quantityEst ?? 0),
        )[0] ?? null;
    const fallbackLargestQuantity =
      [...items].sort(
        (a, b) => (b.quantityEst ?? 0) - (a.quantityEst ?? 0),
      )[0] ?? null;
    const fallbackBestCondition =
      [...items].sort(
        (a, b) =>
          (conditionWeight[b.conditionGrade] ?? 0) -
          (conditionWeight[a.conditionGrade] ?? 0),
      )[0] ?? null;
    let bestValue = fallbackBestValue;
    let largestQuantity = fallbackLargestQuantity;
    let bestCondition = fallbackBestCondition;
    const recommendation = fallbackBestValue
      ? `建议先核验「${fallbackBestValue.titleRaw.slice(0, 42)}」：估算单件 ${fallbackBestValue.unitCostEst == null ? "未知" : `¥${fallbackBestValue.unitCostEst.toLocaleString("ja-JP")}`}。同时确认数量、成色、缺件情况与竞拍截止时间。`
      : "当前没有可分析的在售商品，等待下一轮市场扫描。";
    let mode: "rules" | "ai" = "rules";
    let engineLabel = "透明规则分析";
    let aiRecommendation: string | null = null;
    const fallbackRanked = items
      .filter((item) => item.unitCostEst != null)
      .sort(
        (a, b) =>
          (a.unitCostEst ?? Number.MAX_SAFE_INTEGER) -
            (b.unitCostEst ?? Number.MAX_SAFE_INTEGER) ||
          (b.quantityEst ?? 0) - (a.quantityEst ?? 0),
      )
      .slice(0, 5)
      .map((item) => ({
        item,
        reason: `估算单件 ${item.unitCostEst == null ? "未知" : `¥${item.unitCostEst.toLocaleString("ja-JP")}`}，数量 ${item.quantityEst ?? "未知"} 件，购买前仍需核验缺件、成色和运费。`,
      }));
    let rankedRecommendations = fallbackRanked;
    let insights = [
      `本次分析读取 ${items.length} 件在售商品，其中拍卖 ${items.filter((item) => item.listingType === "auction").length} 件，直购 ${items.filter((item) => item.listingType === "direct").length} 件。`,
    ];
    let risks = [
      `${items.filter((item) => item.shippingFee == null).length} 件没有可靠固定运费，比较价格时需要到原平台确认最终配送成本。`,
      `${items.filter((item) => item.quantityEst == null).length} 件数量尚未可靠识别，不应直接按单件估值采购。`,
    ];
    if (fallbackBestValue && this.gateway.configured()) {
      try {
        const promptItems = items.slice(0, 80).map((item) => ({
          id: item.id,
          title: item.titleRaw,
          price: item.priceCurrent,
          total: item.priceTotalEst,
          unitCost: item.unitCostEst,
          quantity: item.quantityEst,
          condition: item.conditionGrade,
          status: item.status,
          listingType: item.listingType,
          bidCount: item.bidCount,
          auctionEndAt: item.auctionEndAt,
          shippingFee: item.shippingFee,
          platform: item.source.displayName,
          description: item.descriptionRaw?.slice(0, 1_200) ?? null,
        }));
        const execution = await this.gateway.executeJson<{
          bestValueId?: unknown;
          largestQuantityId?: unknown;
          bestConditionId?: unknown;
          recommendation?: unknown;
          ranked?: unknown;
          insights?: unknown;
          risks?: unknown;
        }>({
          task: "market_analysis",
          dataClass: "public_market",
          costPolicy: "free_first",
          maxTokens: 1_200,
          messages: [
            {
              role: "system",
              content:
                '你是日本特摄中古商品采购顾问。严禁生成数字评分或虚构信息。请完整结合商品标题、卖家描述、当前价、预计总价、运费、数量、品相、拍卖/直购方式、竞拍次数、截止时间和真实平台，选择三个可核验的商品，并给出中文采购判断。明确区分已知事实、需要核验的风险和推断，不得把未知信息写成事实。bestValueId 表示价格、数量、成色和总成本综合最值得核验，largestQuantityId 表示数量最大，bestConditionId 表示品相最好；ID 必须来自输入。ranked 返回最多 5 个输入中的商品，按采购优先级排列，每项包含 id 和不超过 80 字的具体 reason。insights 与 risks 各返回 2 至 4 条具体结论，不得评分。只输出 JSON：{"bestValueId":"id","largestQuantityId":"id","bestConditionId":"id","recommendation":"...","ranked":[{"id":"id","reason":"..."}],"insights":["..."],"risks":["..."]}。',
            },
            { role: "user", content: JSON.stringify(promptItems) },
          ],
        });
        const result = execution.data;
        if (
          typeof result.recommendation === "string" &&
          result.recommendation.trim()
        ) {
          const byId = new Map(items.map((item) => [item.id, item]));
          if (typeof result.bestValueId === "string")
            bestValue = byId.get(result.bestValueId) ?? bestValue;
          if (typeof result.largestQuantityId === "string")
            largestQuantity =
              byId.get(result.largestQuantityId) ?? largestQuantity;
          if (typeof result.bestConditionId === "string")
            bestCondition = byId.get(result.bestConditionId) ?? bestCondition;
          mode = "ai";
          engineLabel = execution.model;
          aiRecommendation = result.recommendation.trim();
          if (Array.isArray(result.ranked)) {
            const ranked = result.ranked.flatMap((entry) => {
              if (!entry || typeof entry !== "object") return [];
              const value = entry as Record<string, unknown>;
              if (typeof value.id !== "string") return [];
              const item = byId.get(value.id);
              if (!item) return [];
              return [
                {
                  item,
                  reason:
                    typeof value.reason === "string" && value.reason.trim()
                      ? value.reason.trim()
                      : "请核验数量、品相、配件和最终运费。",
                },
              ];
            });
            if (ranked.length) rankedRecommendations = ranked.slice(0, 5);
          }
          if (Array.isArray(result.insights)) {
            const next = result.insights.filter(
              (value): value is string =>
                typeof value === "string" && Boolean(value.trim()),
            );
            if (next.length) insights = next.slice(0, 4);
          }
          if (Array.isArray(result.risks)) {
            const next = result.risks.filter(
              (value): value is string =>
                typeof value === "string" && Boolean(value.trim()),
            );
            if (next.length) risks = next.slice(0, 4);
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

  async translate(body: TranslateDto) {
    const texts = body.texts.map((text) => text.trim());
    const execution = await this.gateway.executeJson<{
      translations?: unknown;
      confidence?: unknown;
    }>({
      task: "translation",
      dataClass: "public_market",
      costPolicy: "free_first",
      maxTokens: 9_000,
      messages: [
        {
          role: "system",
          content:
            '你是日本特摄中古商品采购平台的专业翻译。逐条完整翻译输入文本，不得摘要、改写成关键词或省略句子。保留数量、角色、版本、编号、成色、缺件、套装、卖家备注、运费、时间和交易条件等全部事实；日语商品标题中的修饰词和括号内容也要翻译。无法确定的专有名词保留原文并在括号中说明，不要擅自补充信息。输出数组长度必须与输入相同，按输入顺序输出 JSON：{"translations":["完整中文翻译"]}。',
        },
        { role: "user", content: JSON.stringify({ texts }) },
      ],
    });
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

  async itemTranslation(id: string, refresh = false) {
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
    const cachedDetails = Array.isArray(item.detailsZh) ? item.detailsZh : [];
    const hasPurchaseAnalysis = cachedDetails.some(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        (entry as Record<string, unknown>).path === "ai.purchaseSummary",
    );
    if (
      !refresh &&
      item.translationStatus === "completed" &&
      item.titleZh &&
      hasPurchaseAnalysis
    ) {
      return { translation: item, cached: true };
    }
    await this.prisma.item.update({
      where: { id },
      data: { translationStatus: "processing" },
    });
    const detailFields = publicDetailFields(item.sourceData);
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
      const execution = await this.gateway.executeJson<{
        titleZh?: unknown;
        descriptionZh?: unknown;
        conditionZh?: unknown;
        shippingZh?: unknown;
        detailTranslations?: unknown;
        purchaseSummaryZh?: unknown;
        includedItemsZh?: unknown;
        missingOrRiskZh?: unknown;
        checksBeforePurchaseZh?: unknown;
        confidence?: unknown;
      }>({
        task: "classification",
        dataClass: "public_market",
        costPolicy: "free_first",
        itemId: id,
        maxTokens: 12_000,
        messages: [
          {
            role: "system",
            content:
              '你是日本特摄中古商品的专业全量翻译员和采购信息整理员。必须把输入中的商品标题、卖家正文、品相、运费、交易条件和所有公开字段逐项完整翻译成自然、准确、中文母语者可独立理解的简体中文。不得摘要，不得只翻译角色名，不得省略括号、数量、缺件、瑕疵、版本、型号、时间、配送和竞拍条件；品牌、型号或无法确定的专名可保留原文并给出中文说明。detailTranslations 必须与 detailFields 等长、按相同顺序返回 path、便于普通用户理解的中文字段名 labelZh，以及完整 valueZh。另外基于公开信息生成四项采购解读：purchaseSummaryZh 说明商品到底是什么、销售方式和已知价值点；includedItemsZh 完整列出明确包含的本体、配件、包装与数量；missingOrRiskZh 只列出明确缺失、瑕疵、未知或需要核验的风险，不能把推断写成事实；checksBeforePurchaseZh 给出购买前需要确认的具体事项。绝对不能因为输入里没有图片字段就声称卖家未提供实物照片、没有图片或缺图，只有公开文字明确写明无图时才可这样判断。只输出 JSON：{"titleZh":"...","descriptionZh":"...","conditionZh":"...","shippingZh":"...","detailTranslations":[{"path":"...","labelZh":"中文字段名","valueZh":"完整字段翻译"}],"purchaseSummaryZh":"...","includedItemsZh":"...","missingOrRiskZh":"...","checksBeforePurchaseZh":"..."}。',
          },
          {
            role: "user",
            content: JSON.stringify({
              titleRaw: item.titleRaw,
              descriptionRaw: item.descriptionRaw ?? "平台没有公开卖家正文",
              conditionRaw: item.conditionRaw ?? "平台没有公开品相说明",
              shippingRaw,
              detailFields,
            }),
          },
        ],
      });
      const result = execution.data;
      const detailTranslations = Array.isArray(result.detailTranslations)
        ? result.detailTranslations.flatMap((entry) => {
            if (!entry || typeof entry !== "object") return [];
            const value = entry as Record<string, unknown>;
            return typeof value.path === "string" &&
              typeof value.valueZh === "string"
              ? [
                  {
                    path: value.path,
                    labelZh:
                      typeof value.labelZh === "string" && value.labelZh.trim()
                        ? value.labelZh.trim()
                        : value.path,
                    valueZh: value.valueZh,
                  },
                ]
              : [];
          })
        : [];
      const analysisRows = [
        ["ai.model", "AI 模型", execution.model],
        ["ai.purchaseSummary", "AI 采购解读", result.purchaseSummaryZh],
        ["ai.includedItems", "包含内容", result.includedItemsZh],
        ["ai.missingOrRisk", "缺失与风险", result.missingOrRiskZh],
        [
          "ai.checksBeforePurchase",
          "购买前确认",
          result.checksBeforePurchaseZh,
        ],
      ].flatMap(([path, labelZh, value]) =>
        typeof value === "string" && value.trim()
          ? [
              {
                path: path as string,
                labelZh: labelZh as string,
                valueZh: value.trim(),
              },
            ]
          : [],
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
          detailsZh: [...analysisRows, ...detailTranslations],
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
          where: {
            archivedAt: null,
            channel: SourceChannel.online,
            purchaseRecord: null,
            categoryToyType: { not: ToyType.card },
          },
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
    if (!this.gateway.configured() || allItems.length === 0) {
      return {
        seller: sellerProfileWithSegment,
        items,
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
      }));
      const systemPrompt =
        '你是日本中古特摄采购谈判顾问。系统已经根据公开资料和全部可见商品确定卖家群体标签；你只能解释该标签，不得改写或推断私人身份。根据商品描述、价格、运费、成色和真实平台总结可核验的中文画像。针对用户给定预算生成礼貌、自然、可直接复制给日本卖家的日语砍价消息 negotiationJa，并提供逐意对应的简体中文小字翻译 negotiationZh。日语必须是主文，中文不能混进日语正文。明确询问商品状态、配件和运费，只有输入了预算才写入具体价格。禁止虚构卖家信息，禁止评分。只输出 JSON：{"profile":"...","negotiationJa":"...","negotiationZh":"...","suggestedPrice":数字或null}。';
      let execution: { data: SellerModelResult; model: string };
      if (sellerRows.length <= 120) {
        execution = await this.gateway.executeJson<SellerModelResult>({
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
                seller: { name: seller.name, type: seller.sellerType },
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
                  seller: { name: seller.name, type: seller.sellerType },
                  batch: `${start + 1}-${Math.min(start + 120, sellerRows.length)}`,
                  items: batch,
                }),
              },
            ],
          });
          batchSummaries.push(summary.data);
        }
        execution = await this.gateway.executeJson<SellerModelResult>({
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
                seller: { name: seller.name, type: seller.sellerType },
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
        suggestedPrice:
          typeof result.suggestedPrice === "number"
            ? result.suggestedPrice
            : fallback.suggestedPrice,
        confidence: "基于卖家当前可见商品与原始描述",
      };
      return {
        seller: sellerProfileWithSegment,
        items,
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
        total: allItems.length,
        page: safePage,
        limit: safeLimit,
        pageCount: Math.max(1, Math.ceil(allItems.length / safeLimit)),
        analysis: fallback,
        mode: "rules",
      };
    }
  }
}
