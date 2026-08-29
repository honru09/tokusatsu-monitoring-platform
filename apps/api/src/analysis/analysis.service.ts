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
        procurementScore: true,
        conditionGrade: true,
        status: true,
        imageCount: true,
        source: { select: { key: true, displayName: true } },
      },
      orderBy: { procurementScore: "desc" },
      take: 1000,
    });
    const bestValue =
      [...items].sort(
        (a, b) =>
          b.procurementScore - a.procurementScore ||
          (a.unitCostEst ?? Number.MAX_SAFE_INTEGER) -
            (b.unitCostEst ?? Number.MAX_SAFE_INTEGER),
      )[0] ?? null;
    const largestQuantity =
      [...items].sort(
        (a, b) => (b.quantityEst ?? 0) - (a.quantityEst ?? 0),
      )[0] ?? null;
    const bestCondition =
      [...items].sort(
        (a, b) =>
          (conditionWeight[b.conditionGrade] ?? 0) -
            (conditionWeight[a.conditionGrade] ?? 0) ||
          b.procurementScore - a.procurementScore,
      )[0] ?? null;
    const ranking = items
      .slice(0, 10)
      .map((item, index) => ({ rank: index + 1, ...item }));
    const recommendation = bestValue
      ? `优先关注「${bestValue.titleRaw.slice(0, 42)}」：采购评分 ${bestValue.procurementScore}，估算单件 ${bestValue.unitCostEst == null ? "未知" : `¥${bestValue.unitCostEst.toLocaleString("ja-JP")}`}。结合数量、成色和价格计算，建议先核验详情与竞拍截止时间。`
      : "当前没有可分析的在售商品，等待下一轮市场扫描。";
    let mode: "rules" | "ai" = "rules";
    let engineLabel = "透明规则分析";
    let aiRecommendation: string | null = null;
    if (bestValue && process.env.DEEPSEEK_API_KEY?.trim()) {
      try {
        const promptItems = items.slice(0, 60).map((item) => ({
          id: item.id,
          title: item.titleRaw,
          price: item.priceCurrent,
          total: item.priceTotalEst,
          unitCost: item.unitCostEst,
          quantity: item.quantityEst,
          score: item.procurementScore,
          condition: item.conditionGrade,
          status: item.status,
          channel: item.source.displayName,
        }));
        const result = await this.askDeepSeek<{ recommendation?: unknown }>(
          [
            {
              role: "system",
              content:
                '你是日本特摄中古商品采购顾问。根据给出的商品数据，生成一段简洁、可执行的中文采购建议。必须指出最值得优先核验的商品，并说明价格、数量、成色或风险依据。只输出 JSON：{"recommendation":"..."}。',
            },
            { role: "user", content: JSON.stringify(promptItems) },
          ],
          1200,
        );
        if (
          typeof result.recommendation === "string" &&
          result.recommendation.trim()
        ) {
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
      ranking,
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
