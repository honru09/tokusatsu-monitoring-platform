import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";

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
    return {
      mode: "rules",
      engineLabel: "透明规则分析（可接入 AI）",
      generatedAt: new Date().toISOString(),
      sampleSize: items.length,
      bestValue,
      largestQuantity,
      bestCondition,
      ranking,
      recommendation,
    };
  }
}
