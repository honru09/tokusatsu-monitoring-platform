import type { Item, ResaleListing, ResaleSettings } from "@tokusatsu/db";

export const RESALE_STATUSES = [
  "draft",
  "ready",
  "queued",
  "publishing",
  "published",
  "paused",
  "blocked",
  "uncertain",
  "withdrawing",
  "withdrawn",
] as const;
export const busyStatuses = new Set(["publishing", "withdrawing", "uncertain"]);
export const terminalSourceStatuses = new Set(["sold", "ended", "reserved"]);

export function suggestedResalePrice(
  item: Pick<Item, "priceCurrent" | "shippingFee">,
  settings: Pick<
    ResaleSettings,
    "exchangeRate" | "extraCostCny" | "markupPercent"
  >,
) {
  return (
    Math.round(
      ((item.priceCurrent + (item.shippingFee ?? 0)) * settings.exchangeRate +
        settings.extraCostCny) *
        (1 + settings.markupPercent / 100) *
        100,
    ) / 100
  );
}
export function sourceBlockReason(
  item: Pick<
    Item,
    | "status"
    | "archivedAt"
    | "deletedAt"
    | "ignored"
    | "listingType"
    | "lastSeenAt"
    | "priceCurrent"
    | "shippingFee"
  >,
  listing: Pick<ResaleListing, "sourcePriceJpy" | "sourceShippingJpy">,
  freshMinutes: number,
  now = new Date(),
) {
  if (item.deletedAt) return "货源已被删除";
  if (item.archivedAt || item.ignored)
    return "货源已归档或忽略，请重新选择货源";
  if (terminalSourceStatuses.has(item.status))
    return "货源已售出、结束或被预订";
  if (item.status !== "active") return "货源状态未知，等待重新核查";
  if (item.listingType !== "direct") return "当前只支持已确认的直购商品";
  if (
    item.priceCurrent !== listing.sourcePriceJpy ||
    item.shippingFee !== listing.sourceShippingJpy
  )
    return "货源价格或邮费已变化，请编辑并重新审核";
  if (now.getTime() - item.lastSeenAt.getTime() > freshMinutes * 60_000)
    return "货源核查已过期，请重新核查";
  return null;
}
export function approvalBlockReason(
  listing: Pick<
    ResaleListing,
    | "title"
    | "description"
    | "priceCny"
    | "imageUrls"
    | "deliveryText"
    | "rightsConfirmed"
    | "fulfillmentConfirmed"
  >,
) {
  if (
    !listing.title.trim() ||
    listing.title.length > 60 ||
    !listing.description.trim() ||
    listing.description.length > 10000
  )
    return "请填写有效标题和完整描述";
  if (!Number.isFinite(listing.priceCny) || listing.priceCny <= 0)
    return "请填写有效售价";
  if (!listing.imageUrls.length || listing.imageUrls.length > 9)
    return "请选择1至9张商品图片";
  if (!listing.deliveryText.trim()) return "请填写实际交付方式和预计时间";
  if (!listing.rightsConfirmed) return "请确认商品信息和图片的使用权";
  if (!listing.fulfillmentConfirmed) return "请确认货源、费用和交付能力";
  return null;
}
export function validPublicUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export function validGoofishUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      [
        "goofish.com",
        "www.goofish.com",
        "m.goofish.com",
        "h5.m.goofish.com",
      ].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export function validGoofishItemUrl(targetItemId: string, value: string) {
  if (!validGoofishUrl(value)) return false;
  const url = new URL(value);
  return (
    (url.searchParams.get("id") ?? url.searchParams.get("itemId")) ===
    targetItemId
  );
}
export function chinaDayStart(now = new Date()) {
  const offset = 8 * 60 * 60_000;
  const shifted = new Date(now.getTime() + offset);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ) - offset,
  );
}
