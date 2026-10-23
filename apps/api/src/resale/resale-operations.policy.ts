import { validGoofishUrl, validPublicUrl } from "./resale.policy.js";

const normalized = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase().trim();
export type MarketObservation = {
  targetItemId: string;
  title: string;
  priceCny: number;
  region: string;
  sourceUrl: string;
  imageUrl: string | null;
};
export function parseMarketObservation(
  value: unknown,
): MarketObservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const sourceUrl = row.sourceUrl ?? row.url ?? row.link;
  const title = row.title ?? row.titleRaw ?? row.name;
  if (
    typeof sourceUrl !== "string" ||
    !validGoofishUrl(sourceUrl) ||
    typeof title !== "string" ||
    !title.trim() ||
    title.length > 500
  )
    return null;
  const url = new URL(sourceUrl);
  const targetItemId =
    url.searchParams.get("id") ?? url.searchParams.get("itemId");
  if (!targetItemId || !/^[\w-]{1,120}$/.test(targetItemId)) return null;
  const declared =
    row.targetItemId ?? row.sourceListingId ?? row.itemId ?? row.id;
  if (declared != null && String(declared) !== targetItemId) return null;
  const raw = row.priceCny ?? row.price;
  const amount =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" &&
          /^\s*[¥￥]?\s*\d[\d,]*(?:\.\d{1,2})?\s*$/.test(raw)
        ? Number(raw.replace(/[¥￥,\s]/g, ""))
        : NaN;
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > 10000000 ||
    (row.currency && !/^(CNY|RMB)$/i.test(String(row.currency)))
  )
    return null;
  const image = row.imageUrl ?? row.image_url;
  return {
    targetItemId,
    title: title.trim(),
    priceCny: amount,
    region: String(row.region ?? row.area ?? row.locationText ?? "").slice(
      0,
      100,
    ),
    sourceUrl: `https://www.goofish.com/item?id=${encodeURIComponent(targetItemId)}`,
    imageUrl: typeof image === "string" && validPublicUrl(image) ? image : null,
  };
}
export function matchesMonitor(
  row: MarketObservation,
  monitor: {
    minPriceCny: number;
    maxPriceCny: number;
    requiredKeywords: string[];
    excludedKeywords: string[];
    regions: string[];
  },
) {
  const title = normalized(row.title);
  return (
    row.priceCny >= monitor.minPriceCny &&
    row.priceCny <= monitor.maxPriceCny &&
    monitor.requiredKeywords.every((word) =>
      title.includes(normalized(word)),
    ) &&
    !monitor.excludedKeywords.some((word) =>
      title.includes(normalized(word)),
    ) &&
    (!monitor.regions.length ||
      monitor.regions.some((region) =>
        normalized(row.region).includes(normalized(region)),
      ))
  );
}
export function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function metricDelta(previous: number | null, current: number | null) {
  return previous !== null && current !== null && current >= previous
    ? current - previous
    : null;
}
export function parseMetricObservation(value: unknown, targetItemId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const observedAt =
    typeof row.observedAt === "string" ? new Date(row.observedAt) : null;
  if (
    row.targetItemId !== targetItemId ||
    !observedAt ||
    !Number.isFinite(observedAt.getTime()) ||
    observedAt.getTime() > Date.now() + 300_000
  )
    return null;
  const keys = ["views", "wants", "orders", "revenueCny"] as const;
  const metrics = Object.fromEntries(
    keys.map((key) => [key, row[key] ?? null]),
  ) as Record<(typeof keys)[number], number | null>;
  if (Object.values(metrics).every((value) => value === null)) return null;
  if (
    keys.some(
      (key) =>
        metrics[key] !== null &&
        (typeof metrics[key] !== "number" ||
          !Number.isFinite(metrics[key]) ||
          metrics[key]! < 0 ||
          metrics[key]! > 1_000_000_000 ||
          (key !== "revenueCny" && !Number.isInteger(metrics[key]))),
    )
  )
    return null;
  return { observedAt, ...metrics };
}
