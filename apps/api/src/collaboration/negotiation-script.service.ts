import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { AiGatewayService } from "../ai/ai-gateway.service.js";
import { BUNDLE_NEGOTIATION_SCHEMA } from "../ai/ai-response-contracts.js";
import { extendedAiScopesEnabled } from "../ai/zhipu.policy.js";

export type NegotiationScriptItem = {
  id: string;
  titleRaw: string;
  priceCurrent: number;
  shippingFee: number | null;
  sourceUrl: string;
  targetPriceYen: number | null;
};

export type NegotiationScriptGroup = {
  sellerId: string | null;
  sellerName: string | null;
  itemIds: string[];
  script: string;
  fallback: boolean;
};

// Server copy of the fixed template used by the web workspace
// (buildBundleNegotiationScript in collaboration-chat-workspace.tsx). Keep
// the wording in sync: this is what buyers paste when no script is generated.
export function buildBundleNegotiationScript(
  items: Array<{ titleRaw: string; priceCurrent: number }>,
  targetPriceYen?: number | null,
): string {
  if (!items.length) return "";
  if (items.length === 1) {
    const priceText =
      targetPriceYen && targetPriceYen > 0
        ? `${targetPriceYen.toLocaleString("ja-JP")}円にお値下げ可能でしょうか？`
        : "お気持ちお値下げいただくことは可能でしょうか？";
    return `コメント失礼いたします。購入を考えているのですが、こちらの商品は${priceText}即決いたしますので、ご検討よろしくお願いいたします。`;
  }
  const lines = items.map(
    (item) =>
      `・${item.titleRaw.trim()}（¥${item.priceCurrent.toLocaleString("ja-JP")}）`,
  );
  const askLine =
    targetPriceYen && targetPriceYen > 0
      ? `同梱発送で構いませんので、合計${targetPriceYen.toLocaleString("ja-JP")}円でお譲りいただくことは可能でしょうか？`
      : "同梱発送で構いませんので、まとめ割でお気持ちお値引きいただくことは可能でしょうか？";
  return [
    "コメント失礼いたします。",
    `出品されている以下の${items.length}点をまとめて購入希望です。`,
    ...lines,
    askLine,
    "即決いたしますので、ご検討よろしくお願いいたします。",
  ].join("\n");
}

type ShareRoundRow = {
  id: string;
  createdById: string;
  createdAt: Date;
  note: string | null;
};

type ShareRoundItemRow = {
  roundId: string;
  itemId: string;
  targetPriceYen: number | null;
  copiedAt: Date | null;
};

type RoundItemRow = {
  id: string;
  titleRaw: string;
  priceCurrent: number;
  shippingFee: number | null;
  sourceUrl: string;
  sellerId: string | null;
  seller: { id: string; name: string } | null;
};

// ShareRound / ShareRoundItem are read through a narrow structural view so
// the queries stay decoupled from the full generated client surface.
type ShareRoundPrisma = {
  shareRound: {
    findUnique(args: { where: { id: string } }): Promise<ShareRoundRow | null>;
  };
  shareRoundItem: {
    findMany(args: { where: { roundId: string } }): Promise<ShareRoundItemRow[]>;
  };
  item: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: {
        id: true;
        titleRaw: true;
        priceCurrent: true;
        shippingFee: true;
        sourceUrl: true;
        sellerId: true;
        seller: { select: { id: true; name: true } };
      };
    }): Promise<RoundItemRow[]>;
  };
};

@Injectable()
export class NegotiationScriptService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly gateway?: AiGatewayService,
  ) {}

  private rounds(): ShareRoundPrisma {
    return this.prisma;
  }

  async negotiationScript(roundId: string): Promise<{
    roundId: string;
    groups: NegotiationScriptGroup[];
  }> {
    const prisma = this.rounds();
    const round = await prisma.shareRound.findUnique({
      where: { id: roundId },
    });
    if (!round) throw new NotFoundException("分享轮次不存在");
    const roundItems = await prisma.shareRoundItem.findMany({
      where: { roundId },
    });
    if (!roundItems.length) return { roundId, groups: [] };
    const items = await prisma.item.findMany({
      where: { id: { in: roundItems.map((entry) => entry.itemId) } },
      select: {
        id: true,
        titleRaw: true,
        priceCurrent: true,
        shippingFee: true,
        sourceUrl: true,
        sellerId: true,
        seller: { select: { id: true, name: true } },
      },
    });
    const targetByItemId = new Map(
      roundItems.map((entry) => [entry.itemId, entry.targetPriceYen]),
    );
    const byId = new Map(items.map((item) => [item.id, item]));
    // Keep the round's own ordering for items that still exist.
    const ordered: NegotiationScriptItem[] = roundItems.flatMap((entry) => {
      const item = byId.get(entry.itemId);
      if (!item) return [];
      return [
        {
          id: item.id,
          titleRaw: item.titleRaw,
          priceCurrent: item.priceCurrent,
          shippingFee: item.shippingFee,
          sourceUrl: item.sourceUrl,
          targetPriceYen: targetByItemId.get(entry.itemId) ?? null,
        },
      ];
    });
    const sellerByItemId = new Map(
      items.map((item) => [
        item.id,
        item.sellerId && item.seller
          ? { id: item.seller.id, name: item.seller.name }
          : null,
      ]),
    );

    // Group by seller. Items without a seller each form their own group,
    // matching how cart negotiations split seller-less items.
    const groups = new Map<
      string,
      {
        sellerId: string | null;
        sellerName: string | null;
        items: NegotiationScriptItem[];
      }
    >();
    for (const item of ordered) {
      const seller = sellerByItemId.get(item.id) ?? null;
      const key = seller ? `seller:${seller.id}` : `single:${item.id}`;
      const group = groups.get(key) ?? {
        sellerId: seller?.id ?? null,
        sellerName: seller?.name ?? null,
        items: [],
      };
      group.items.push(item);
      groups.set(key, group);
    }

    const result: NegotiationScriptGroup[] = [];
    for (const group of groups.values()) {
      result.push(await this.scriptForGroup(group));
    }
    return { roundId, groups: result };
  }

  private async scriptForGroup(group: {
    sellerId: string | null;
    sellerName: string | null;
    items: NegotiationScriptItem[];
  }): Promise<NegotiationScriptGroup> {
    const itemIds = group.items.map((item) => item.id);
    // Per-item targets win; an item without a target contributes its listed
    // price, so a round with no targets asks for the listed total.
    const targetTotalYen = group.items.reduce(
      (sum, item) => sum + (item.targetPriceYen ?? item.priceCurrent),
      0,
    );
    const template = buildBundleNegotiationScript(group.items, targetTotalYen);
    const fallbackGroup: NegotiationScriptGroup = {
      sellerId: group.sellerId,
      sellerName: group.sellerName,
      itemIds,
      script: template,
      fallback: true,
    };
    if (!extendedAiScopesEnabled() || !this.gateway) return fallbackGroup;
    try {
      const execution = await this.gateway.executeJson<{
        scriptJa?: unknown;
        scriptZh?: unknown;
      }>({
        responseSchema: BUNDLE_NEGOTIATION_SCHEMA,
        task: "bundle_negotiation",
        dataClass: "public_market",
        costPolicy: "free_first",
        ...(group.sellerId ? { sellerId: group.sellerId } : {}),
        maxTokens: 2_000,
        messages: [
          {
            role: "system",
            content:
              "你是日本中古特摄采购谈判顾问。根据输入的同一卖家商品、现价、运费和逐件目标价，生成一条礼貌、自然、可直接贴到该卖家任一商品留言区的合并砍价日语消息 scriptJa，并提供逐意对应的简体中文翻译 scriptZh。逐件列出标题和现价，说明可同梱発送，希望以目标总价成交并表示可立即购买。禁止虚构商品状态或卖家信息。只输出 JSON：{\"scriptJa\":\"...\",\"scriptZh\":\"...\"}。",
          },
          {
            role: "user",
            content: JSON.stringify({
              sellerName: group.sellerName,
              items: group.items.map((item) => ({
                title: item.titleRaw,
                priceCurrentYen: item.priceCurrent,
                shippingFeeYen: item.shippingFee,
                targetPriceYen: item.targetPriceYen ?? item.priceCurrent,
                sourceUrl: item.sourceUrl,
              })),
              listedTotalYen: group.items.reduce(
                (sum, item) => sum + item.priceCurrent,
                0,
              ),
              targetTotalYen,
            }),
          },
        ],
      });
      const scriptJa =
        typeof execution.data.scriptJa === "string"
          ? execution.data.scriptJa.trim()
          : "";
      if (!scriptJa) return fallbackGroup;
      return { ...fallbackGroup, script: scriptJa, fallback: false };
    } catch {
      return fallbackGroup;
    }
  }
}
