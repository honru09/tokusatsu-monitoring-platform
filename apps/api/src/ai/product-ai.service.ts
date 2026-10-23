import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  AiGatewayService,
  type AiGatewayRequest,
  type AiGatewayResult,
} from "./ai-gateway.service.js";
import type { AiCostPolicy, AiDataClass, AiTask } from "./ai-router.js";

export type ProductAiOperation =
  | "product_identification"
  | "image_analysis"
  | "price_judgement"
  | "procurement_filter"
  | "title_parsing"
  | "automatic_classification"
  | "translation";

export const PRODUCT_AI_OPERATIONS: readonly ProductAiOperation[] = [
  "product_identification",
  "image_analysis",
  "price_judgement",
  "procurement_filter",
  "title_parsing",
  "automatic_classification",
  "translation",
];

export type ProductAiInput<
  T extends Record<string, unknown> = Record<string, unknown>,
> = Omit<
  AiGatewayRequest<T>,
  "task" | "maxTokens" | "cacheTtlMs" | "dataClass" | "costPolicy"
> & {
  maxTokens?: number;
  cacheTtlMs?: number;
  dataClass?: AiDataClass;
  costPolicy?: AiCostPolicy;
  /** Set only by server code after every image URL was verified against storage. */
  publicImageUrlsVerified?: boolean;
};

type ProductAiDefaults = {
  task: AiTask;
  maxTokens: number;
  cacheTtlMs: number;
  dataClass: AiDataClass;
  costPolicy: AiCostPolicy;
};

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export const PRODUCT_AI_OPERATION_DEFAULTS = {
  product_identification: {
    task: "complex_analysis",
    maxTokens: 3_000,
    cacheTtlMs: 30 * DAY_MS,
    dataClass: "public_market",
    costPolicy: "free_first",
  },
  image_analysis: {
    task: "image_analysis",
    maxTokens: 5_000,
    cacheTtlMs: 30 * DAY_MS,
    dataClass: "sensitive_image",
    costPolicy: "free_first",
  },
  price_judgement: {
    task: "market_analysis",
    maxTokens: 1_200,
    cacheTtlMs: HOUR_MS,
    dataClass: "public_market",
    costPolicy: "free_first",
  },
  procurement_filter: {
    task: "bulk_filter",
    maxTokens: 1_600,
    cacheTtlMs: 7 * DAY_MS,
    dataClass: "public_market",
    costPolicy: "free_first",
  },
  title_parsing: {
    task: "classification",
    maxTokens: 2_000,
    cacheTtlMs: 30 * DAY_MS,
    dataClass: "public_market",
    costPolicy: "free_first",
  },
  automatic_classification: {
    task: "classification",
    maxTokens: 3_000,
    cacheTtlMs: 30 * DAY_MS,
    dataClass: "public_market",
    costPolicy: "free_first",
  },
  translation: {
    task: "translation",
    maxTokens: 3_000,
    cacheTtlMs: 30 * DAY_MS,
    dataClass: "public_market",
    costPolicy: "free_first",
  },
} as const satisfies Record<ProductAiOperation, ProductAiDefaults>;

@Injectable()
export class ProductAiService {
  constructor(private readonly gateway: AiGatewayService) {}

  execute<T extends Record<string, unknown>>(
    operation: ProductAiOperation,
    input: ProductAiInput<T>,
  ): Promise<AiGatewayResult<T>> {
    if (!["product_identification", "image_analysis", "title_parsing", "translation"].includes(operation))
      throw new ServiceUnavailableException("当前 AI 仅用于商品读取、翻译和聊天");
    const defaults = PRODUCT_AI_OPERATION_DEFAULTS[operation];
    const hasImages = Boolean(input.imageUrls?.length);
    const { publicImageUrlsVerified, ...gatewayInput } = input;
    const dataClass = hasImages
      ? publicImageUrlsVerified && input.dataClass === "public_market"
        ? "public_market"
        : "sensitive_image"
      : (input.dataClass ?? defaults.dataClass);

    return this.gateway.executeJson<T>({
      ...gatewayInput,
      task: defaults.task,
      purpose: operation === "translation" ? "translation" : "product_reading",
      maxTokens: input.maxTokens ?? defaults.maxTokens,
      cacheTtlMs: input.cacheTtlMs ?? defaults.cacheTtlMs,
      dataClass,
      costPolicy: "free_only",
    });
  }
}
