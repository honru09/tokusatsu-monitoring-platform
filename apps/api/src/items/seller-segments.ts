export const sellerSegmentKeys = [
  "professional_store",
  "high_volume",
  "specialist",
  "active_individual",
  "occasional",
] as const;

export type SellerSegmentKey = (typeof sellerSegmentKeys)[number];

export type SellerSegmentDefinition = {
  key: SellerSegmentKey;
  label: string;
  description: string;
};

export type SellerSegment = SellerSegmentDefinition & {
  reasons: string[];
};

export const sellerSegmentDefinitions: readonly SellerSegmentDefinition[] = [
  {
    key: "professional_store",
    label: "专业店铺",
    description:
      "平台公开标记为店铺或零售商来源，通常适合按标准化库存与交易流程采购。",
  },
  {
    key: "high_volume",
    label: "高频在售",
    description:
      "当前收录的可采购商品达到较大规模，适合批量比较、合并询价和持续关注。",
  },
  {
    key: "specialist",
    label: "专类集中",
    description: "当前商品明显集中在同一玩具类型，适合寻找同系列或同类型货源。",
  },
  {
    key: "active_individual",
    label: "活跃二手",
    description: "当前有多件可采购商品，但尚未达到高频或专类集中条件。",
  },
  {
    key: "occasional",
    label: "零散出品",
    description: "当前仅有少量可采购商品或公开资料仍待完善，适合按单件核验。",
  },
] as const;

type SellerSegmentItem = {
  categoryToyType?: string | null;
};

export type SellerSegmentInput = {
  sellerType?: "individual" | "store" | "unknown" | string | null;
  sourceKey?: string | null;
  sourceDisplayName?: string | null;
  sourceData?: unknown;
  visibleItems: readonly SellerSegmentItem[];
};

const retailerSources = new Set(["mandarake", "surugaya", "yahoo_shopping"]);

const toyTypeLabels: Record<string, string> = {
  gashapon: "扭蛋",
  shokugan: "食玩",
  figure: "手办",
  sofubi: "软胶",
  finger_puppet: "指偶",
  dx_belt: "DX 腰带",
  henshin_item: "变身道具",
  medal: "徽章/币类",
  model: "模型",
  set: "套装",
  other: "其他玩具",
};

function definition(key: SellerSegmentKey) {
  return sellerSegmentDefinitions.find((entry) => entry.key === key)!;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function explicitlyStore(input: SellerSegmentInput) {
  if (input.sellerType === "store") return true;
  if (input.sourceKey && retailerSources.has(input.sourceKey)) return true;
  const data = record(input.sourceData);
  if (!data) return false;
  if (data.isStore === true || data.is_store === true) return true;
  const shop = record(data.shop);
  return Boolean(
    shop &&
      (typeof shop.name === "string" ||
        typeof shop.shopName === "string" ||
        typeof data.shopName === "string"),
  );
}

function mostCommonToyType(items: readonly SellerSegmentItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.categoryToyType;
    if (!key || key === "unknown" || key === "card") continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    ([leftKey, leftCount], [rightKey, rightCount]) =>
      rightCount - leftCount ||
      (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0),
  )[0];
}

/**
 * Assign an operational purchasing segment using only public marketplace
 * fields and the catalogue currently visible to this system. The result is
 * deliberately deterministic and never infers a seller's private identity.
 */
export function classifySellerSegment(
  input: SellerSegmentInput,
): SellerSegment {
  const itemCount = input.visibleItems.length;
  if (explicitlyStore(input)) {
    const sourceName = input.sourceDisplayName?.trim();
    const reason = retailerSources.has(input.sourceKey ?? "")
      ? `${sourceName || "该来源"}属于公开零售商来源。`
      : "平台公开字段将该账号标记为店铺或商业卖家。";
    return { ...definition("professional_store"), reasons: [reason] };
  }

  if (itemCount >= 20) {
    return {
      ...definition("high_volume"),
      reasons: [`当前收录 ${itemCount} 件可采购商品，达到高频在售规模。`],
    };
  }

  const dominant = mostCommonToyType(input.visibleItems);
  if (itemCount >= 4 && dominant && dominant[1] / itemCount >= 0.7) {
    const [toyType, count] = dominant;
    return {
      ...definition("specialist"),
      reasons: [
        `当前 ${itemCount} 件商品中有 ${count} 件属于${toyTypeLabels[toyType] ?? toyType}，品类集中。`,
      ],
    };
  }

  if (itemCount >= 2) {
    return {
      ...definition("active_individual"),
      reasons: [`当前收录 ${itemCount} 件可采购商品，按多件活跃出品归类。`],
    };
  }

  return {
    ...definition("occasional"),
    reasons: [
      itemCount === 1
        ? "当前仅收录 1 件可采购商品，按单件零散出品归类。"
        : "当前没有可采购商品或公开资料尚未完善，暂按零散出品归类。",
    ],
  };
}

export function sellerSegmentStats(segments: readonly SellerSegment[]) {
  const counts = new Map<SellerSegmentKey, number>();
  for (const segment of segments)
    counts.set(segment.key, (counts.get(segment.key) ?? 0) + 1);
  return sellerSegmentDefinitions.map((entry) => ({
    ...entry,
    count: counts.get(entry.key) ?? 0,
  }));
}
