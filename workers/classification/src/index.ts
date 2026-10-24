import {
  normalizeHttpBaseUrl,
  type VisionClassification,
} from "@tokusatsu/shared";

const conservativeFallback: VisionClassification = {
  franchise: { value: null, confidence: 0, evidence: [] },
  series: { value: null, confidence: 0, evidence: [] },
  characters: { value: null, confidence: 0, evidence: [] },
  toyTypes: { value: null, confidence: 0, evidence: [] },
  manufacturers: { value: null, confidence: 0, evidence: [] },
  quantity: { value: null, confidence: 0, evidence: [] },
  sealedCount: { value: null, confidence: 0, evidence: [] },
  packaging: { value: null, confidence: 0, evidence: [] },
  condition: { value: null, confidence: 0, evidence: [] },
  visibleDamage: { value: null, confidence: 0, evidence: [] },
  missingParts: { value: null, confidence: 0, evidence: [] },
  backMarkings: { value: null, confidence: 0, evidence: [] },
  year: { value: null, confidence: 0, evidence: [] },
  modelNumber: { value: null, confidence: 0, evidence: [] },
  copyrightText: { value: null, confidence: 0, evidence: [] },
  confidence: 0,
};

function isEvidenceField(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const field = value as Record<string, unknown>;
  return (
    "value" in field &&
    typeof field.confidence === "number" &&
    Array.isArray(field.evidence)
  );
}

function isVisionClassification(value: unknown): value is VisionClassification {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    isEvidenceField(candidate.franchise) &&
    isEvidenceField(candidate.series) &&
    isEvidenceField(candidate.characters) &&
    isEvidenceField(candidate.toyTypes) &&
    isEvidenceField(candidate.manufacturers) &&
    isEvidenceField(candidate.quantity) &&
    isEvidenceField(candidate.sealedCount) &&
    isEvidenceField(candidate.packaging) &&
    isEvidenceField(candidate.condition) &&
    isEvidenceField(candidate.visibleDamage) &&
    isEvidenceField(candidate.missingParts) &&
    isEvidenceField(candidate.backMarkings) &&
    isEvidenceField(candidate.year) &&
    isEvidenceField(candidate.modelNumber) &&
    isEvidenceField(candidate.copyrightText) &&
    typeof candidate.confidence === "number"
  );
}

function normalizeProviderResult(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  const field = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object")
      return { value: null, confidence: 0, evidence: [] };
    const input = candidate as Record<string, unknown>;
    const confidence = Math.max(0, Math.min(1, Number(input.confidence ?? 0)));
    return {
      value: confidence < 0.7 ? null : (input.value ?? null),
      confidence,
      evidence: Array.isArray(input.evidence)
        ? input.evidence.map(String).filter(Boolean)
        : [],
    };
  };
  return {
    franchise: field(raw.franchise ?? raw.ip),
    series: field(raw.series),
    characters: field(raw.characters),
    toyTypes: field(raw.toyTypes ?? raw.toy_types),
    manufacturers: field(raw.manufacturers ?? raw.manufacturer_candidates),
    quantity: field(raw.quantity ?? raw.quantity_est),
    sealedCount: field(raw.sealedCount ?? raw.sealed_count),
    packaging: field(raw.packaging),
    condition: field(raw.condition ?? raw.condition_grade),
    visibleDamage: field(raw.visibleDamage ?? raw.visible_damage),
    missingParts: field(raw.missingParts ?? raw.missing_parts),
    backMarkings: field(raw.backMarkings ?? raw.back_markings),
    year: field(raw.year),
    modelNumber: field(raw.modelNumber ?? raw.model_number),
    copyrightText: field(raw.copyrightText ?? raw.copyright_text),
    confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0))),
  };
}

/**
 * The AI gateway reads at most two images per request. Selection follows
 * the API's own item reader (readItem): the first images in listing order,
 * cover first.
 */
export const MAX_IMAGE_ANALYSIS_URLS = 2;

export function selectImageAnalysisUrls(
  imageUrls: readonly string[],
): string[] {
  return imageUrls.slice(0, MAX_IMAGE_ANALYSIS_URLS);
}

export class ImageAnalysisError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryable?: boolean;

  constructor(
    status: number,
    detail: { code?: string; message?: string; retryable?: boolean } = {},
  ) {
    super(
      `AI Gateway vision returned ${status}${detail.message ? `: ${detail.message}` : ""}`,
    );
    this.name = "ImageAnalysisError";
    this.status = status;
    if (detail.code) this.code = detail.code;
    if (detail.retryable !== undefined) this.retryable = detail.retryable;
  }
}

/**
 * Gateway assertion failures (image-count limit, disabled scope) fail the
 * same way on every retry, so queue jobs must not retry them.
 */
export function isNonRetryableImageAnalysisError(error: unknown): boolean {
  return (
    error instanceof ImageAnalysisError &&
    (error.status === 400 || error.retryable === false)
  );
}

export async function classifyImages(input: {
  title: string;
  description?: string | null;
  imageUrls: string[];
  itemId?: string;
}): Promise<{ provider: string; result: VisionClassification }> {
  const apiBase = normalizeHttpBaseUrl(process.env.API_INTERNAL_URL);
  const imageUrls = selectImageAnalysisUrls(input.imageUrls);
  if (imageUrls.length === 0) {
    return { provider: "unconfigured", result: conservativeFallback };
  }
  const internalToken = process.env.AI_INTERNAL_TOKEN?.trim();
  if (!internalToken) throw new Error("AI Gateway 内部令牌未配置");

  const response = await fetch(
    `${apiBase}/ai/image-analysis${input.itemId ? `?itemId=${encodeURIComponent(input.itemId)}` : ""}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-internal-token": internalToken,
      },
      body: JSON.stringify({
        title: input.title,
        description: input.description,
        imageUrls,
      }),
      signal: AbortSignal.timeout(
        Math.max(
          250_000,
          Math.min(
            Number(process.env.AI_GATEWAY_CLIENT_TIMEOUT_MS ?? 270_000),
            300_000,
          ),
        ),
      ),
    },
  );
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      code?: unknown;
      message?: unknown;
      retryable?: unknown;
    } | null;
    throw new ImageAnalysisError(response.status, {
      code: typeof detail?.code === "string" ? detail.code : undefined,
      message:
        typeof detail?.message === "string" ? detail.message : undefined,
      retryable:
        typeof detail?.retryable === "boolean" ? detail.retryable : undefined,
    });
  }
  const payload = (await response.json()) as {
    data?: unknown;
    model?: unknown;
  };
  const result = normalizeProviderResult(payload.data);
  if (!isVisionClassification(result))
    throw new Error("AI Gateway vision returned an invalid schema");
  return {
    provider: typeof payload.model === "string" ? payload.model : "AI Gateway",
    result,
  };
}
