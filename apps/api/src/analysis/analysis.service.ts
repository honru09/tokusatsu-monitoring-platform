import { Injectable, ServiceUnavailableException } from "@nestjs/common";
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

@Injectable()
export class AnalysisService {
  constructor(private readonly prisma: PrismaService) {}

  private deepSeekConfig() {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException("DeepSeek API 未配置");
    }
    return {
      apiKey,
      apiUrl: (
        process.env.DEEPSEEK_API_URL ?? "https://api.deepseek.com"
      ).replace(/\/$/, ""),
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    };
  }

  private async askDeepSeek<T>(
    messages: { role: string; content: string }[],
    maxTokens: number,
  ) {
    const config = this.deepSeekConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${config.apiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          thinking: { type: "disabled" },
          messages,
          response_format: { type: "json_object" },
          max_tokens: maxTokens,
          temperature: 0.2,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`DeepSeek API ${response.status}`);
      }
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("DeepSeek 返回为空");
      const json = content
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      return JSON.parse(json) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async market() {
    const items = await this.prisma.item.findMany({
      where: {
        archivedAt: null,
        purchaseRecord: null,
        ignored: false,
        categoryToyType: { not: "card" },
        NOT: [
          { titleRaw: { contains: "トレカ", mode: "insensitive" } },
          { titleRaw: { contains: "trading card", mode: "insensitive" } },
          { titleRaw: { contains: "card game", mode: "insensitive" } },
          { descriptionRaw: { contains: "カードダス", mode: "insensitive" } },
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
    if (fallbackBestValue && process.env.DEEPSEEK_API_KEY?.trim()) {
      try {
        const promptItems = items.slice(0, 60).map((item) => ({
          id: item.id,
          title: item.titleRaw,
          price: item.priceCurrent,
          total: item.priceTotalEst,
          unitCost: item.unitCostEst,
          quantity: item.quantityEst,
          condition: item.conditionGrade,
          status: item.status,
          channel: item.source.displayName,
        }));
        const result = await this.askDeepSeek<{
          bestValueId?: unknown;
          largestQuantityId?: unknown;
          bestConditionId?: unknown;
          recommendation?: unknown;
        }>(
          [
            {
              role: "system",
              content:
                '你是日本特摄中古商品采购顾问。严禁生成数字评分或虚构信息。根据商品标题、价格、数量、成色和状态选择三个可核验的商品，并给出简洁中文建议。bestValueId 表示价格与数量最值得核验，largestQuantityId 表示数量最大，bestConditionId 表示品相最好；ID 必须来自输入。只输出 JSON：{"bestValueId":"id","largestQuantityId":"id","bestConditionId":"id","recommendation":"..."}。',
            },
            { role: "user", content: JSON.stringify(promptItems) },
          ],
          1200,
        );
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
          engineLabel = "DeepSeek V4 Flash";
          aiRecommendation = result.recommendation.trim();
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
    };
  }

  async translate(body: TranslateDto) {
    const texts = body.texts.map((text) => text.trim());
    const result = await this.askDeepSeek<{ translations?: unknown }>(
      [
        {
          role: "system",
          content:
            '你是日本特摄中古商品采购平台的专业翻译。完整翻译商品标题和描述，保留数量、角色、版本、成色、缺件、套装、卖家备注等事实，不要只翻译关键词，不要擅自补充信息。按输入顺序输出 JSON：{"translations":["完整中文翻译"]}。',
        },
        { role: "user", content: JSON.stringify({ texts }) },
      ],
      4000,
    );
    const translations = Array.isArray(result.translations)
      ? result.translations.map((value, index) =>
          typeof value === "string" && value.trim()
            ? value.trim()
            : texts[index],
        )
      : texts;
    return { translations };
  }
}
