import type { VisionClassification } from "@tokusatsu/shared";

const conservativeFallback: VisionClassification = {
  ip: [],
  toyTypes: [],
  manufacturerCandidates: [],
  quantityEst: 0,
  sealedCountEst: 0,
  visibleDamage: [],
  conditionGrade: "unknown",
  confidence: 0,
};

function isVisionClassification(value: unknown): value is VisionClassification {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.ip) &&
    Array.isArray(candidate.toyTypes) &&
    Array.isArray(candidate.manufacturerCandidates) &&
    typeof candidate.quantityEst === "number" &&
    typeof candidate.sealedCountEst === "number" &&
    Array.isArray(candidate.visibleDamage) &&
    typeof candidate.conditionGrade === "string" &&
    typeof candidate.confidence === "number"
  );
}

function normalizeProviderResult(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  return {
    ip: raw.ip,
    toyTypes: raw.toyTypes ?? raw.toy_types,
    manufacturerCandidates:
      raw.manufacturerCandidates ?? raw.manufacturer_candidates,
    quantityEst: raw.quantityEst ?? raw.quantity_est,
    sealedCountEst: raw.sealedCountEst ?? raw.sealed_count_est,
    visibleDamage: raw.visibleDamage ?? raw.visible_damage,
    conditionGrade: raw.conditionGrade ?? raw.condition_grade,
    confidence: raw.confidence,
  };
}

export async function classifyImages(input: {
  title: string;
  description?: string | null;
  imageUrls: string[];
}): Promise<{ provider: string; result: VisionClassification }> {
  const endpoint = process.env.VISION_API_URL;
  const apiKey = process.env.VISION_API_KEY;
  if (!endpoint || !apiKey || input.imageUrls.length === 0) {
    return { provider: "unconfigured", result: conservativeFallback };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      task: "tokusatsu_item_classification",
      title: input.title,
      description: input.description,
      images: input.imageUrls,
      outputSchema: {
        ip: [],
        toy_types: [],
        manufacturer_candidates: [],
        quantity_est: 0,
        sealed_count_est: 0,
        visible_damage: [],
        condition_grade: "unknown",
        confidence: 0,
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok)
    throw new Error(`Vision provider returned ${response.status}`);
  const payload = (await response.json()) as
    | { result?: unknown }
    | VisionClassification;
  const result = normalizeProviderResult(
    "result" in payload ? payload.result : payload,
  );
  if (!isVisionClassification(result))
    throw new Error("Vision provider returned an invalid schema");
  return { provider: new URL(endpoint).host, result };
}
