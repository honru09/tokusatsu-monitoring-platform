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

export type NegotiationAnalysisItem = NegotiationScriptItem & {
  targetMissing: boolean;
};

export type NegotiationAnalysisGroup = NegotiationScriptGroup & {
  items: NegotiationAnalysisItem[];
  targetTotalYen: number;
  listedTotalYen: number;
  firstItemUrl: string;
};

// An item with everything the grouping logic needs resolved: its script
// fields plus the seller relation and its source (the source key is the
// fallback grouping dimension when a seller name exists without an id).
type ResolvedNegotiationItem = NegotiationScriptItem & {
  sellerId: string | null;
  seller: { id: string; name: string } | null;
  source: { id: string; key: string } | null;
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
  source: { id: string; key: string } | null;
};

// ShareRound / ShareRoundItem are read through a narrow structural view so
// the queries stay decoupled from the full generated client surface.
type ShareRoundPrisma = {
  shareRound: {
    findUnique(args: { where: { id: string } }): Promise<ShareRoundRow | null>;
  };
  shareRoundItem: {
    findMany(args: {
      where: { roundId?: string; itemId?: string };
      orderBy?: { createdAt: "desc" };
      take?: number;
    }): Promise<ShareRoundItemRow[]>;
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
        source: { select: { id: true; key: true } };
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
        source: { select: { id: true, key: true } },
      },
    });
    const targetByItemId = new Map(
      roundItems.map((entry) => [entry.itemId, entry.targetPriceYen]),
    );
    const byId = new Map(items.map((item) => [item.id, item]));
    // Keep the round's own ordering for items that still exist.
    const ordered: ResolvedNegotiationItem[] = roundItems.flatMap((entry) => {
      const item = byId.get(entry.itemId);
      if (!item) return [];
      return [this.resolveItem(item, targetByItemId.get(entry.itemId) ?? null)];
    });

    const result: NegotiationScriptGroup[] = [];
    for (const group of this.groupResolvedItems(ordered)) {
      result.push(await this.scriptForGroup(group));
    }
    return { roundId, groups: result };
  }

  /**
   * Negotiation analysis for an arbitrary multi-selection (e.g. items picked
   * across messages / the cart), not tied to a single share round. Targets
   * come from the given round when one is supplied per item, otherwise from
   * the item's most recent share round, otherwise the item has no target.
   */
  async analyzeSelection(
    entries: Array<{
      itemId: string;
      roundId?: string | null;
      targetPriceYen?: number | null;
    }>,
  ): Promise<{ groups: NegotiationAnalysisGroup[] }> {
    const prisma = this.rounds();
    // Dedupe by itemId, keeping the first occurrence (and its roundId).
    const deduped: Array<{
      itemId: string;
      roundId?: string | null;
      targetPriceYen?: number | null;
    }> = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.itemId)) continue;
      seen.add(entry.itemId);
      deduped.push(entry);
    }
    if (!deduped.length) return { groups: [] };

    const targetByItemId = new Map<string, number | null>();
    for (const entry of deduped) {
      let resolvedTarget: number | null = null;
      if (entry.roundId) {
        const rows = await prisma.shareRoundItem.findMany({
          where: { roundId: entry.roundId, itemId: entry.itemId },
        });
        const fromRound = rows[0]?.targetPriceYen;
        if (typeof fromRound === "number" && fromRound > 0) {
          resolvedTarget = fromRound;
        }
      }
      if (resolvedTarget === null) {
        const rows = await prisma.shareRoundItem.findMany({
          where: { itemId: entry.itemId },
          orderBy: { createdAt: "desc" },
          take: 1,
        });
        const latest = rows.find(
          (row) => typeof row.targetPriceYen === "number" && row.targetPriceYen > 0,
        )?.targetPriceYen;
        if (typeof latest === "number" && latest > 0) {
          resolvedTarget = latest;
        }
      }
      if (
        resolvedTarget === null &&
        typeof entry.targetPriceYen === "number" &&
        Number.isFinite(entry.targetPriceYen) &&
        entry.targetPriceYen > 0
      ) {
        resolvedTarget = Math.round(entry.targetPriceYen);
      }
      targetByItemId.set(entry.itemId, resolvedTarget);
    }

    const items = await prisma.item.findMany({
      where: { id: { in: deduped.map((entry) => entry.itemId) } },
      select: {
        id: true,
        titleRaw: true,
        priceCurrent: true,
        shippingFee: true,
        sourceUrl: true,
        sellerId: true,
        seller: { select: { id: true, name: true } },
        source: { select: { id: true, key: true } },
      },
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    // Keep the caller's selection ordering for items that still exist.
    const ordered: ResolvedNegotiationItem[] = deduped.flatMap((entry) => {
      const item = byId.get(entry.itemId);
      if (!item) return [];
      return [this.resolveItem(item, targetByItemId.get(entry.itemId) ?? null)];
    });

    const groups: NegotiationAnalysisGroup[] = [];
    for (const group of this.groupResolvedItems(ordered)) {
      const scripted = await this.scriptForGroup(group);
      groups.push({
        ...scripted,
        items: group.items.map((item) => ({
          id: item.id,
          titleRaw: item.titleRaw,
          priceCurrent: item.priceCurrent,
          shippingFee: item.shippingFee,
          sourceUrl: item.sourceUrl,
          targetPriceYen: item.targetPriceYen,
          targetMissing: item.targetPriceYen == null,
        })),
        targetTotalYen: group.items.reduce(
          (sum, item) =>
            sum +
            (typeof item.targetPriceYen === "number" && item.targetPriceYen > 0
              ? item.targetPriceYen
              : 0),
          0,
        ),
        listedTotalYen: group.items.reduce(
          (sum, item) => sum + item.priceCurrent,
          0,
        ),
        firstItemUrl: group.items[0]?.sourceUrl ?? "",
      });
    }
    return { groups };
  }

  private resolveItem(
    item: RoundItemRow,
    targetPriceYen: number | null,
  ): ResolvedNegotiationItem {
    return {
      id: item.id,
      titleRaw: item.titleRaw,
      priceCurrent: item.priceCurrent,
      shippingFee: item.shippingFee,
      sourceUrl: item.sourceUrl,
      targetPriceYen,
      sellerId: item.sellerId ?? null,
      seller: item.seller ?? null,
      source: item.source ?? null,
    };
  }

  // Group by seller, preserving input order. Items whose seller relation is
  // present group under that seller; a seller name without a usable id
  // groups by source + name (defensive — the schema FK normally yields the
  // row); items without any seller each form their own group, matching how
  // cart negotiations split seller-less items.
  private groupResolvedItems(items: ResolvedNegotiationItem[]): Array<{
    sellerId: string | null;
    sellerName: string | null;
    items: NegotiationScriptItem[];
  }> {
    const groups = new Map<
      string,
      {
        sellerId: string | null;
        sellerName: string | null;
        items: NegotiationScriptItem[];
      }
    >();
    for (const item of items) {
      let key: string;
      let sellerId: string | null;
      let sellerName: string | null;
      if (item.sellerId && item.seller) {
        key = `seller:${item.seller.id}`;
        sellerId = item.seller.id;
        sellerName = item.seller.name;
      } else if (item.seller?.name) {
        key = `name:${item.source?.key ?? "unknown"}:${item.seller.name}`;
        sellerId = null;
        sellerName = item.seller.name;
      } else {
        key = `single:${item.id}`;
        sellerId = null;
        sellerName = null;
      }
      const group = groups.get(key) ?? { sellerId, sellerName, items: [] };
      group.items.push({
        id: item.id,
        titleRaw: item.titleRaw,
        priceCurrent: item.priceCurrent,
        shippingFee: item.shippingFee,
        sourceUrl: item.sourceUrl,
        targetPriceYen: item.targetPriceYen,
      });
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  private async scriptForGroup(group: {
    sellerId: string | null;
    sellerName: string | null;
    items: NegotiationScriptItem[];
  }): Promise<NegotiationScriptGroup> {
    const itemIds = group.items.map((item) => item.id);
    // Sum only explicit sender target prices; never substitute priceCurrent
    // when a target price is absent so no-target groups use the generic ask.
    const definedTargets = group.items
      .map((item) => item.targetPriceYen)
      .filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value) && value > 0,
      );
    const targetTotalYen =
      definedTargets.length > 0
        ? definedTargets.reduce((sum, value) => sum + value, 0)
        : null;
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
              "你是日本中古特摄采购谈判顾问。根据输入的同一卖家商品、现价、运费和逐件目标价，生成一条礼貌、自然、可直接贴到该卖家任一商品留言区的合并砍价日语消息 scriptJa，并提供逐意对应的简体中文翻译 scriptZh。逐件列出标题和现价，说明可同梱発送，若有目标总价则礼貌询问能否以目标总价成交，若无目标总价则礼貌询问能否小幅议价，并表示可立即购买。严禁把商品现价当作目标砍价金额。禁止虚构商品状态或卖家信息。只输出 JSON：{\"scriptJa\":\"...\",\"scriptZh\":\"...\"}。",
          },
          {
            role: "user",
            content: JSON.stringify({
              sellerName: group.sellerName,
              items: group.items.map((item) => ({
                title: item.titleRaw,
                priceCurrentYen: item.priceCurrent,
                shippingFeeYen: item.shippingFee,
                targetPriceYen: item.targetPriceYen ?? null,
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
