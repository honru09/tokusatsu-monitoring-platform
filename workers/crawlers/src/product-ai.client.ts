import { normalizeHttpBaseUrl } from "@tokusatsu/shared";
import { createHash } from "node:crypto";
import {
  AutomaticAiDeferredError,
  automaticBackgroundAiEnabled,
  automaticPaidAiEnabled,
  backgroundAiFetch,
} from "./background-ai-guard.js";

export type ProductAiOperation =
  | "product_identification"
  | "image_analysis"
  | "price_judgement"
  | "procurement_filter"
  | "title_parsing"
  | "automatic_classification"
  | "translation";

export const PRODUCT_AI_RESPONSE_SCHEMAS = {
  chinaSearchKeywords: {
    responseSchemaId: "internal.china-search-keywords",
    responseSchemaVersion: 1,
  },
  chinaCandidateDecisions: {
    responseSchemaId: "internal.china-candidate-decisions",
    responseSchemaVersion: 1,
  },
  procurementReview: {
    responseSchemaId: "internal.procurement-review",
    responseSchemaVersion: 1,
  },
  automaticClassification: {
    responseSchemaId: "internal.automatic-classification",
    responseSchemaVersion: 1,
  },
  advancedClassification: {
    responseSchemaId: "internal.advanced-classification",
    responseSchemaVersion: 1,
  },
} as const;

export type ProductAiResponseSchemaReference =
  (typeof PRODUCT_AI_RESPONSE_SCHEMAS)[keyof typeof PRODUCT_AI_RESPONSE_SCHEMAS];

export type ProductAiEnvelope<T extends Record<string, unknown>> = {
  data: T;
  provider: string;
  model: string;
  cached?: boolean;
  fallbackUsed?: boolean;
};

type ProductAiRequest = {
  operation: ProductAiOperation;
  responseSchemaId: ProductAiResponseSchemaReference["responseSchemaId"];
  responseSchemaVersion: ProductAiResponseSchemaReference["responseSchemaVersion"];
  expectedIds?: string[];
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  maxTokens?: number;
  temperature?: number;
  imageUrls?: string[];
  itemId?: string;
  dataClass?: "public_market" | "user_private" | "sensitive_image";
  costPolicy?: "free_only" | "free_first" | "paid_allowed";
  bypassCache?: boolean;
};

function clientTimeout() {
  const configured = Number(
    process.env.AI_GATEWAY_CLIENT_TIMEOUT_MS ?? 270_000,
  );
  return Math.max(
    250_000,
    Math.min(Number.isFinite(configured) ? configured : 270_000, 300_000),
  );
}

function apiBaseUrl() {
  return normalizeHttpBaseUrl(process.env.API_INTERNAL_URL);
}

export async function executeProductAi<T extends Record<string, unknown>>(
  request: ProductAiRequest,
  options: {
    softHttpFailure?: boolean;
    authorization?: "paid" | "free";
  } = {},
): Promise<ProductAiEnvelope<T> | null> {
  // This client is worker-only: every caller is scheduled/background work.
  // Check authorization before credentials or request construction so a
  // disabled deployment cannot reach the internal AI endpoint. Callers
  // default to the paid class; only free-tier work (translation, image
  // classification) may opt into the free class explicitly.
  const authorized =
    options.authorization === "free"
      ? automaticBackgroundAiEnabled()
      : automaticPaidAiEnabled();
  if (!authorized) return null;
  const token = process.env.AI_INTERNAL_TOKEN?.trim();
  if (!token) return null;
  const apiBase = apiBaseUrl();
  const body = JSON.stringify({
    ...request,
    dataClass: request.dataClass ?? "public_market",
    costPolicy: request.costPolicy ?? "free_first",
  });
  const identity =
    request.itemId ??
    createHash("sha256").update(body).digest("hex").slice(0, 20);
  let response: Response;
  try {
    response = await backgroundAiFetch(
      `product:${request.responseSchemaId}:${identity}`,
      `${apiBase}/ai/internal/product/execute`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          "x-ai-internal-token": token,
        },
        body,
        signal: AbortSignal.timeout(clientTimeout()),
      },
      { authorization: options.authorization },
    );
  } catch (error) {
    if (error instanceof AutomaticAiDeferredError) {
      if (options.softHttpFailure) return null;
      throw new Error(
        `Product AI request failed (${error.status ?? "temporarily unavailable"})`,
      );
    }
    throw error;
  }
  if (!response.ok) {
    if (options.softHttpFailure) return null;
    throw new Error(`Product AI request failed (${response.status})`);
  }
  return (await response.json()) as ProductAiEnvelope<T>;
}
