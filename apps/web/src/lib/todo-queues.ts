/**
 * Todo home data access.
 *
 * The decision queues are derived from today's signals only: shared
 * rounds/messages nobody acted on, negotiation cases, finished link
 * analyses and successful negotiations without a purchase record,
 * inventory orders that sit unsold, and system resources. When the
 * first-class decision model lands, only the builders in this module
 * change - the home UI consumes the entry shapes below.
 */

export type TodoItemRef = {
  id: string;
  title: string;
  imageUrl: string | null;
  priceYen: number | null;
  sourceName: string | null;
};

export type TodoReviewEntry = {
  key: string;
  item: TodoItemRef;
  sharedByName: string | null;
  sharedAt: string;
};

export type TodoNegotiatingEntry = {
  key: string;
  item: TodoItemRef;
  statusChangedAt: string;
};

export type TodoRegisterEntry = {
  key: string;
  item: TodoItemRef;
  origin: "negotiation" | "analysis";
  at: string | null;
};

export type TodoInventoryEntry = {
  key: string;
  orderId: string;
  title: string;
  imageUrl: string | null;
  detail: string;
  purchasedAt: string | null;
};

export type TodoSystemEntry = {
  key: string;
  title: string;
  detail: string;
  target: "ai" | "monitoring";
};

export type TodoQueues = {
  review: TodoReviewEntry[];
  negotiating: TodoNegotiatingEntry[];
  register: TodoRegisterEntry[];
  inventory: TodoInventoryEntry[];
  system: TodoSystemEntry[];
};

export function todoPendingCount(queues: TodoQueues): number {
  return (
    queues.review.length +
    queues.negotiating.length +
    queues.register.length +
    queues.inventory.length +
    queues.system.length
  );
}

/** Structural minimum of a collaboration item (chat + catalog shapes). */
export type SharedItemLike = {
  id: string;
  titleRaw: string;
  titleZh?: string | null;
  priceCurrent?: number | null;
  source?: { key?: string; displayName?: string | null } | null;
  images?: readonly (string | { url: string })[] | null;
  product?: { titleZh?: string | null } | null;
  copiedAt?: string | null;
};

export type ShareRoundLike = {
  id: string;
  createdAt: string;
  createdBy?: { name?: string | null } | null;
  items: readonly {
    itemId: string;
    copiedAt?: string | null;
    item: SharedItemLike;
  }[];
};

export type ShareMessageLike = {
  id: string;
  senderId: string;
  createdAt: string;
  sender?: { name?: string | null } | null;
  item?: SharedItemLike | null;
  bundleItems?: readonly SharedItemLike[] | null;
};

export type NegotiationLike = {
  id: string;
  status: "in_progress" | "success" | "failed";
  statusChangedAt: string;
  item: SharedItemLike;
};

export type PurchaseAnalysisLike = {
  jobId: string;
  state?: string | null;
  createdAt?: string | null;
  item?: SharedItemLike | null;
};

export type InventoryOrderLike = {
  id: string;
  orderNumber: string;
  name: string | null;
  status: "in_stock" | "partially_sold" | "sold_out";
  remainingQuantity: number;
  purchasedAt: string | null;
  imageUrl: string | null;
};

export type AiResourcesLike = {
  remainingLocalBudget: number;
  dailyTokenLimit: number;
  expiresAt: string | null;
};

function itemRef(item: SharedItemLike): TodoItemRef {
  const firstImage = item.images?.[0];
  return {
    id: item.id,
    title:
      item.titleZh?.trim() ||
      item.product?.titleZh?.trim() ||
      item.titleRaw?.trim() ||
      "未命名商品",
    imageUrl:
      typeof firstImage === "string"
        ? firstImage
        : (firstImage?.url ?? null),
    priceYen:
      typeof item.priceCurrent === "number" ? item.priceCurrent : null,
    sourceName: item.source?.displayName?.trim() || null,
  };
}

function unactioned(
  item: SharedItemLike,
  purchasedItemIds: ReadonlySet<string>,
  dislikedItemIds: ReadonlySet<string>,
): boolean {
  return (
    !item.copiedAt &&
    !purchasedItemIds.has(item.id) &&
    !dislikedItemIds.has(item.id)
  );
}

/**
 * Shares awaiting the owner's decision: share-round rows and direct
 * item/bundle messages from the partner that were never copied into a
 * negotiation, never purchased and never marked not-interested.
 */
export function buildReviewQueue(
  rounds: readonly ShareRoundLike[],
  messages: readonly ShareMessageLike[],
  accountId: string,
  purchasedItemIds: ReadonlySet<string>,
  dislikedItemIds: ReadonlySet<string>,
): TodoReviewEntry[] {
  const byItemId = new Map<string, TodoReviewEntry>();
  const offer = (entry: TodoReviewEntry) => {
    const existing = byItemId.get(entry.item.id);
    if (!existing || entry.sharedAt < existing.sharedAt)
      byItemId.set(entry.item.id, entry);
  };
  for (const round of rounds) {
    for (const row of round.items) {
      if (row.copiedAt || !unactioned(row.item, purchasedItemIds, dislikedItemIds))
        continue;
      offer({
        key: `round-${round.id}-${row.itemId}`,
        item: itemRef(row.item),
        sharedByName: round.createdBy?.name?.trim() || null,
        sharedAt: round.createdAt,
      });
    }
  }
  for (const message of messages) {
    if (message.senderId === accountId) continue;
    const shared = [
      ...(message.item ? [message.item] : []),
      ...(message.bundleItems ?? []),
    ];
    for (const item of shared) {
      if (!unactioned(item, purchasedItemIds, dislikedItemIds)) continue;
      offer({
        key: `message-${message.id}-${item.id}`,
        item: itemRef(item),
        sharedByName: message.sender?.name?.trim() || null,
        sharedAt: message.createdAt,
      });
    }
  }
  return [...byItemId.values()].sort((a, b) =>
    a.sharedAt.localeCompare(b.sharedAt),
  );
}

/** Open negotiation cases, longest-waiting first. */
export function buildNegotiatingQueue(
  negotiations: readonly NegotiationLike[],
): TodoNegotiatingEntry[] {
  return negotiations
    .filter((entry) => entry.status === "in_progress")
    .map((entry) => ({
      key: `negotiation-${entry.id}`,
      item: itemRef(entry.item),
      statusChangedAt: entry.statusChangedAt,
    }))
    .sort((a, b) => a.statusChangedAt.localeCompare(b.statusChangedAt));
}

/**
 * Bought but not yet recorded: negotiations that succeeded and link
 * analyses that completed, whose item has no purchase record yet.
 */
export function buildRegisterQueue(
  negotiations: readonly NegotiationLike[],
  analyses: readonly PurchaseAnalysisLike[],
  purchasedItemIds: ReadonlySet<string>,
): TodoRegisterEntry[] {
  const entries: TodoRegisterEntry[] = [];
  const seen = new Set<string>();
  for (const entry of negotiations) {
    if (entry.status !== "success" || purchasedItemIds.has(entry.item.id))
      continue;
    seen.add(entry.item.id);
    entries.push({
      key: `register-negotiation-${entry.id}`,
      item: itemRef(entry.item),
      origin: "negotiation",
      at: entry.statusChangedAt,
    });
  }
  for (const analysis of analyses) {
    if (analysis.state !== "completed" || !analysis.item) continue;
    if (purchasedItemIds.has(analysis.item.id) || seen.has(analysis.item.id))
      continue;
    seen.add(analysis.item.id);
    entries.push({
      key: `register-analysis-${analysis.jobId}`,
      item: itemRef(analysis.item),
      origin: "analysis",
      at: analysis.createdAt ?? null,
    });
  }
  return entries;
}

/** Inventory orders that need attention: partially sold, or in stock 30+ days. */
export const INVENTORY_STALE_DAYS = 30;

export function buildInventoryQueue(
  orders: readonly InventoryOrderLike[],
  now: Date = new Date(),
): TodoInventoryEntry[] {
  const staleBefore = now.getTime() - INVENTORY_STALE_DAYS * 86_400_000;
  const entries: TodoInventoryEntry[] = [];
  for (const order of orders) {
    if (order.status === "sold_out") continue;
    const purchasedAtMs = order.purchasedAt
      ? new Date(order.purchasedAt).getTime()
      : Number.NaN;
    const stale =
      order.status === "in_stock" &&
      Number.isFinite(purchasedAtMs) &&
      purchasedAtMs < staleBefore;
    if (order.status !== "partially_sold" && !stale) continue;
    entries.push({
      key: `inventory-${order.id}`,
      orderId: order.id,
      title: order.name?.trim() || `订单 ${order.orderNumber}`,
      imageUrl: order.imageUrl,
      detail:
        order.status === "partially_sold"
          ? `部分售出 · 还剩 ${order.remainingQuantity} 件`
          : `入库超过 ${INVENTORY_STALE_DAYS} 天 · 还剩 ${order.remainingQuantity} 件`,
      purchasedAt: order.purchasedAt,
    });
  }
  return entries.sort((a, b) =>
    (a.purchasedAt ?? "").localeCompare(b.purchasedAt ?? ""),
  );
}

/** System notices: AI gift expiry/budget and monitoring failures. */
export const AI_EXPIRY_NOTICE_DAYS = 14;
export const AI_LOW_BUDGET_FRACTION = 0.1;

export function buildSystemQueue(input: {
  resources: AiResourcesLike | null;
  failedJobs24h: number;
  now?: Date;
}): TodoSystemEntry[] {
  const entries: TodoSystemEntry[] = [];
  const now = input.now ?? new Date();
  const resources = input.resources;
  if (resources?.expiresAt) {
    const daysLeft = Math.ceil(
      (new Date(resources.expiresAt).getTime() - now.getTime()) / 86_400_000,
    );
    if (daysLeft <= AI_EXPIRY_NOTICE_DAYS) {
      entries.push({
        key: "system-ai-expiry",
        title: "AI 赠送包即将到期",
        detail:
          daysLeft <= 0
            ? "赠送包已到期，后台翻译与分类会暂停"
            : `赠送包 ${daysLeft} 天后到期，到期后后台翻译与分类会暂停`,
        target: "ai",
      });
    }
  }
  if (
    resources &&
    resources.dailyTokenLimit > 0 &&
    resources.remainingLocalBudget <=
      resources.dailyTokenLimit * AI_LOW_BUDGET_FRACTION
  ) {
    entries.push({
      key: "system-ai-budget",
      title: "今日 AI 额度接近用完",
      detail: `今日剩余约 ${Math.max(0, resources.remainingLocalBudget).toLocaleString("zh-CN")} tokens`,
      target: "ai",
    });
  }
  if (input.failedJobs24h > 0) {
    entries.push({
      key: "system-monitoring-failures",
      title: "监控任务出现失败",
      detail: `过去 24 小时有 ${input.failedJobs24h} 个监控任务失败`,
      target: "monitoring",
    });
  }
  return entries;
}
