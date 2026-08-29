import { normalizeCatalogText } from "@tokusatsu/product-dictionary";

export interface MatchableProduct {
  normalizedName: string;
  franchiseKey?: string | null;
  seriesKey?: string | null;
  manufacturerKey?: string | null;
  toyTypeKey?: string | null;
  productLine?: string | null;
}

export interface ProductMatchScore {
  score: number;
  decision: "auto_match" | "review" | "create_new";
  factors: {
    name: number;
    token: number;
    franchise: number;
    series: number;
    manufacturer: number;
    toyType: number;
  };
  evidence: string[];
}

export function normalizeProductName(value: string): string {
  return normalizeCatalogText(value)
    .replace(/\b(?:used|中古|美品|未開封|新品|即決|送料無料)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ngrams(value: string, size: number) {
  const padded = `  ${value}  `;
  const result = new Set<string>();
  for (let index = 0; index <= padded.length - size; index += 1)
    result.add(padded.slice(index, index + size));
  return result;
}

export function trigramCosine(left: string, right: string): number {
  const a = normalizeProductName(left);
  const b = normalizeProductName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = ngrams(a, 3);
  const tb = ngrams(b, 3);
  let intersection = 0;
  for (const token of ta) if (tb.has(token)) intersection += 1;
  return intersection / Math.sqrt(ta.size * tb.size);
}

function tokens(value: string): Set<string> {
  const normalized = normalizeProductName(value);
  const result = new Set(
    normalized
      .split(/[\s-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  );
  for (const chunk of normalized.match(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{3,}/gu,
  ) ?? []) {
    for (let index = 0; index < chunk.length - 1; index += 1)
      result.add(chunk.slice(index, index + 2));
  }
  return result;
}

export function weightedTokenSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const union = new Set([...a, ...b]);
  let intersectionWeight = 0;
  let unionWeight = 0;
  for (const token of union) {
    const weight = token.length >= 5 ? 2 : token.length >= 3 ? 1.5 : 1;
    unionWeight += weight;
    if (a.has(token) && b.has(token)) intersectionWeight += weight;
  }
  return intersectionWeight / unionWeight;
}

function equality(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  if (!left || !right) return 0.5;
  return left === right ? 1 : 0;
}

export function hasSalientOverlap(
  query: MatchableProduct,
  candidate: MatchableProduct,
): boolean {
  if (query.seriesKey && candidate.seriesKey)
    return query.seriesKey === candidate.seriesKey;
  const queryTokens = tokens(query.normalizedName);
  const candidateTokens = tokens(candidate.normalizedName);
  return [...queryTokens].some(
    (token) => token.length >= 3 && candidateTokens.has(token),
  );
}

export function scoreProductMatch(
  query: MatchableProduct,
  candidate: MatchableProduct,
): ProductMatchScore {
  const factors = {
    name: trigramCosine(query.normalizedName, candidate.normalizedName),
    token: weightedTokenSimilarity(
      query.normalizedName,
      candidate.normalizedName,
    ),
    franchise: equality(query.franchiseKey, candidate.franchiseKey),
    series: equality(query.seriesKey, candidate.seriesKey),
    manufacturer: equality(query.manufacturerKey, candidate.manufacturerKey),
    toyType: equality(query.toyTypeKey, candidate.toyTypeKey),
  };
  let score =
    factors.name * 0.48 +
    factors.token * 0.2 +
    factors.franchise * 0.07 +
    factors.series * 0.13 +
    factors.manufacturer * 0.05 +
    factors.toyType * 0.07;
  const evidence: string[] = [];
  if (query.seriesKey && candidate.seriesKey) {
    if (query.seriesKey === candidate.seriesKey) evidence.push("作品系列一致");
    else {
      score *= 0.45;
      evidence.push("作品系列冲突");
    }
  }
  if (
    query.toyTypeKey &&
    candidate.toyTypeKey &&
    query.toyTypeKey !== candidate.toyTypeKey
  ) {
    score *= 0.72;
    evidence.push("玩具类型冲突");
  }
  if (factors.name >= 0.9) evidence.push("标准化标题高度相似");
  if (factors.token >= 0.75) evidence.push("关键规格词重合");
  score = Math.max(0, Math.min(1, score));
  return {
    score,
    decision:
      score >= 0.95 ? "auto_match" : score >= 0.7 ? "review" : "create_new",
    factors,
    evidence,
  };
}
