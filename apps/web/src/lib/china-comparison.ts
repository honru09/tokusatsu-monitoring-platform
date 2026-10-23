export type ChinaComparisonEvidence = {
  status?: string | null;
  source?: { key?: string | null; displayName?: string | null } | null;
  referencePriceCny?: number | null;
  referenceUrl?: string | null;
  observedAt?: string | null;
  expiresAt?: string | null;
  offers?: Array<{
    title: string;
    priceCny: number;
    condition?: string | null;
    imageUrl?: string | null;
    sourceUrl: string;
    isReference: boolean;
  }>;
};

const MAX_REFERENCE_PRICE_CNY = 1_000_000;
const MAX_COMPARISON_LIFETIME_MS = 30 * 86_400_000;
const MAX_OBSERVATION_CLOCK_SKEW_MS = 5 * 60_000;

function canonicalGoofishItemUrl(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    const validHostname =
      url.hostname === "goofish.com" || url.hostname.endsWith(".goofish.com");
    if (
      url.protocol !== "https:" ||
      !validHostname ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return null;
    const ids = url.searchParams.getAll("id");
    const id = ids[0]?.trim();
    if (
      ids.length !== 1 ||
      url.pathname !== "/item" ||
      !id ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(id)
    )
      return null;
    return `https://www.goofish.com/item?id=${encodeURIComponent(id)}`;
  } catch {
    return null;
  }
}

export function chinaComparisonSummary(item: {
  chinaComparison?: ChinaComparisonEvidence | null;
}) {
  const comparison = item.chinaComparison;
  const displayName = comparison?.source?.displayName?.trim() ?? "";
  const validSource =
    comparison?.source?.key === "xianyu" &&
    displayName === "闲鱼" &&
    displayName.length <= 80 &&
    !/[\u0000-\u001f\u007f]/u.test(displayName);
  const priceCny = comparison?.referencePriceCny;
  const sourceUrl = canonicalGoofishItemUrl(comparison?.referenceUrl);
  const observedAt = Date.parse(comparison?.observedAt ?? "");
  const expiresAt = Date.parse(comparison?.expiresAt ?? "");
  const now = Date.now();
  const validTime =
    Number.isFinite(observedAt) &&
    observedAt <= now + MAX_OBSERVATION_CLOCK_SKEW_MS &&
    Number.isFinite(expiresAt) &&
    expiresAt >= observedAt &&
    expiresAt - observedAt <= MAX_COMPARISON_LIFETIME_MS &&
    now <= expiresAt;
  const validEvidence =
    comparison?.status === "ready" &&
    validSource &&
    typeof priceCny === "number" &&
    Number.isFinite(priceCny) &&
    priceCny > 0 &&
    priceCny <= MAX_REFERENCE_PRICE_CNY &&
    validTime &&
    sourceUrl !== null;

  return {
    platformName: validSource ? displayName : "中国平台",
    priceCny: validEvidence ? priceCny : null,
    sourceUrl: validEvidence ? sourceUrl : null,
    offers:
      validEvidence && Array.isArray(comparison?.offers)
        ? comparison.offers.slice(0, 3)
        : [],
  };
}
