import {
  EmptyResponseBodyError,
  InvalidArgumentError,
  InvalidResponseDataError,
  JSONParseError,
  NoOutputGeneratedError,
  NoSuchModelError,
  UnsupportedFunctionalityError,
  UnsupportedModelVersionError,
} from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma.service.js";
import {
  AiGatewayService,
  httpRetryDelayMs,
  modelTimeoutForTask,
  providerRequestSpacingMs,
} from "./ai-gateway.service.js";
import { modelStateKey } from "./ai-router.js";
import {
  AiSdkHttpError,
  type AiSdkModelClient,
} from "./ai-sdk-model.client.js";
import { recordResponseSchema } from "./ai-response-schema.js";

const TEST_RESPONSE_SCHEMA = recordResponseSchema(
  "record.assistant_chat",
  1,
  (value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? {
          success: true as const,
          value: value as Record<string, unknown>,
        }
      : {
          success: false as const,
          issues: [{ path: "$", code: "type" }],
        },
);

function canonicalAnswerSchema(id: string, version: number) {
  return recordResponseSchema(id, version, (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return {
        success: false as const,
        issues: [{ path: "$", code: "type" }],
      };
    const record = value as Record<string, unknown>;
    if (typeof record.answerZh !== "string" || !record.answerZh.trim())
      return {
        success: false as const,
        issues: [{ path: "answerZh", code: "required" }],
      };
    if (
      typeof record.confidence !== "number" ||
      !Number.isFinite(record.confidence) ||
      record.confidence < 0 ||
      record.confidence > 1
    )
      return {
        success: false as const,
        issues: [{ path: "confidence", code: "range" }],
      };
    return {
      success: true as const,
      value: {
        answerZh: record.answerZh.trim(),
        confidence: record.confidence,
      },
    };
  });
}

function prismaMock() {
  let runNumber = 0;
  return {
    aiCache: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    aiRun: {
      create: vi.fn().mockImplementation(async () => ({
        id: `run-${++runNumber}`,
      })),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { providerUsage: 0 } }),
    },
    aiModelState: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({}),
    },
    aiProviderState: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

const providerCases = [
  {
    provider: "bai",
    key: "BAI_API_KEY",
    urlKey: "BAI_API_URL",
    customEndpointAuthorizationKey: "BAI_CUSTOM_ENDPOINT_AUTHORIZED",
    evaluationAuthorizationKey: "BAI_INTERNAL_EVALUATION",
    url: "https://bai.test/v1",
    model: "glm-5.3-flash",
  },
  {
    provider: "openrouter",
    key: "OPENROUTER_API_KEY",
    urlKey: "OPENROUTER_API_URL",
    customEndpointAuthorizationKey: "OPENROUTER_CUSTOM_ENDPOINT_AUTHORIZED",
    url: "https://openrouter.test/api/v1",
    model: "z-ai/glm-5.2:free",
  },
  {
    provider: "gemini",
    key: "GEMINI_API_KEY",
    urlKey: "GEMINI_API_URL",
    customEndpointAuthorizationKey: "GEMINI_CUSTOM_ENDPOINT_AUTHORIZED",
    url: "https://gemini.test/v1beta/openai",
    model: "gemini-3.1-flash-lite",
    tierKey: "GEMINI_API_TIER",
  },
  {
    provider: "groq",
    key: "GROQ_API_KEY",
    urlKey: "GROQ_API_URL",
    customEndpointAuthorizationKey: "GROQ_CUSTOM_ENDPOINT_AUTHORIZED",
    url: "https://groq.test/openai/v1",
    model: "openai/gpt-oss-20b",
    tierKey: "GROQ_API_TIER",
  },
  {
    provider: "siliconflow",
    key: "SILICONFLOW_API_KEY",
    urlKey: "SILICONFLOW_API_URL",
    customEndpointAuthorizationKey: "SILICONFLOW_CUSTOM_ENDPOINT_AUTHORIZED",
    evaluationAuthorizationKey: "SILICONFLOW_INTERNAL_EVALUATION",
    url: "https://silicon.test/v1",
    model: "Qwen/Qwen2.5-7B-Instruct",
  },
  {
    provider: "nvidia",
    key: "NVIDIA_API_KEY",
    urlKey: "NVIDIA_API_URL",
    customEndpointAuthorizationKey: "NVIDIA_CUSTOM_ENDPOINT_AUTHORIZED",
    evaluationAuthorizationKey: "NVIDIA_INTERNAL_EVALUATION",
    url: "https://nvidia.test/v1",
    model: "nvidia/nemotron-3-nano-30b-a3b",
  },
  {
    provider: "cerebras",
    key: "CEREBRAS_API_KEY",
    urlKey: "CEREBRAS_API_URL",
    customEndpointAuthorizationKey: "CEREBRAS_CUSTOM_ENDPOINT_AUTHORIZED",
    url: "https://cerebras.test/v1",
    model: "gpt-oss-120b",
    tierKey: "CEREBRAS_API_TIER",
  },
  {
    provider: "cloudflare",
    key: "CLOUDFLARE_AI_API_TOKEN",
    urlKey: "CLOUDFLARE_AI_API_URL",
    customEndpointAuthorizationKey: "CLOUDFLARE_AI_CUSTOM_ENDPOINT_AUTHORIZED",
    url: "https://cloudflare.test/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1",
    model: "@cf/zai-org/glm-4.7-flash",
    tierKey: "CLOUDFLARE_AI_API_TIER",
  },
  {
    provider: "cohere",
    key: "COHERE_API_KEY",
    urlKey: "COHERE_API_URL",
    customEndpointAuthorizationKey: "COHERE_CUSTOM_ENDPOINT_AUTHORIZED",
    evaluationAuthorizationKey: "COHERE_INTERNAL_EVALUATION",
    url: "https://cohere.test/compatibility/v1",
    model: "command-a-plus-05-2026",
    tierKey: "COHERE_API_TIER",
  },
  {
    provider: "sensenova",
    key: "SENSENOVA_API_KEY",
    urlKey: "SENSENOVA_API_URL",
    customEndpointAuthorizationKey: "SENSENOVA_CUSTOM_ENDPOINT_AUTHORIZED",
    evaluationAuthorizationKey: "SENSENOVA_INTERNAL_EVALUATION",
    url: "https://sensenova.test/v1",
    model: "sensenova-6.8-flash-lite",
    tierKey: "SENSENOVA_API_TIER",
  },
] as const;

const originalEnvironment = { ...process.env };

function clearProviderEnvironment() {
  for (const name of [
    "LITELLM_API_KEY",
    "LITELLM_API_URL",
    "LITELLM_API_TIER",
    "LITELLM_FREE_MODELS",
    "LITELLM_PROMOTION_MODELS",
    "LITELLM_PAID_MODELS",
    "LITELLM_PRIVATE_DATA_AUTHORIZED",
    "LITELLM_CUSTOM_ENDPOINT_AUTHORIZED",
    "AI_ALLOW_CUSTOM_PROVIDER_ENDPOINTS",
    "BAI_API_KEY",
    "BAI_API_URL",
    "BAI_API_TIER",
    "BAI_FREE_MODELS",
    "BAI_PROMOTION_MODELS",
    "BAI_PAID_MODELS",
    "BAI_PRICING_VERIFIED_AT",
    "BAI_INTERNAL_EVALUATION",
    "BAI_PRODUCTION_AUTHORIZED",
    "BAI_PRIVATE_DATA_AUTHORIZED",
    "OPENROUTER_API_KEY",
    "OPENROUTER_API_URL",
    "OPENROUTER_API_TIER",
    "OPENROUTER_FREE_MODELS",
    "OPENROUTER_PROMOTION_MODELS",
    "OPENROUTER_PAID_MODELS",
    "OPENROUTER_PRICING_VERIFIED_AT",
    "GEMINI_API_KEY",
    "GEMINI_API_URL",
    "GEMINI_API_TIER",
    "GEMINI_MODEL",
    "GEMINI_FREE_MODELS",
    "GEMINI_PROMOTION_MODELS",
    "GEMINI_PAID_MODELS",
    "GEMINI_PRICING_VERIFIED_AT",
    "GROQ_API_KEY",
    "GROQ_API_URL",
    "GROQ_API_TIER",
    "GROQ_FREE_MODELS",
    "GROQ_PROMOTION_MODELS",
    "GROQ_PAID_MODELS",
    "GROQ_PRICING_VERIFIED_AT",
    "SILICONFLOW_API_KEY",
    "SILICONFLOW_API_URL",
    "SILICONFLOW_API_TIER",
    "SILICONFLOW_FREE_MODELS",
    "SILICONFLOW_PROMOTION_MODELS",
    "SILICONFLOW_PAID_MODELS",
    "SILICONFLOW_PRICING_VERIFIED_AT",
    "SILICONFLOW_INTERNAL_EVALUATION",
    "SILICONFLOW_PRODUCTION_AUTHORIZED",
    "SILICONFLOW_PRIVATE_DATA_AUTHORIZED",
    "CEREBRAS_API_KEY",
    "CEREBRAS_API_URL",
    "CEREBRAS_API_TIER",
    "CEREBRAS_FREE_MODELS",
    "CEREBRAS_PROMOTION_MODELS",
    "CEREBRAS_PAID_MODELS",
    "CEREBRAS_PRICING_VERIFIED_AT",
    "CLOUDFLARE_AI_API_TOKEN",
    "CLOUDFLARE_AI_API_URL",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_AI_API_TIER",
    "CLOUDFLARE_AI_FREE_MODELS",
    "CLOUDFLARE_AI_PROMOTION_MODELS",
    "CLOUDFLARE_AI_PAID_MODELS",
    "CLOUDFLARE_AI_PRICING_VERIFIED_AT",
    "COHERE_API_KEY",
    "COHERE_API_URL",
    "COHERE_API_TIER",
    "COHERE_FREE_MODELS",
    "COHERE_PROMOTION_MODELS",
    "COHERE_PAID_MODELS",
    "COHERE_PRICING_VERIFIED_AT",
    "COHERE_PRIVATE_DATA_AUTHORIZED",
    "NVIDIA_API_KEY",
    "NVIDIA_API_URL",
    "NVIDIA_API_TIER",
    "NVIDIA_FREE_MODELS",
    "NVIDIA_PROMOTION_MODELS",
    "NVIDIA_PAID_MODELS",
    "NVIDIA_PRICING_VERIFIED_AT",
    "NVIDIA_PRODUCTION_AUTHORIZED",
    "NVIDIA_PRIVATE_DATA_AUTHORIZED",
    "SENSENOVA_API_KEY",
    "SENSENOVA_API_URL",
    "SENSENOVA_API_TIER",
    "SENSENOVA_FREE_MODELS",
    "SENSENOVA_PROMOTION_MODELS",
    "SENSENOVA_PAID_MODELS",
    "SENSENOVA_PRICING_VERIFIED_AT",
    "SENSENOVA_TRANSLATION_API_KEY",
    "SENSENOVA_SECONDARY_API_KEY",
    "SENSENOVA_INTERNAL_EVALUATION",
    "SENSENOVA_PRODUCTION_AUTHORIZED",
    "SENSENOVA_PRIVATE_DATA_AUTHORIZED",
    "OVO_API_KEY",
    "OVO_API_URL",
    "OVO_API_TIER",
    "OVO_INTERNAL_EVALUATION",
    "OVO_PRODUCTION_AUTHORIZED",
    "OVO_PRIVATE_DATA_AUTHORIZED",
    "AI_ALLOW_CONFIGURED_CATALOGUE_FALLBACK",
    "AI_GEMINI_CATALOGUE_FALLBACK_MODELS",
    "AI_OVO_CATALOGUE_FALLBACK_MODELS",
    "AI_PROVIDER_MAX_CONCURRENCY_OVO",
    "AI_PROVIDER_MAX_CONCURRENCY_GEMINI",
    "AI_PROVIDER_RPM_GEMINI",
    "NVIDIA_INTERNAL_EVALUATION",
    "COHERE_INTERNAL_EVALUATION",
    "COHERE_PRODUCTION_AUTHORIZED",
    "AI_PROVIDER_ORDER",
    "AI_PROVIDER_ORDER_ASSISTANT_CHAT",
    "AI_ROUTE_GROQ_ASSISTANT_CHAT",
    "AI_ROUTE_SENSENOVA_TRANSLATION",
    "AI_ALLOW_PAID_MODELS",
    "AI_PAID_PROVIDER_ALLOWLIST",
    "AI_COST_POLICY",
    ...providerCases.map((provider) => provider.customEndpointAuthorizationKey),
  ])
    delete process.env[name];
}

function configure(
  provider: (typeof providerCases)[number],
  tier: "free" | "paid" | "unknown" = "unknown",
) {
  process.env[provider.key] = `test-${provider.provider}-key`;
  process.env[provider.urlKey] = provider.url;
  process.env[provider.customEndpointAuthorizationKey] = "true";
  if ("evaluationAuthorizationKey" in provider)
    process.env[provider.evaluationAuthorizationKey] = "true";
  if (provider.provider === "cloudflare")
    process.env.CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
  if (provider.provider === "cohere")
    process.env.COHERE_INTERNAL_EVALUATION = "true";
  const prefix =
    provider.provider === "cloudflare"
      ? "CLOUDFLARE_AI"
      : provider.provider.toUpperCase();
  const tierEnv =
    "tierKey" in provider && provider.tierKey
      ? provider.tierKey
      : `${prefix}_API_TIER`;
  process.env[tierEnv] = tier;
  if (
    tier === "free" ||
    (provider.provider === "openrouter" && provider.model.endsWith(":free"))
  ) {
    process.env[`${prefix}_FREE_MODELS`] = provider.model;
    process.env[`${prefix}_PRICING_VERIFIED_AT`] = new Date().toISOString();
  }
}

function success(model: string, answer = "可用") {
  return Response.json({
    model,
    choices: [{ message: { content: JSON.stringify({ answerZh: answer }) } }],
    usage: { prompt_tokens: 4, completion_tokens: 2 },
  });
}

function service(prisma = prismaMock()) {
  return {
    prisma,
    gateway: new AiGatewayService(prisma as unknown as PrismaService),
  };
}

function request(
  message: string,
  overrides: Partial<Parameters<AiGatewayService["executeJson"]>[0]> = {},
) {
  return {
    task: "assistant_chat" as const,
    messages: [{ role: "user" as const, content: message }],
    maxTokens: 100,
    responseSchema: TEST_RESPONSE_SCHEMA,
    bypassCache: true,
    dataClass: "public_market" as const,
    costPolicy: "paid_allowed" as const,
    ...overrides,
  };
}

describe("AiGatewayService multi-provider pool", () => {
  beforeEach(() => {
    clearProviderEnvironment();
    process.env.NODE_ENV = "test";
    process.env.AI_HTTP_RETRIES = "1";
    process.env.AI_MODEL_TIMEOUT_MS = "30000";
    process.env.AI_GATEWAY_DEADLINE_MS = "240000";
    process.env.AI_CATALOG_TIMEOUT_MS = "5000";
    process.env.AI_ALLOW_PAID_MODELS = "true";
    process.env.AI_COST_POLICY = "paid_allowed";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnvironment)) delete process.env[key];
    }
    Object.assign(process.env, originalEnvironment);
  });

  it("recovers AI runs orphaned by an API restart after the gateway deadline", async () => {
    const prisma = prismaMock();
    prisma.aiRun.updateMany.mockResolvedValue({ count: 64 });
    const gateway = new AiGatewayService(prisma as unknown as PrismaService);
    const now = new Date("2026-08-31T05:00:00.000Z");

    await expect(gateway.reconcileInterruptedRuns(now)).resolves.toEqual({
      count: 64,
    });
    expect(prisma.aiRun.updateMany).toHaveBeenCalledWith({
      where: {
        status: "running",
        startedAt: { lt: new Date("2026-08-31T04:55:00.000Z") },
      },
      data: {
        status: "failed",
        errorCode: "PROCESS_INTERRUPTED",
        errorMessage: "API 进程中断，已在启动时自动回收",
        completedAt: now,
      },
    });
  });

  it.each([
    ["HTTP", "http://images.example.test/item.jpg"],
    ["URL credentials", "https://user:password@images.example.test/item.jpg"],
    ["localhost", "https://localhost/item.jpg"],
    ["IPv4 loopback", "https://127.0.0.1/item.jpg"],
    ["IPv4 link-local", "https://169.254.169.254/latest/meta-data"],
    ["IPv4 private", "https://192.168.1.1/item.jpg"],
    ["IPv6 loopback", "https://[::1]/item.jpg"],
    ["IPv6 link-local", "https://[fe80::1]/item.jpg"],
    ["IPv6 private", "https://[fd00::1]/item.jpg"],
    ["data URI", "data:image/png;base64,AA=="],
  ])("rejects %s image URLs before provider discovery", async (_case, url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { gateway, prisma } = service();

    const error = await gateway
      .executeJson(
        request("unsafe image", {
          task: "image_analysis",
          imageUrls: [url],
        }),
      )
      .catch((value: unknown) => value);

    expect(error).toMatchObject({ status: 400 });
    expect(
      (error as { getResponse(): { code: string } }).getResponse().code,
    ).toBe("AI_IMAGE_URL_INVALID");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.aiRun.create).not.toHaveBeenCalled();
  });

  it("skips Cerebras Gemma for URL images because it only accepts image data URIs", async () => {
    const cerebras = providerCases[6];
    configure(cerebras, "free");
    process.env.CEREBRAS_FREE_MODELS = "gemma-4-31b";
    process.env.AI_PROVIDER_ORDER = "cerebras";
    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: "gemma-4-31b" }] });
        chatCalls += 1;
        return success("gemma-4-31b");
      }),
    );
    const { gateway } = service();

    const error = await gateway
      .executeJson(
        request("Cerebras URL image", {
          task: "image_analysis",
          costPolicy: "free_only",
          imageUrls: ["https://images.example.test/item.jpg"],
        }),
      )
      .catch((value: unknown) => value);

    expect(
      (error as { getResponse(): { code: string } }).getResponse().code,
    ).toBe("AI_GATEWAY_NO_FREE_MODEL");
    expect(chatCalls).toBe(0);
  });

  it("falls through from URL-incompatible Cerebras Gemma to another vision model", async () => {
    const cerebras = providerCases[6];
    const cloudflare = providerCases[7];
    const cloudflareVision = "@cf/meta/llama-3.2-11b-vision-instruct";
    configure(cerebras, "free");
    configure(cloudflare, "free");
    process.env.CEREBRAS_FREE_MODELS = "gemma-4-31b";
    process.env.CLOUDFLARE_AI_FREE_MODELS = cloudflareVision;
    process.env.AI_PROVIDER_ORDER = "cerebras|cloudflare";
    let cerebrasChatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.startsWith(cerebras.url) && url.endsWith("/models"))
          return Response.json({ data: [{ id: "gemma-4-31b" }] });
        if (url.includes("/models/search"))
          return Response.json({ result: [{ name: cloudflareVision }] });
        if (url.startsWith(cerebras.url)) cerebrasChatCalls += 1;
        return success(cloudflareVision);
      }),
    );
    const { gateway } = service();

    const result = await gateway.executeJson(
      request("Cerebras URL image fallback", {
        task: "image_analysis",
        costPolicy: "free_only",
        imageUrls: ["https://images.example.test/item.jpg"],
      }),
    );

    expect(result.provider).toBe("cloudflare");
    expect(result.model).toBe(cloudflareVision);
    expect(cerebrasChatCalls).toBe(0);
  });

  it.each(providerCases)(
    "works when only $provider is configured",
    async (provider) => {
      configure(provider, "free");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          expect(init?.redirect).toBe("error");
          const url = String(input);
          if (url.includes("/models")) {
            if (provider.provider === "cloudflare")
              return Response.json({ result: [{ name: provider.model }] });
            if (provider.provider === "cohere")
              return Response.json({ models: [{ name: provider.model }] });
            return Response.json({
              data: [
                {
                  id:
                    provider.provider === "gemini"
                      ? `models/${provider.model}`
                      : provider.model,
                },
              ],
            });
          }
          return success(provider.model);
        }),
      );
      const { gateway } = service();

      const result = await gateway.executeJson(request(provider.provider));

      expect(result.provider).toBe(provider.provider);
      expect(result.model).toBe(provider.model);
    },
  );

  it("rejects a schema-invalid model response and falls back without caching it", async () => {
    const bai = providerCases[0];
    const gemini = providerCases[2];
    configure(bai, "free");
    configure(gemini, "free");
    process.env.AI_PROVIDER_ORDER = "bai|gemini";
    const schema = canonicalAnswerSchema("assistant.answer-test", 1);
    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.startsWith(bai.url) && url.endsWith("/models"))
          return Response.json({ data: [{ id: bai.model }] });
        if (url.startsWith(gemini.url) && url.endsWith("/models"))
          return Response.json({ data: [{ id: `models/${gemini.model}` }] });
        chatCalls += 1;
        return Response.json({
          model: chatCalls === 1 ? bai.model : gemini.model,
          choices: [
            {
              message: {
                content: JSON.stringify(
                  chatCalls === 1
                    ? { answerZh: "missing confidence" }
                    : {
                        answerZh: "  fallback accepted  ",
                        confidence: 0.6,
                        ignored: "strip me",
                      },
                ),
              },
            },
          ],
        });
      }),
    );
    const { gateway, prisma } = service();

    const result = await gateway.executeJson(
      request("schema fallback", {
        responseSchema: schema,
        costPolicy: "paid_allowed",
        bypassCache: false,
      }),
    );

    expect(chatCalls).toBe(2);
    expect(result).toMatchObject({
      data: { answerZh: "fallback accepted", confidence: 0.6 },
      fallbackUsed: true,
      cached: false,
    });
    expect(prisma.aiRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          errorCode: "OUTPUT_SCHEMA_INVALID",
        }),
      }),
    );
    expect(prisma.aiCache.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.aiCache.upsert.mock.calls[0]?.[0].create.output).toEqual({
      answerZh: "fallback accepted",
      confidence: 0.6,
    });
  });

  it("reports OUTPUT_SCHEMA_INVALID when every called model violates the contract", async () => {
    const bai = providerCases[0];
    configure(bai, "free");
    process.env.AI_PROVIDER_ORDER = "bai";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/models")
          ? Response.json({ data: [{ id: bai.model }] })
          : Response.json({
              model: bai.model,
              choices: [
                {
                  message: {
                    content: JSON.stringify({ answerZh: "invalid" }),
                  },
                },
              ],
            }),
      ),
    );
    const { gateway, prisma } = service();

    const error = await gateway
      .executeJson(
        request("all schema invalid", {
          responseSchema: canonicalAnswerSchema("assistant.all-invalid", 1),
          costPolicy: "paid_allowed",
          bypassCache: false,
        }),
      )
      .catch((value: unknown) => value);
    const response = (
      error as {
        getResponse(): { attempts: Array<{ code: string }> };
      }
    ).getResponse();

    expect(response.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "OUTPUT_SCHEMA_INVALID" }),
      ]),
    );
    expect(prisma.aiCache.upsert).not.toHaveBeenCalled();
  });

  it("stops on a validator fault without persisting provider output", async () => {
    const bai = providerCases[0];
    const providerOutputMarker = "provider-output-must-not-leak";
    configure(bai, "free");
    process.env.AI_PROVIDER_ORDER = "bai";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/models")
          ? Response.json({ data: [{ id: bai.model }] })
          : Response.json({
              model: bai.model,
              choices: [
                {
                  message: {
                    content: JSON.stringify({ answerZh: providerOutputMarker }),
                  },
                },
              ],
            }),
      ),
    );
    const throwingSchema = recordResponseSchema(
      "assistant.throwing-validator",
      1,
      () => {
        throw new Error("validator internals");
      },
    );
    const { gateway, prisma } = service();

    const error = await gateway
      .executeJson(
        request("validator fault", {
          responseSchema: throwingSchema,
          costPolicy: "paid_allowed",
          bypassCache: false,
        }),
      )
      .catch((value: unknown) => value);
    const response = (
      error as {
        getResponse(): { attempts: Array<{ code: string }> };
      }
    ).getResponse();

    expect(response.attempts).toEqual([
      expect.objectContaining({ code: "RESPONSE_VALIDATOR_ERROR" }),
    ]);
    expect(prisma.aiCache.upsert).not.toHaveBeenCalled();
    expect(JSON.stringify(prisma.aiRun.update.mock.calls)).not.toContain(
      providerOutputMarker,
    );
    expect(prisma.aiRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          errorCode: "RESPONSE_VALIDATOR_ERROR",
          errorMessage: "服务端响应校验器执行失败",
        }),
      }),
    );
  });

  it("isolates cache entries by schema id and version and revalidates canonical data", async () => {
    const bai = providerCases[0];
    configure(bai, "free");
    process.env.AI_PROVIDER_ORDER = "bai";
    const rows = new Map<string, Record<string, unknown>>();
    const prisma = prismaMock();
    prisma.aiCache.findUnique.mockImplementation(
      async ({ where }: { where: { key: string } }) =>
        rows.get(where.key) ?? null,
    );
    prisma.aiCache.upsert.mockImplementation(
      async ({
        where,
        update,
        create,
      }: {
        where: { key: string };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) => {
        const row = rows.has(where.key)
          ? { ...rows.get(where.key), ...update }
          : { ...create };
        rows.set(where.key, row);
        return row;
      },
    );
    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: bai.model }] });
        chatCalls += 1;
        return Response.json({
          model: bai.model,
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answerZh: `  value-${chatCalls}  `,
                  confidence: 0.4,
                  ignored: true,
                }),
              },
            },
          ],
        });
      }),
    );
    const gateway = new AiGatewayService(prisma as unknown as PrismaService);
    const v1 = canonicalAnswerSchema("assistant.cache-contract", 1);
    const v2 = canonicalAnswerSchema("assistant.cache-contract", 2);
    const other = canonicalAnswerSchema("assistant.other-contract", 1);

    const first = await gateway.executeJson(
      request("schema cache", {
        responseSchema: v1,
        costPolicy: "paid_allowed",
        bypassCache: false,
      }),
    );
    const cached = await gateway.executeJson(
      request("schema cache", {
        responseSchema: v1,
        costPolicy: "paid_allowed",
        bypassCache: false,
      }),
    );
    const versionTwo = await gateway.executeJson(
      request("schema cache", {
        responseSchema: v2,
        costPolicy: "paid_allowed",
        bypassCache: false,
      }),
    );
    const otherId = await gateway.executeJson(
      request("schema cache", {
        responseSchema: other,
        costPolicy: "paid_allowed",
        bypassCache: false,
      }),
    );

    expect(first.data).toEqual({ answerZh: "value-1", confidence: 0.4 });
    expect(cached).toMatchObject({
      data: { answerZh: "value-1", confidence: 0.4 },
      cached: true,
      confidence: 0.4,
    });
    expect(versionTwo.data.answerZh).toBe("value-2");
    expect(otherId.data.answerZh).toBe("value-3");
    expect(chatCalls).toBe(3);
    expect(rows).toHaveLength(3);
    expect(
      new Set([...rows.values()].map((row) => row.routeRevision)).size,
    ).toBe(3);
    expect(prisma.aiRun.create.mock.calls.at(1)?.[0].data).toMatchObject({
      status: "cached",
      output: { answerZh: "value-1", confidence: 0.4 },
      confidence: 0.4,
    });
    const succeeded = prisma.aiRun.update.mock.calls[0]?.[0].data;
    expect(succeeded.output).toEqual({
      answerZh: "value-1",
      confidence: 0.4,
    });
  });

  it("serves a valid public cache while its provider is cooling down", async () => {
    const bai = providerCases[0];
    configure(bai, "free");
    process.env.AI_PROVIDER_ORDER = "bai";
    const rows = new Map<string, Record<string, unknown>>();
    const prisma = prismaMock();
    prisma.aiCache.findUnique.mockImplementation(
      async ({ where }: { where: { key: string } }) =>
        rows.get(where.key) ?? null,
    );
    prisma.aiCache.upsert.mockImplementation(
      async ({ where, create }: { where: { key: string }; create: object }) => {
        rows.set(where.key, create as Record<string, unknown>);
        return create;
      },
    );
    let providerCooling = false;
    prisma.aiProviderState.findUnique.mockImplementation(async () =>
      providerCooling
        ? {
            cooldownUntil: new Date(Date.now() + 10 * 60_000),
            lastErrorCode: "MODEL_NOT_AVAILABLE",
          }
        : null,
    );
    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: bai.model }] });
        chatCalls += 1;
        return Response.json({
          model: bai.model,
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answerZh: "缓存可用",
                  confidence: 0.8,
                }),
              },
            },
          ],
        });
      }),
    );
    const gateway = new AiGatewayService(prisma as unknown as PrismaService);
    const input = request("cached provider cooldown", {
      responseSchema: canonicalAnswerSchema("assistant.cooldown-cache", 1),
      costPolicy: "paid_allowed",
      bypassCache: false,
    });

    await gateway.executeJson(input);
    providerCooling = true;
    const cached = await gateway.executeJson(input);

    expect(cached).toMatchObject({
      data: { answerZh: "缓存可用" },
      cached: true,
    });
    expect(chatCalls).toBe(1);
  });

  it("repairs invalid or stale cache rows before serving them again", async () => {
    const bai = providerCases[0];
    configure(bai, "free");
    process.env.AI_PROVIDER_ORDER = "bai";
    const rows = new Map<string, Record<string, unknown>>();
    const prisma = prismaMock();
    prisma.aiCache.findUnique.mockImplementation(
      async ({ where }: { where: { key: string } }) =>
        rows.get(where.key) ?? null,
    );
    prisma.aiCache.upsert.mockImplementation(
      async ({
        where,
        update,
        create,
      }: {
        where: { key: string };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) => {
        const row = rows.has(where.key)
          ? { ...rows.get(where.key), ...update }
          : { ...create };
        rows.set(where.key, row);
        return row;
      },
    );
    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: bai.model }] });
        chatCalls += 1;
        return Response.json({
          model: bai.model,
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answerZh: `value-${chatCalls}`,
                  confidence: 0.5,
                }),
              },
            },
          ],
        });
      }),
    );
    const gateway = new AiGatewayService(prisma as unknown as PrismaService);
    const schema = canonicalAnswerSchema("assistant.cache-validation", 1);
    const cacheRequest = () =>
      request("bad cache", {
        responseSchema: schema,
        costPolicy: "paid_allowed",
        bypassCache: false,
      });

    await gateway.executeJson(cacheRequest());
    const [key] = rows.keys();
    rows.set(key!, { ...rows.get(key!)!, output: { answerZh: "invalid" } });
    await gateway.executeJson(cacheRequest());
    await gateway.executeJson(cacheRequest());
    rows.set(key!, { ...rows.get(key!)!, routeRevision: "stale-revision" });
    await gateway.executeJson(cacheRequest());
    await gateway.executeJson(cacheRequest());

    expect(chatCalls).toBe(3);
    expect(
      prisma.aiRun.create.mock.calls.map(([call]) => call.data.status),
    ).toEqual(["running", "running", "cached", "running", "cached"]);
    expect(rows.get(key!)?.routeRevision).not.toBe("stale-revision");
  });

  it("sends SenseNova the documented OpenAI-compatible request body", async () => {
    const senseNova = providerCases[9];
    configure(senseNova, "paid");
    process.env.AI_PROVIDER_ORDER = "sensenova";
    let chatBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: senseNova.model }] });
        chatBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return success(senseNova.model);
      }),
    );
    const { gateway } = service();

    await gateway.executeJson(request("SenseNova request body"));

    expect(chatBody).toEqual({
      model: "sensenova-6.8-flash-lite",
      messages: [{ role: "user", content: "SenseNova request body" }],
      max_tokens: 100,
      temperature: 0.1,
    });
  });

  it("classifies ordinary network failures without persisting their message", async () => {
    const bai = providerCases[0];
    const sensitiveText = "synthetic-secret-must-never-be-persisted";
    configure(bai, "paid");
    process.env.AI_PROVIDER_ORDER = "bai";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: bai.model }] });
        throw new Error(`socket failed with ${sensitiveText}`);
      }),
    );
    const { gateway, prisma } = service();

    const error = await gateway
      .executeJson(request("network-redaction"))
      .catch((value: unknown) => value);
    const response = (
      error as { getResponse(): Record<string, unknown> }
    ).getResponse();
    const serialized = JSON.stringify({
      response,
      updates: prisma.aiRun.update.mock.calls,
    });

    expect(prisma.aiRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          errorCode: "NETWORK",
          errorMessage: "模型服务网络请求失败",
        }),
      }),
    );
    expect(serialized).not.toContain(sensitiveText);
  });

  it("routes LiteLLM virtual models through the injectable AI SDK client", async () => {
    process.env.LITELLM_API_KEY = "test-gateway-key";
    process.env.LITELLM_API_URL = "https://litellm.test/v1";
    process.env.LITELLM_CUSTOM_ENDPOINT_AUTHORIZED = "true";
    process.env.LITELLM_API_TIER = "paid";
    process.env.LITELLM_PAID_MODELS = "smart|fast|vision|ocr";
    process.env.AI_PROVIDER_ORDER = "litellm";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ data: [{ id: "smart" }, { id: "fast" }] }),
      ),
    );
    const aiSdk = {
      generate: vi.fn().mockResolvedValue({
        model: "openai/production-model",
        choices: [
          { message: { content: JSON.stringify({ answerZh: "gateway-ok" }) } },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3 },
      }),
    };
    const prisma = prismaMock();
    const gateway = new AiGatewayService(
      prisma as unknown as PrismaService,
      aiSdk as never,
    );

    const result = await gateway.executeJson(request("litellm-ai-sdk"));

    expect(result).toMatchObject({
      provider: "litellm",
      requestedModel: "smart",
      model: "smart",
      data: { answerZh: "gateway-ok" },
    });
    expect(aiSdk.generate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "litellm" }),
      "smart",
      expect.objectContaining({
        messages: [{ role: "user", content: "litellm-ai-sdk" }],
        maxTokens: 100,
      }),
      "default",
      expect.any(AbortSignal),
    );
  });

  it.each([
    [
      "empty response body",
      "EMPTY_RESPONSE",
      () => new EmptyResponseBodyError(),
    ],
    [
      "no generated output",
      "EMPTY_RESPONSE",
      () => new NoOutputGeneratedError(),
    ],
    [
      "invalid response data",
      "INVALID_PROVIDER_JSON",
      () =>
        new InvalidResponseDataError({
          data: { malformed: true },
        }),
    ],
    [
      "provider JSON parse failure",
      "INVALID_PROVIDER_JSON",
      () =>
        new JSONParseError({
          text: "synthetic-invalid-provider-json",
          cause: new SyntaxError("synthetic parse failure"),
        }),
    ],
    [
      "unsupported capability",
      "MODEL_CAPABILITY",
      () => new UnsupportedFunctionalityError({ functionality: "vision" }),
    ],
    [
      "unsupported model version",
      "MODEL_CAPABILITY",
      () =>
        new UnsupportedModelVersionError({
          version: "v3",
          provider: "litellm",
          modelId: "smart",
        }),
    ],
    [
      "missing model",
      "MODEL_NOT_AVAILABLE",
      () =>
        new NoSuchModelError({
          modelId: "smart",
          modelType: "languageModel",
        }),
    ],
    [
      "invalid call argument",
      "INVALID_REQUEST",
      () =>
        new InvalidArgumentError({
          parameter: "maxOutputTokens",
          value: -1,
          message: "must be positive",
        }),
    ],
  ])(
    "classifies AI SDK %s as %s",
    async (_case, expectedCode, errorFactory) => {
      process.env.LITELLM_API_KEY = "test-gateway-key";
      process.env.LITELLM_API_URL = "https://litellm.test/v1";
      process.env.LITELLM_CUSTOM_ENDPOINT_AUTHORIZED = "true";
      process.env.LITELLM_API_TIER = "paid";
      process.env.LITELLM_PAID_MODELS = "smart";
      process.env.AI_PROVIDER_ORDER = "litellm";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ data: [{ id: "smart" }] })),
      );
      const aiSdk = { generate: vi.fn().mockRejectedValue(errorFactory()) };
      const prisma = prismaMock();
      const gateway = new AiGatewayService(
        prisma as unknown as PrismaService,
        aiSdk as never,
      );

      const terminalError = await gateway
        .executeJson(request(`sdk-${_case}`))
        .catch((error: unknown) => error);

      expect(
        (
          terminalError as {
            getResponse(): { attempts: Array<{ code: string }> };
          }
        )
          .getResponse()
          .attempts.map((attempt) => attempt.code),
      ).toContain(expectedCode);
      expect(prisma.aiRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ errorCode: expectedCode }),
        }),
      );
    },
  );

  it("audits a validated LiteLLM upstream model without changing the virtual route", async () => {
    process.env.LITELLM_API_KEY = "test-gateway-key";
    process.env.LITELLM_API_URL = "https://litellm.test/v1";
    process.env.LITELLM_CUSTOM_ENDPOINT_AUTHORIZED = "true";
    process.env.LITELLM_API_TIER = "paid";
    process.env.LITELLM_PAID_MODELS = "smart";
    process.env.AI_PROVIDER_ORDER = "litellm";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ id: "smart" }] })),
    );
    const aiSdk = {
      generate: vi.fn().mockResolvedValue({
        model: "openai/gpt-5.1-mini",
        choices: [
          { message: { content: JSON.stringify({ answerZh: "gateway-ok" }) } },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3 },
      }),
    };
    const prisma = prismaMock();
    const gateway = new AiGatewayService(
      prisma as unknown as PrismaService,
      aiSdk as never,
    );

    const result = await gateway.executeJson(
      request("litellm-upstream-audit", { bypassCache: false }),
    );

    expect(result).toMatchObject({
      provider: "litellm",
      requestedModel: "smart",
      model: "smart",
    });
    expect(prisma.aiRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actualModel: "openai/gpt-5.1-mini",
          status: "succeeded",
        }),
      }),
    );
    expect(prisma.aiModelState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ model: "smart" }),
      }),
    );
    expect(prisma.aiCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ model: "smart" }),
        create: expect.objectContaining({ model: "smart" }),
      }),
    );
  });

  it("rejects an unsafe LiteLLM upstream model identifier from the audit field", async () => {
    process.env.LITELLM_API_KEY = "test-gateway-key";
    process.env.LITELLM_API_URL = "https://litellm.test/v1";
    process.env.LITELLM_CUSTOM_ENDPOINT_AUTHORIZED = "true";
    process.env.LITELLM_API_TIER = "paid";
    process.env.LITELLM_PAID_MODELS = "smart";
    process.env.AI_PROVIDER_ORDER = "litellm";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ id: "smart" }] })),
    );
    const aiSdk = {
      generate: vi.fn().mockResolvedValue({
        model: "openai/model\nforged-audit-line",
        choices: [
          { message: { content: JSON.stringify({ answerZh: "gateway-ok" }) } },
        ],
      }),
    };
    const prisma = prismaMock();
    const gateway = new AiGatewayService(
      prisma as unknown as PrismaService,
      aiSdk as never,
    );

    await gateway.executeJson(request("litellm-unsafe-upstream"));

    expect(prisma.aiRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actualModel: "smart" }),
      }),
    );
  });

  it("keeps direct providers as fallback when LiteLLM returns an HTTP error", async () => {
    const gemini = providerCases[2];
    process.env.LITELLM_API_KEY = "test-gateway-key";
    process.env.LITELLM_API_URL = "https://litellm.test/v1";
    process.env.LITELLM_CUSTOM_ENDPOINT_AUTHORIZED = "true";
    process.env.LITELLM_API_TIER = "free";
    process.env.LITELLM_FREE_MODELS = "smart|fast";
    configure(gemini, "paid");
    process.env.GEMINI_PAID_MODELS = gemini.model;
    process.env.GEMINI_PRICING_VERIFIED_AT = new Date().toISOString();
    process.env.AI_PROVIDER_ORDER = "litellm|gemini";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.startsWith("https://litellm.test") && url.endsWith("/models"))
          return Response.json({ data: [{ id: "smart" }, { id: "fast" }] });
        if (url.endsWith("/models"))
          return Response.json({ data: [{ id: `models/${gemini.model}` }] });
        return success(gemini.model, "direct-fallback-ok");
      }),
    );
    const aiSdk = {
      generate: vi
        .fn()
        .mockRejectedValue(
          new AiSdkHttpError(
            429,
            '{"error":"gateway rate limit"}',
            new Headers({ "retry-after": "1" }),
            "gateway rate limit",
          ),
        ),
    };
    const prisma = prismaMock();
    const gateway = new AiGatewayService(
      prisma as unknown as PrismaService,
      aiSdk as never,
    );

    const result = await gateway.executeJson(
      request("litellm-fallback", { costPolicy: "free_first" }),
    );

    expect(result).toMatchObject({
      provider: "gemini",
      model: gemini.model,
      fallbackUsed: true,
      data: { answerZh: "direct-fallback-ok" },
    });
    expect(aiSdk.generate).toHaveBeenCalled();
  });

  it("stably shares same-tier traffic across configured providers", async () => {
    const gemini = providerCases[2];
    const groq = providerCases[3];
    configure(gemini, "free");
    configure(groq, "free");
    process.env.AI_PROVIDER_ORDER = "gemini|groq";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/models"))
        return Response.json({
          data: url.startsWith(gemini.url)
            ? [{ id: `models/${gemini.model}` }]
            : [{ id: "openai/gpt-oss-20b" }],
        });
      return url.startsWith(gemini.url)
        ? success(gemini.model)
        : success("openai/gpt-oss-20b");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { gateway } = service();
    const selected = new Set<string>();

    for (let index = 0; index < 24; index += 1) {
      const result = await gateway.executeJson(
        request(`分流样本-${index}`, { costPolicy: "free_only" }),
      );
      selected.add(result.provider);
    }

    expect(selected).toEqual(new Set(["gemini", "groq"]));
  });

  it("falls back from the SenseNova main credential to the translation credential", async () => {
    const senseNova = providerCases[9];
    configure(senseNova, "paid");
    process.env.SENSENOVA_TRANSLATION_API_KEY =
      "test-sensenova-translation-key";
    process.env.AI_PROVIDER_ORDER = "sensenova";
    process.env.AI_ROUTE_SENSENOVA_TRANSLATION = "sensenova-6.8-flash-lite";
    const chatCredentials: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const authorization =
          new Headers(init?.headers).get("authorization") ?? "";
        if (url.endsWith("/models"))
          return Response.json({ data: [{ id: senseNova.model }] });
        chatCredentials.push(authorization);
        return authorization.endsWith("test-sensenova-key")
          ? Response.json({ error: "credential rejected" }, { status: 401 })
          : success(senseNova.model, "translation-key-ok");
      }),
    );
    const { gateway, prisma } = service();

    const first = await gateway.executeJson(request("main-key-fallback"));
    const second = await gateway.executeJson(request("main-key-still-cooling"));

    expect(first.data.answerZh).toBe("translation-key-ok");
    expect(second.data.answerZh).toBe("translation-key-ok");
    expect(
      chatCredentials.filter((value) => value.endsWith("test-sensenova-key")),
    ).toHaveLength(1);
    expect(prisma.aiProviderState.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastErrorCode: "AUTH" }),
      }),
    );
  });

  it("fails closed on a SenseNova account-scoped 429 without trying another key", async () => {
    const senseNova = providerCases[9];
    configure(senseNova, "paid");
    process.env.SENSENOVA_TRANSLATION_API_KEY =
      "test-sensenova-translation-key";
    process.env.AI_PROVIDER_ORDER = "sensenova";
    process.env.AI_ROUTE_SENSENOVA_TRANSLATION = "sensenova-6.8-flash-lite";
    const chatCredentials: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const authorization =
          new Headers(init?.headers).get("authorization") ?? "";
        if (url.endsWith("/models"))
          return Response.json({ data: [{ id: "sensenova-6.8-flash-lite" }] });
        chatCredentials.push(authorization);
        return authorization.endsWith("test-sensenova-translation-key")
          ? Response.json(
              { error: "credential requests per minute" },
              { status: 429, headers: { "retry-after": "60" } },
            )
          : success("sensenova-6.8-flash-lite", "main-key-ok");
      }),
    );
    const { gateway } = service();

    const error = await gateway
      .executeJson(
        request("translation-key-no-bypass", { task: "translation" }),
      )
      .catch((value: unknown) => value);

    expect(
      (error as { getResponse(): { code: string } }).getResponse().code,
    ).toBe("AI_GATEWAY_CAPACITY_COOLDOWN");
    expect(chatCredentials).toHaveLength(1);
    expect(chatCredentials[0]).toMatch(/translation-key$/);
    expect(chatCredentials[0]).not.toMatch(/sensenova-key$/);
  });

  it.each([
    [402, "account credits exhausted"],
    [429, "account request window exhausted"],
  ])(
    "moves from a limited SenseNova primary account to the independent secondary account on %s",
    async (status, body) => {
      const senseNova = providerCases[9];
      configure(senseNova, "paid");
      process.env.SENSENOVA_TRANSLATION_API_KEY =
        "test-sensenova-translation-key";
      process.env.SENSENOVA_SECONDARY_API_KEY = "test-sensenova-secondary-key";
      process.env.AI_PROVIDER_ORDER = "sensenova";
      const chatCredentials: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          const authorization =
            new Headers(init?.headers).get("authorization") ?? "";
          if (url.endsWith("/models"))
            return Response.json({ data: [{ id: senseNova.model }] });
          chatCredentials.push(authorization);
          return authorization.endsWith("test-sensenova-key")
            ? Response.json(
                { error: body },
                {
                  status,
                  ...(status === 429
                    ? { headers: { "retry-after": "60" } }
                    : {}),
                },
              )
            : success(senseNova.model, "secondary-account-ok");
        }),
      );
      const { gateway, prisma } = service();

      const first = await gateway.executeJson(
        request(`primary-account-${status}`),
      );
      const second = await gateway.executeJson(
        request(`primary-account-${status}-still-cooling`),
      );

      expect(first.data.answerZh).toBe("secondary-account-ok");
      expect(second.data.answerZh).toBe("secondary-account-ok");
      expect(chatCredentials).toHaveLength(3);
      expect(chatCredentials[0]).toMatch(/sensenova-key$/);
      expect(chatCredentials.slice(1)).toEqual([
        expect.stringMatching(/secondary-key$/),
        expect.stringMatching(/secondary-key$/),
      ]);
      expect(chatCredentials.join("|")).not.toMatch(/translation-key/);
      expect(prisma.aiProviderState.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastErrorCode: status === 402 ? "CREDITS" : "RATE_LIMIT",
          }),
        }),
      );
    },
  );

  it.each([
    [402, "account credits exhausted"],
    [429, "account request window exhausted"],
  ])(
    "skips the same-account main key and moves from SenseNova translation to secondary on %s",
    async (status, body) => {
      const senseNova = providerCases[9];
      configure(senseNova, "paid");
      process.env.SENSENOVA_TRANSLATION_API_KEY =
        "test-sensenova-translation-key";
      process.env.SENSENOVA_SECONDARY_API_KEY = "test-sensenova-secondary-key";
      process.env.AI_PROVIDER_ORDER = "sensenova";
      process.env.AI_ROUTE_SENSENOVA_TRANSLATION = senseNova.model;
      const chatCredentials: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          const authorization =
            new Headers(init?.headers).get("authorization") ?? "";
          if (url.endsWith("/models"))
            return Response.json({ data: [{ id: senseNova.model }] });
          chatCredentials.push(authorization);
          return authorization.endsWith("test-sensenova-translation-key")
            ? Response.json(
                { error: body },
                {
                  status,
                  ...(status === 429
                    ? { headers: { "retry-after": "60" } }
                    : {}),
                },
              )
            : success(senseNova.model, "secondary-account-ok");
        }),
      );
      const { gateway, prisma } = service();

      const first = await gateway.executeJson(
        request(`translation-account-${status}`, { task: "translation" }),
      );
      const second = await gateway.executeJson(
        request(`translation-account-${status}-still-cooling`, {
          task: "translation",
        }),
      );

      expect(first.data.answerZh).toBe("secondary-account-ok");
      expect(second.data.answerZh).toBe("secondary-account-ok");
      expect(chatCredentials).toEqual([
        expect.stringMatching(/translation-key$/),
        expect.stringMatching(/secondary-key$/),
        expect.stringMatching(/secondary-key$/),
      ]);
      expect(chatCredentials.join("|")).not.toMatch(/sensenova-key(?:\||$)/);
      expect(prisma.aiProviderState.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastErrorCode: status === 402 ? "CREDITS" : "RATE_LIMIT",
          }),
        }),
      );
    },
  );

  it("keeps the SenseNova primary account usable when the secondary catalogue is rate limited", async () => {
    const senseNova = providerCases[9];
    configure(senseNova, "paid");
    process.env.SENSENOVA_SECONDARY_API_KEY = "test-sensenova-secondary-key";
    process.env.AI_PROVIDER_ORDER = "sensenova";
    const catalogueCredentials: string[] = [];
    const chatCredentials: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const authorization =
          new Headers(init?.headers).get("authorization") ?? "";
        if (url.endsWith("/models")) {
          catalogueCredentials.push(authorization);
          return authorization.endsWith("test-sensenova-secondary-key")
            ? Response.json(
                { error: "secondary account request window exhausted" },
                { status: 429, headers: { "retry-after": "60" } },
              )
            : Response.json({ data: [{ id: senseNova.model }] });
        }
        chatCredentials.push(authorization);
        return success(senseNova.model, "primary-account-ok");
      }),
    );
    const { gateway, prisma } = service();

    const result = await gateway.executeJson(
      request("secondary-catalogue-rate-limit"),
    );

    expect(result.data.answerZh).toBe("primary-account-ok");
    expect(catalogueCredentials).toEqual([
      expect.stringMatching(/sensenova-key$/),
      expect.stringMatching(/secondary-key$/),
    ]);
    expect(chatCredentials).toHaveLength(1);
    expect(chatCredentials[0]).toMatch(/sensenova-key$/);
    expect(chatCredentials[0]).not.toMatch(/secondary-key$/);
    expect(prisma.aiProviderState.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastErrorCode: "RATE_LIMIT" }),
      }),
    );
  });

  it.each([502, 503, 504])(
    "keeps SenseNova healthy when one account catalogue succeeds and the other returns %s",
    async (status) => {
      const senseNova = providerCases[9];
      configure(senseNova, "paid");
      process.env.SENSENOVA_SECONDARY_API_KEY = "test-sensenova-secondary-key";
      process.env.AI_PROVIDER_ORDER = "sensenova";
      const catalogueCredentials: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          expect(String(input)).toMatch(/\/models$/);
          const authorization =
            new Headers(init?.headers).get("authorization") ?? "";
          catalogueCredentials.push(authorization);
          return authorization.endsWith("test-sensenova-secondary-key")
            ? Response.json(
                { error: "secondary catalogue temporarily unavailable" },
                { status },
              )
            : Response.json({ data: [{ id: senseNova.model }] });
        }),
      );
      const { gateway, prisma } = service();

      const models = await gateway.availableModelIds(true);

      expect(models).toEqual(new Set([`sensenova:${senseNova.model}`]));
      expect(catalogueCredentials).toEqual([
        expect.stringMatching(/sensenova-key$/),
        expect.stringMatching(/secondary-key$/),
      ]);
      expect(prisma.aiProviderState.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastErrorCode: "PROVIDER_ERROR" }),
        }),
      );
    },
  );

  it("merges SenseNova catalogues across explicitly independent accounts", async () => {
    const senseNova = providerCases[9];
    configure(senseNova, "paid");
    process.env.SENSENOVA_SECONDARY_API_KEY = "test-sensenova-secondary-key";
    process.env.AI_PROVIDER_ORDER = "sensenova";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const authorization =
          new Headers(init?.headers).get("authorization") ?? "";
        return authorization.endsWith("test-sensenova-secondary-key")
          ? Response.json({ data: [{ id: senseNova.model }] })
          : Response.json({ data: [{ id: "primary-account-only-model" }] });
      }),
    );
    const { gateway } = service();

    const models = await gateway.availableModelIds(true);

    expect(models).toEqual(
      new Set([
        "sensenova:primary-account-only-model",
        `sensenova:${senseNova.model}`,
      ]),
    );
  });

  it("merges SenseNova catalogues when one credential cannot access the catalogue", async () => {
    const senseNova = providerCases[9];
    configure(senseNova, "paid");
    process.env.SENSENOVA_TRANSLATION_API_KEY =
      "test-sensenova-translation-key";
    process.env.SENSENOVA_SECONDARY_API_KEY = "test-sensenova-secondary-key";
    process.env.AI_PROVIDER_ORDER = "sensenova";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const authorization =
          new Headers(init?.headers).get("authorization") ?? "";
        if (url.endsWith("/models"))
          return authorization.endsWith("test-sensenova-key")
            ? Response.json({ error: "forbidden" }, { status: 403 })
            : Response.json({ data: [{ id: senseNova.model }] });
        return success(senseNova.model, "catalogue-fallback-ok");
      }),
    );
    const { gateway, prisma } = service();

    const result = await gateway.executeJson(request("catalogue-key-fallback"));

    expect(result.data.answerZh).toBe("catalogue-fallback-ok");
    expect(prisma.aiProviderState.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastErrorCode: "AUTH" }),
      }),
    );
  });

  it.each([
    [402, "CREDITS", "account credits exhausted"],
    [429, "RATE_LIMIT", "account request window exhausted"],
  ])(
    "cools SenseNova only after both independent accounts fail with %s",
    async (status, expectedCode, body) => {
      const senseNova = providerCases[9];
      configure(senseNova, "paid");
      process.env.SENSENOVA_TRANSLATION_API_KEY =
        "test-sensenova-translation-key";
      process.env.SENSENOVA_SECONDARY_API_KEY = "test-sensenova-secondary-key";
      process.env.AI_PROVIDER_ORDER = "sensenova";
      const chatCredentials: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith("/models"))
            return Response.json({ data: [{ id: senseNova.model }] });
          const authorization =
            new Headers(init?.headers).get("authorization") ?? "";
          chatCredentials.push(authorization);
          return Response.json(
            { error: body },
            {
              status,
              ...(status === 429 ? { headers: { "retry-after": "60" } } : {}),
            },
          );
        }),
      );
      const { gateway, prisma } = service();

      const error = await gateway
        .executeJson(request(`all-accounts-${status}`))
        .catch((value: unknown) => value);
      const response = (
        error as { getResponse(): Record<string, unknown> }
      ).getResponse();
      const serialized = JSON.stringify(response);

      expect(response.code).toBe("AI_GATEWAY_CAPACITY_COOLDOWN");
      expect(chatCredentials).toEqual([
        expect.stringMatching(/sensenova-key$/),
        expect.stringMatching(/secondary-key$/),
      ]);
      expect(chatCredentials.join("|")).not.toMatch(/translation-key/);
      expect(prisma.aiProviderState.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "cooldown",
            lastErrorCode: expectedCode,
            cooldownUntil: expect.any(Date),
          }),
        }),
      );
      expect(serialized).not.toContain("test-sensenova-key");
      expect(serialized).not.toContain("test-sensenova-translation-key");
      expect(serialized).not.toContain("test-sensenova-secondary-key");
    },
  );

  it("tries every SenseNova key in translation order before cooling the provider without leaking credentials", async () => {
    const senseNova = providerCases[9];
    configure(senseNova, "paid");
    process.env.SENSENOVA_TRANSLATION_API_KEY =
      "test-sensenova-translation-key";
    process.env.SENSENOVA_SECONDARY_API_KEY = "test-sensenova-secondary-key";
    process.env.AI_PROVIDER_ORDER = "sensenova";
    process.env.AI_ROUTE_SENSENOVA_TRANSLATION = senseNova.model;
    const chatCredentials: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: senseNova.model }] });
        chatCredentials.push(
          new Headers(init?.headers).get("authorization") ?? "",
        );
        return Response.json({ error: "forbidden" }, { status: 403 });
      }),
    );
    const { gateway, prisma } = service();

    const error = await gateway
      .executeJson(request("all-credentials-fail", { task: "translation" }))
      .catch((value: unknown) => value);
    const response = (
      error as { getResponse(): Record<string, unknown> }
    ).getResponse();
    const serialized = JSON.stringify(response);

    expect(response.code).toBe("AI_GATEWAY_UNAVAILABLE");
    expect(chatCredentials).toEqual([
      expect.stringMatching(/translation-key$/),
      expect.stringMatching(/sensenova-key$/),
      expect.stringMatching(/secondary-key$/),
    ]);
    expect(serialized).not.toContain("test-sensenova-key");
    expect(serialized).not.toContain("test-sensenova-translation-key");
    expect(serialized).not.toContain("test-sensenova-secondary-key");
    expect(prisma.aiProviderState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastErrorCode: "AUTH" }),
      }),
    );
  });

  it.each([
    [401, "AUTH", "unauthorized"],
    [402, "CREDITS", "credits exhausted"],
    [429, "RATE_LIMIT", "account daily quota exhausted"],
  ])(
    "disables the failed provider immediately after provider-wide %s",
    async (status, expectedCode, body) => {
      const bai = providerCases[0];
      const openrouter = providerCases[1];
      configure(bai);
      configure(openrouter);
      process.env.AI_PROVIDER_ORDER = "bai|openrouter";
      let failedHost: string | undefined;
      const chats: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const url = String(input);
          if (url.endsWith("/models"))
            return Response.json({
              data: url.startsWith(bai.url)
                ? [
                    { id: "glm-5.3-flash" },
                    { id: "qwen3.8-flash" },
                    { id: "mimo-v2.5" },
                  ]
                : [
                    { id: "z-ai/glm-5.2:free" },
                    { id: "minimax/minimax-m3:free" },
                  ],
            });
          const host = new URL(url).host;
          chats.push(host);
          failedHost ??= host;
          if (host === failedHost)
            return Response.json({ error: body }, { status });
          return success("z-ai/glm-5.2:free", expectedCode);
        }),
      );
      const { gateway, prisma } = service();

      const result = await gateway.executeJson(request(`provider-${status}`));

      expect(result.provider).not.toBeUndefined();
      expect(chats.filter((host) => host === failedHost)).toHaveLength(1);
      expect(prisma.aiProviderState.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastErrorCode: expectedCode }),
        }),
      );
    },
  );

  it("puts a 503 provider outage into a long circuit cooldown", async () => {
    const bai = providerCases[0];
    configure(bai);
    process.env.AI_PROVIDER_ORDER = "bai";
    process.env.AI_PROVIDER_5XX_COOLDOWN_MS = "900000";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/models")
          ? Response.json({ data: [{ id: bai.model }] })
          : Response.json({ error: "service unavailable" }, { status: 503 }),
      ),
    );
    const { gateway, prisma } = service();
    const startedAt = Date.now();

    await gateway.executeJson(request("provider-503")).catch(() => undefined);

    const failure = prisma.aiProviderState.updateMany.mock.calls.find(
      ([input]) => input.data?.lastErrorCode === "PROVIDER_ERROR",
    )?.[0];
    expect(failure?.data.cooldownUntil).toBeInstanceOf(Date);
    expect(failure?.data.cooldownUntil.getTime()).toBeGreaterThanOrEqual(
      startedAt + 899_000,
    );
  });

  it("uses an OVO model only after the account catalogue exposes it", async () => {
    process.env.OVO_API_KEY = "test-ovo-key";
    process.env.OVO_INTERNAL_EVALUATION = "true";
    process.env.AI_PROVIDER_ORDER = "ovo";
    process.env.AI_PROVIDER_ORDER_ASSISTANT_CHAT = "ovo";
    process.env.AI_PAID_PROVIDER_ALLOWLIST = "ovo";
    const aiSdk = {
      generate: vi.fn(() => {
        throw new Error("OVO must use the Chat Completions transport");
      }),
    };
    const prisma = prismaMock();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: "gpt-5.6-luna" }] });
        expect(String(input)).toBe("https://ovo1.cn/v1/chat/completions");
        expect(String(input)).not.toContain("/responses");
        expect(init?.method).toBe("POST");
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer test-ovo-key");
        expect(headers.get("content-type")).toBe("application/json");
        expect(headers.has("originator")).toBe(false);
        expect(headers.has("version")).toBe(false);
        expect(headers.has("user-agent")).toBe(false);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          model: "gpt-5.6-luna",
          max_tokens: 100,
          temperature: 0.1,
        });
        expect(body.messages).toEqual(expect.any(Array));
        expect(body).not.toHaveProperty("reasoning");
        expect(body).not.toHaveProperty("input");
        expect(body).not.toHaveProperty("max_output_tokens");
        return Response.json({
          model: "gpt-5.6-luna-routed",
          choices: [
            { message: { content: JSON.stringify({ answerZh: "OVO 可用" }) } },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new AiGatewayService(
      prisma as unknown as PrismaService,
      aiSdk as unknown as AiSdkModelClient,
    );

    const result = await gateway.executeJson(request("OVO static route"));

    expect(result).toMatchObject({
      provider: "ovo",
      model: "gpt-5.6-luna",
      data: { answerZh: "OVO 可用" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(aiSdk.generate).not.toHaveBeenCalled();
    expect(prisma.aiRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actualModel: "gpt-5.6-luna-routed",
          inputTokens: 11,
          outputTokens: 7,
        }),
      }),
    );
  });

  it("uses an explicitly configured model during a temporary catalogue outage", async () => {
    process.env.OVO_API_KEY = "test-ovo-key";
    process.env.OVO_INTERNAL_EVALUATION = "true";
    process.env.AI_PROVIDER_ORDER = "ovo";
    process.env.AI_PROVIDER_ORDER_ASSISTANT_CHAT = "ovo";
    process.env.AI_PAID_PROVIDER_ALLOWLIST = "ovo";
    process.env.AI_ALLOW_CONFIGURED_CATALOGUE_FALLBACK = "true";
    process.env.AI_OVO_CATALOGUE_FALLBACK_MODELS = "gpt-5.6-luna";
    const prisma = prismaMock();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/models"))
        throw new TypeError("temporary catalogue outage");
      return success("gpt-5.6-luna", "OVO fallback 可用");
    });
    vi.stubGlobal("fetch", fetchMock);

    const gateway = new AiGatewayService(
      prisma as unknown as PrismaService,
      { generate: vi.fn() } as unknown as AiSdkModelClient,
    );

    const result = await gateway.executeJson(request("OVO catalogue fallback"));

    expect(result).toMatchObject({
      provider: "ovo",
      model: "gpt-5.6-luna",
      data: { answerZh: "OVO fallback 可用" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails fast without a second paid call when the OVO account group rejects Luna", async () => {
    process.env.OVO_API_KEY = "test-ovo-key";
    process.env.OVO_INTERNAL_EVALUATION = "true";
    process.env.AI_PROVIDER_ORDER = "ovo";
    process.env.AI_PROVIDER_ORDER_ASSISTANT_CHAT = "ovo";
    process.env.AI_PAID_PROVIDER_ALLOWLIST = "ovo";
    const aiSdk = {
      generate: vi.fn(() => {
        throw new Error("OVO must use Chat Completions");
      }),
    };
    const requestedModels: string[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: "gpt-5.6-luna" }] });
        expect(String(input)).toBe("https://ovo1.cn/v1/chat/completions");
        const body = JSON.parse(String(init?.body)) as { model?: unknown };
        requestedModels.push(String(body.model));
        return Response.json(
          {
            error: {
              message:
                'Model "gpt-5.6-luna" is not supported by any configured account in this group',
              code: "model_not_found",
            },
          },
          { status: 404 },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const prisma = prismaMock();
    const gateway = new AiGatewayService(
      prisma as unknown as PrismaService,
      aiSdk as unknown as AiSdkModelClient,
    );
    const startedAt = Date.now();

    await expect(
      gateway.executeJson(request("OVO account-group rejection")),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "AI_GATEWAY_UNAVAILABLE" }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedModels).toEqual(["gpt-5.6-luna"]);
    expect(aiSdk.generate).not.toHaveBeenCalled();
    expect(prisma.aiProviderState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider: "ovo" },
        data: expect.objectContaining({
          status: "cooldown",
          lastErrorCode: "MODEL_NOT_AVAILABLE",
          cooldownUntil: expect.any(Date),
        }),
      }),
    );
    const lunaFailure = prisma.aiModelState.updateMany.mock.calls.find(
      ([input]) =>
        input.where?.provider === "ovo" &&
        input.where?.model === "gpt-5.6-luna" &&
        input.data?.lastErrorCode === "MODEL_NOT_AVAILABLE",
    )?.[0];
    expect(lunaFailure?.data.cooldownUntil).toBeInstanceOf(Date);
    expect(lunaFailure?.data.cooldownUntil.getTime()).toBeGreaterThanOrEqual(
      startedAt + 29 * 60_000,
    );
    expect(lunaFailure?.data.cooldownUntil.getTime()).toBeLessThanOrEqual(
      startedAt + 31 * 60_000,
    );
  });

  it("serializes OVO calls so one paid credential never runs concurrently", async () => {
    process.env.OVO_API_KEY = "test-ovo-key";
    process.env.OVO_INTERNAL_EVALUATION = "true";
    process.env.AI_PROVIDER_ORDER = "ovo";
    process.env.AI_PROVIDER_ORDER_ASSISTANT_CHAT = "ovo";
    process.env.AI_PAID_PROVIDER_ALLOWLIST = "ovo";
    process.env.AI_PROVIDER_MAX_CONCURRENCY_OVO = "1";
    let active = 0;
    let maximumActive = 0;
    let calls = 0;
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const aiSdk = {
      generate: vi.fn(() => {
        throw new Error("OVO must use Chat Completions");
      }),
    };
    const fetchMock = vi.fn().mockImplementation(async (input) => {
      if (String(input).endsWith("/models"))
        return Response.json({ data: [{ id: "gpt-5.6-luna" }] });
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (calls === 1) {
        markFirstStarted();
        await firstBlocked;
      }
      active -= 1;
      return Response.json({
        model: "gpt-5.6-luna",
        choices: [
          { message: { content: JSON.stringify({ answerZh: "串行完成" }) } },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const prisma = prismaMock();
    const gateway = new AiGatewayService(
      prisma as unknown as PrismaService,
      aiSdk as unknown as AiSdkModelClient,
    );

    const first = gateway.executeJson(request("OVO concurrent first"));
    await firstStarted;
    const second = gateway.executeJson(request("OVO concurrent second"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toBe(1);
    releaseFirst();
    await Promise.all([first, second]);

    expect(maximumActive).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(aiSdk.generate).not.toHaveBeenCalled();
  });

  it("turns the configured Gemini safety target into a 12 RPM request cadence", () => {
    expect(
      providerRequestSpacingMs("gemini", {
        AI_PROVIDER_RPM_GEMINI: "12",
      }),
    ).toBe(5_000);
    expect(providerRequestSpacingMs("gemini", {})).toBe(0);
  });

  it("continues to another provider when health-state writes hit a concurrent unique conflict", async () => {
    const bai = providerCases[0];
    const openrouter = providerCases[1];
    configure(bai, "free");
    configure(openrouter, "free");
    process.env.AI_PROVIDER_ORDER = "bai|openrouter";
    const chatHosts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/models"))
          return Response.json({
            data: url.startsWith(bai.url)
              ? [{ id: bai.model }]
              : [{ id: openrouter.model }],
          });
        const host = new URL(url).host;
        chatHosts.push(host);
        return chatHosts.length === 1
          ? Response.json({ error: "service unavailable" }, { status: 503 })
          : success(openrouter.model, "state-conflict-fallback-ok");
      }),
    );
    const prisma = prismaMock();
    const uniqueConflict = Object.assign(
      new Error("Unique constraint failed on the health-state key"),
      { code: "P2002" },
    );
    prisma.aiModelState.upsert.mockRejectedValue(uniqueConflict);
    prisma.aiProviderState.upsert.mockRejectedValue(uniqueConflict);
    const { gateway } = service(prisma);

    const result = await gateway.executeJson(
      request("state-conflict-fallback", { costPolicy: "free_only" }),
    );

    expect(result.data.answerZh).toBe("state-conflict-fallback-ok");
    expect(new Set(chatHosts).size).toBe(2);
    expect(prisma.aiModelState.upsert).not.toHaveBeenCalled();
    expect(prisma.aiProviderState.upsert).not.toHaveBeenCalled();
  });

  it("retains both failures when another request creates each health-state row first", async () => {
    const bai = providerCases[0];
    configure(bai, "free");
    process.env.AI_PROVIDER_ORDER = "bai";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/models")
          ? Response.json({ data: [{ id: bai.model }] })
          : Response.json({ error: "service unavailable" }, { status: 503 }),
      ),
    );
    type FailureState = Record<string, unknown> & {
      consecutiveFailures: number;
    };
    let providerState: FailureState | null = null;
    let modelState: FailureState | null = null;
    const updateState = (
      current: FailureState | null,
      data: Record<string, unknown> & {
        consecutiveFailures?: { increment?: number };
      },
    ) => ({
      ...(current ?? {}),
      ...data,
      consecutiveFailures:
        (current?.consecutiveFailures ?? 0) +
        Number(data.consecutiveFailures?.increment ?? 0),
    });
    const prisma = prismaMock();
    prisma.aiProviderState.findUnique.mockImplementation(
      async () => providerState,
    );
    prisma.aiProviderState.updateMany.mockImplementation(async (input) => {
      if (!providerState) return { count: 0 };
      providerState = updateState(providerState, input.data);
      return { count: 1 };
    });
    prisma.aiProviderState.create.mockImplementation(async (input) => {
      // Simulate the winner of a concurrent insert becoming visible before
      // this request receives PostgreSQL's unique-conflict response.
      providerState = input.data as FailureState;
      throw { code: "P2002" };
    });
    prisma.aiModelState.findUnique.mockImplementation(async () => modelState);
    prisma.aiModelState.updateMany.mockImplementation(async (input) => {
      if (!modelState) return { count: 0 };
      modelState = updateState(modelState, input.data);
      return { count: 1 };
    });
    prisma.aiModelState.create.mockImplementation(async (input) => {
      modelState = input.data as FailureState;
      throw { code: "P2002" };
    });
    const { gateway } = service(prisma);

    const error = await gateway
      .executeJson(
        request("concurrent-state-create", { costPolicy: "free_only" }),
      )
      .catch((value: unknown) => value);

    expect(
      (error as { getResponse(): { code: string } }).getResponse().code,
    ).toBe("AI_GATEWAY_UNAVAILABLE");
    expect((providerState as FailureState | null)?.consecutiveFailures).toBe(2);
    expect((modelState as FailureState | null)?.consecutiveFailures).toBe(2);
    expect(prisma.aiProviderState.upsert).not.toHaveBeenCalled();
    expect(prisma.aiModelState.upsert).not.toHaveBeenCalled();
  });

  it("keeps Groq 429 scoped to the model and tries another Groq model", async () => {
    const groq = providerCases[3];
    configure(groq, "free");
    process.env.AI_PROVIDER_ORDER = "groq";
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/models"))
          return Response.json({
            data: [{ id: "openai/gpt-oss-20b" }, { id: "openai/gpt-oss-120b" }],
          });
        calls += 1;
        return calls === 1
          ? Response.json(
              { error: "model quota" },
              {
                status: 429,
                headers: {
                  "retry-after": "2",
                  "x-ratelimit-remaining-requests": "0",
                },
              },
            )
          : success("openai/gpt-oss-120b");
      }),
    );
    const { gateway, prisma } = service();

    const result = await gateway.executeJson(request("groq model quota"));

    expect(result.model).toBe("openai/gpt-oss-120b");
    expect(calls).toBe(2);
    expect(prisma.aiProviderState.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastErrorCode: "RATE_LIMIT" }),
      }),
    );
  });

  it("keeps SiliconFlow 429 scoped to the model", async () => {
    const silicon = providerCases[4];
    configure(silicon);
    process.env.AI_PROVIDER_ORDER = "siliconflow";
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/models"))
          return Response.json({
            data: [
              { id: "deepseek-ai/DeepSeek-V4-Flash" },
              { id: "Qwen/Qwen2.5-7B-Instruct" },
            ],
          });
        calls += 1;
        return calls === 1
          ? Response.json({ error: "model capacity" }, { status: 429 })
          : success("Qwen/Qwen2.5-7B-Instruct");
      }),
    );
    const { gateway, prisma } = service();

    const result = await gateway.executeJson(request("silicon quota"));

    expect(result.provider).toBe("siliconflow");
    expect(calls).toBe(2);
    expect(prisma.aiProviderState.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastErrorCode: "RATE_LIMIT" }),
      }),
    );
  });

  it.each([
    [404, "not found"],
    [200, "invalid-json"],
  ])(
    "skips only one model after model-level invalid response %s",
    async (status, body) => {
      const groq = providerCases[3];
      configure(groq, "free");
      process.env.AI_PROVIDER_ORDER = "groq";
      let calls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          if (String(input).endsWith("/models"))
            return Response.json({
              data: [
                { id: "openai/gpt-oss-20b" },
                { id: "openai/gpt-oss-120b" },
              ],
            });
          calls += 1;
          if (calls === 1)
            return status === 404
              ? Response.json({ error: body }, { status })
              : Response.json({
                  choices: [{ message: { content: body } }],
                });
          return success("openai/gpt-oss-120b");
        }),
      );
      const { gateway } = service();

      const result = await gateway.executeJson(request(`invalid-${status}`));

      expect(result.model).toBe("openai/gpt-oss-120b");
      expect(calls).toBe(2);
    },
  );

  it.each([
    [
      "MODEL_CAPABILITY",
      () =>
        Response.json(
          { error: "model does not support response format" },
          { status: 400 },
        ),
    ],
    ["INVALID_PROVIDER_JSON", () => new Response("not-json", { status: 200 })],
    [
      "INVALID_JSON",
      () => Response.json({ choices: [{ message: { content: "not-json" } }] }),
    ],
  ])("cools a model after %s", async (expectedCode, failedResponse) => {
    const groq = providerCases[3];
    configure(groq, "free");
    process.env.AI_PROVIDER_ORDER = "groq";
    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/models"))
          return Response.json({
            data: [{ id: "openai/gpt-oss-20b" }, { id: "openai/gpt-oss-120b" }],
          });
        chatCalls += 1;
        return chatCalls === 1
          ? failedResponse()
          : success("openai/gpt-oss-120b");
      }),
    );
    const { gateway, prisma } = service();

    await gateway.executeJson(request(`cooldown-${expectedCode}`));

    const failureUpdate = prisma.aiModelState.updateMany.mock.calls.find(
      ([input]) => input.data?.lastErrorCode === expectedCode,
    )?.[0];
    expect(failureUpdate?.data.cooldownUntil).toBeInstanceOf(Date);
  });

  it("cools only the empty-response model before the next task", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T06:00:00.000Z"));
    const groq = providerCases[3];
    configure(groq, "free");
    process.env.AI_PROVIDER_ORDER = "groq";
    process.env.AI_ROUTE_GROQ_ASSISTANT_CHAT =
      "openai/gpt-oss-20b|openai/gpt-oss-120b";
    type ModelState = {
      cooldownUntil?: Date | null;
      consecutiveFailures?: number;
    };
    const modelStates = new Map<string, ModelState>();
    const prisma = prismaMock();
    prisma.aiModelState.findUnique.mockImplementation(async (input) => {
      const identity = input.where.provider_model as {
        provider: string;
        model: string;
      };
      return modelStates.get(`${identity.provider}:${identity.model}`) ?? null;
    });
    prisma.aiModelState.updateMany.mockImplementation(async (input) => {
      const identity = input.where as { provider: string; model: string };
      const key = `${identity.provider}:${identity.model}`;
      const current = modelStates.get(key);
      if (!current) return { count: 0 };
      const increment = input.data.consecutiveFailures?.increment ?? 0;
      modelStates.set(key, {
        ...current,
        ...input.data,
        consecutiveFailures:
          (current.consecutiveFailures ?? 0) + Number(increment),
      });
      return { count: 1 };
    });
    prisma.aiModelState.create.mockImplementation(async (input) => {
      const key = `${input.data.provider}:${input.data.model}`;
      if (modelStates.has(key)) throw { code: "P2002" };
      modelStates.set(key, input.data as ModelState);
      return input.data;
    });
    const modelCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/models"))
          return Response.json({
            data: [{ id: "openai/gpt-oss-20b" }, { id: "openai/gpt-oss-120b" }],
          });
        const model = (JSON.parse(String(init?.body)) as { model: string })
          .model;
        modelCalls.push(model);
        return model === "openai/gpt-oss-20b"
          ? Response.json({ choices: [{ message: { content: "" } }] })
          : success("openai/gpt-oss-120b");
      }),
    );
    const gateway = new AiGatewayService(prisma as unknown as PrismaService);

    await gateway.executeJson(request("first task"));
    await gateway.executeJson(request("next task"));

    expect(modelCalls).toEqual([
      "openai/gpt-oss-20b",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-120b",
    ]);
    expect(modelStates.get("groq:openai/gpt-oss-20b")?.cooldownUntil).toEqual(
      new Date("2026-08-31T06:01:00.000Z"),
    );
    expect(prisma.aiProviderState.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "cooldown" }),
      }),
    );
  });

  it("uses one controlled probe when every eligible provider is in a transient cooldown", async () => {
    const groq = providerCases[3];
    configure(groq, "free");
    process.env.AI_PROVIDER_ORDER = "groq";
    process.env.AI_COOLDOWN_PROBE_INTERVAL_MS = "60000";
    const cooldownUntil = new Date(Date.now() + 10 * 60_000);
    const prisma = prismaMock();
    prisma.aiProviderState.findUnique.mockResolvedValue({
      cooldownUntil,
      lastErrorCode: "PROVIDER_ERROR",
    });
    prisma.aiModelState.findUnique.mockResolvedValue({
      cooldownUntil,
      lastErrorCode: "EMPTY_RESPONSE",
    });
    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/models"))
          return Response.json({
            data: [{ id: "openai/gpt-oss-20b" }],
          });
        chatCalls += 1;
        return success("openai/gpt-oss-20b", "cooldown-probe-ok");
      }),
    );
    const { gateway } = service(prisma);

    const result = await gateway.executeJson(request("cooldown probe"));

    expect(result.data.answerZh).toBe("cooldown-probe-ok");
    expect(chatCalls).toBe(1);
  });

  it.each([
    "AUTH",
    "CREDITS",
    "RATE_LIMIT",
    "FREE_QUOTA_BUDGET",
    "MODEL_NOT_AVAILABLE",
    "MODEL_CAPABILITY",
  ])("never probes a provider cooldown caused by %s", async (lastErrorCode) => {
    const groq = providerCases[3];
    configure(groq, "free");
    process.env.AI_PROVIDER_ORDER = "groq";
    const prisma = prismaMock();
    prisma.aiProviderState.findUnique.mockResolvedValue({
      cooldownUntil: new Date(Date.now() + 10 * 60_000),
      lastErrorCode,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { gateway } = service(prisma);

    const error = await gateway
      .executeJson(request(`provider cooldown ${lastErrorCode}`))
      .catch((value: unknown) => value);

    expect(
      (error as { getResponse(): { code: string } }).getResponse().code,
    ).toBe("AI_GATEWAY_ALL_PROVIDERS_COOLDOWN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "AUTH",
    "CREDITS",
    "RATE_LIMIT",
    "FREE_QUOTA_BUDGET",
    "MODEL_NOT_AVAILABLE",
    "MODEL_CAPABILITY",
  ])("never probes a model cooldown caused by %s", async (lastErrorCode) => {
    const groq = providerCases[3];
    configure(groq, "free");
    process.env.AI_PROVIDER_ORDER = "groq";
    process.env.AI_ROUTE_GROQ_ASSISTANT_CHAT = "openai/gpt-oss-20b";
    const prisma = prismaMock();
    prisma.aiModelState.findUnique.mockResolvedValue({
      cooldownUntil: new Date(Date.now() + 10 * 60_000),
      lastErrorCode,
    });
    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/models"))
          return Response.json({
            data: [{ id: "openai/gpt-oss-20b" }],
          });
        chatCalls += 1;
        return success("openai/gpt-oss-20b");
      }),
    );
    const { gateway } = service(prisma);

    const error = await gateway
      .executeJson(request(`model cooldown ${lastErrorCode}`))
      .catch((value: unknown) => value);

    expect(
      (error as { getResponse(): { code: string } }).getResponse().code,
    ).toBe("AI_GATEWAY_CAPACITY_COOLDOWN");
    expect(chatCalls).toBe(0);
  });

  it.each(["AUTH", "CREDITS", "RATE_LIMIT", "FREE_QUOTA_BUDGET"])(
    "skips a model that enters %s cooldown after candidate planning",
    async (lastErrorCode) => {
      const groq = providerCases[3];
      const fallbackModel = "openai/gpt-oss-120b";
      configure(groq, "free");
      process.env.GROQ_FREE_MODELS = `${groq.model}|${fallbackModel}`;
      process.env.AI_PROVIDER_ORDER = "groq";
      process.env.AI_ROUTE_GROQ_ASSISTANT_CHAT = `${groq.model}|${fallbackModel}`;
      const prisma = prismaMock();
      const modelReads = new Map<string, number>();
      prisma.aiModelState.findUnique.mockImplementation(
        async (args: { where: { provider_model: { model: string } } }) => {
          const model = args.where.provider_model.model;
          const reads = (modelReads.get(model) ?? 0) + 1;
          modelReads.set(model, reads);
          if (model === groq.model && reads > 1) {
            return {
              cooldownUntil: new Date(Date.now() + 10 * 60_000),
              lastErrorCode,
            };
          }
          return null;
        },
      );
      const chatModels: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          if (String(input).endsWith("/models"))
            return Response.json({
              data: [{ id: groq.model }, { id: fallbackModel }],
            });
          const body = JSON.parse(String(init?.body)) as { model: string };
          chatModels.push(body.model);
          return success(body.model, "fresh-cooldown-fallback");
        }),
      );
      const { gateway } = service(prisma);

      const result = await gateway.executeJson(
        request(`mid-flight cooldown ${lastErrorCode}`),
      );

      expect(result.model).toBe(fallbackModel);
      expect(result.data.answerZh).toBe("fresh-cooldown-fallback");
      expect(chatModels).toEqual([fallbackModel]);
      expect(modelReads.get(groq.model)).toBeGreaterThanOrEqual(2);
    },
  );

  it.each(["AUTH", "CREDITS", "RATE_LIMIT", "FREE_QUOTA_BUDGET"])(
    "cancels a controlled probe when its cooldown changes to %s",
    async (lastErrorCode) => {
      const groq = providerCases[3];
      configure(groq, "free");
      process.env.AI_PROVIDER_ORDER = "groq";
      process.env.AI_ROUTE_GROQ_ASSISTANT_CHAT = groq.model;
      const prisma = prismaMock();
      let modelReads = 0;
      prisma.aiModelState.findUnique.mockImplementation(async () => {
        modelReads += 1;
        return {
          cooldownUntil: new Date(Date.now() + 10 * 60_000),
          lastErrorCode: modelReads === 1 ? "EMPTY_RESPONSE" : lastErrorCode,
        };
      });
      let chatCalls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          if (String(input).endsWith("/models"))
            return Response.json({ data: [{ id: groq.model }] });
          chatCalls += 1;
          return success(groq.model);
        }),
      );
      const { gateway } = service(prisma);

      const error = await gateway
        .executeJson(request(`probe changed to ${lastErrorCode}`))
        .catch((value: unknown) => value);

      expect(
        (error as { getResponse(): { code: string } }).getResponse().code,
      ).toBe("AI_GATEWAY_CAPACITY_COOLDOWN");
      expect(chatCalls).toBe(0);
      expect(modelReads).toBeGreaterThanOrEqual(2);
    },
  );

  it("treats reasoning-only responses as empty and falls through to the next model", async () => {
    const groq = providerCases[3];
    configure(groq, "free");
    process.env.AI_PROVIDER_ORDER = "groq";
    process.env.AI_ROUTE_GROQ_ASSISTANT_CHAT =
      "openai/gpt-oss-20b|openai/gpt-oss-120b";
    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/models"))
          return Response.json({
            data: [{ id: "openai/gpt-oss-20b" }, { id: "openai/gpt-oss-120b" }],
          });
        chatCalls += 1;
        return chatCalls === 1
          ? Response.json({
              choices: [{ message: { reasoning: "internal", content: null } }],
            })
          : success("openai/gpt-oss-120b", "reasoning-fallback-ok");
      }),
    );
    const { gateway } = service();

    const result = await gateway.executeJson(request("reasoning only"));

    expect(result.data.answerZh).toBe("reasoning-fallback-ok");
    expect(chatCalls).toBe(2);
  });

  it("does not let an older concurrent success clear a newer cooldown", async () => {
    const bai = providerCases[0];
    configure(bai);
    process.env.AI_PROVIDER_ORDER = "bai";
    type MutableState = Record<string, unknown> & {
      updatedAt: Date;
      cooldownUntil?: Date | null;
    };
    let providerState: MutableState | null = null;
    let modelState: MutableState | null = null;
    const prisma = prismaMock();
    const newerTimestamp = new Date(Date.now() + 60_000);
    const expectedCooldown = new Date(Date.now() + 30 * 60_000);
    const stateMethods = (kind: "provider" | "model") => {
      const read = () => (kind === "provider" ? providerState : modelState);
      const write = (value: MutableState | null) => {
        if (kind === "provider") providerState = value;
        else modelState = value;
      };
      return {
        findUnique: vi.fn().mockImplementation(async () => read()),
        upsert: vi.fn().mockImplementation(async (input) => {
          const current = read();
          write({
            ...(current ?? {}),
            ...(current ? input.update : input.create),
            updatedAt: newerTimestamp,
          });
          return read();
        }),
        updateMany: vi.fn().mockImplementation(async (input) => {
          const current = read();
          const boundary = input.where.updatedAt?.lte as Date | undefined;
          if (!current || (boundary && current.updatedAt > boundary))
            return { count: 0 };
          const increment = input.data.consecutiveFailures?.increment ?? 0;
          write({
            ...current,
            ...input.data,
            consecutiveFailures:
              Number(current.consecutiveFailures ?? 0) + Number(increment),
            updatedAt: new Date(),
          });
          return { count: 1 };
        }),
        create: vi.fn().mockImplementation(async (input) => {
          if (read()) throw { code: "P2002" };
          write({ ...input.data, updatedAt: new Date() });
          return read();
        }),
      };
    };
    prisma.aiProviderState = stateMethods("provider");
    prisma.aiModelState = stateMethods("model");
    let releaseSlow: ((response: Response) => void) | undefined;
    let markSlowEntered: (() => void) | undefined;
    const slowEntered = new Promise<void>((resolve) => {
      markSlowEntered = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: "glm-5.3-flash" }] });
        const payload = JSON.parse(String(init?.body)) as {
          messages: Array<{ content: string }>;
        };
        if (
          payload.messages.some((message) => message.content === "slow-success")
        ) {
          markSlowEntered?.();
          return new Promise<Response>((resolve) => {
            releaseSlow = resolve;
          });
        }
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }),
    );
    const gateway = new AiGatewayService(prisma as unknown as PrismaService);
    const olderSuccess = gateway.executeJson(request("slow-success"));
    await slowEntered;

    await expect(
      gateway.executeJson(request("newer-auth-failure")),
    ).rejects.toMatchObject({ status: 503 });
    providerState = {
      ...(providerState ?? {}),
      status: "cooldown",
      cooldownUntil: expectedCooldown,
      updatedAt: newerTimestamp,
    };
    modelState = {
      ...(modelState ?? {}),
      status: "degraded",
      cooldownUntil: expectedCooldown,
      updatedAt: newerTimestamp,
    };
    releaseSlow?.(success("glm-5.3-flash"));

    await expect(olderSuccess).resolves.toMatchObject({ provider: "bai" });
    expect(providerState?.cooldownUntil).toEqual(expectedCooldown);
    expect(modelState?.cooldownUntil).toEqual(expectedCooldown);
  });

  it.each(["user_private", "sensitive_image"] as const)(
    "rejects Gemini free tier for %s data",
    async (dataClass) => {
      const gemini = providerCases[2];
      configure(gemini, "free");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const { gateway } = service();

      const error = await gateway
        .executeJson(request(dataClass, { dataClass, costPolicy: "free_only" }))
        .catch((value: unknown) => value);

      expect(
        (error as { getResponse(): { code: string } }).getResponse().code,
      ).toBe("AI_GATEWAY_DATA_POLICY_BLOCKED");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("defaults unspecified data to private and excludes Gemini free tier", async () => {
    const gemini = providerCases[2];
    configure(gemini, "free");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { gateway } = service();

    const error = await gateway
      .executeJson(
        request("implicit-private", {
          dataClass: undefined,
          costPolicy: "free_only",
        }),
      )
      .catch((value: unknown) => value);

    expect(
      (error as { getResponse(): { code: string } }).getResponse().code,
    ).toBe("AI_GATEWAY_DATA_POLICY_BLOCKED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["user_private", "sensitive_image"] as const)(
    "rejects NVIDIA trial routing for %s data",
    async (dataClass) => {
      const nvidia = providerCases[5];
      configure(nvidia);
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const { gateway } = service();

      const error = await gateway
        .executeJson(request(dataClass, { dataClass }))
        .catch((value: unknown) => value);

      expect(
        (error as { getResponse(): { code: string } }).getResponse().code,
      ).toBe("AI_GATEWAY_DATA_POLICY_BLOCKED");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("allows public market data on Gemini free tier", async () => {
    const gemini = providerCases[2];
    configure(gemini, "free");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/models")
          ? Response.json({ data: [{ id: `models/${gemini.model}` }] })
          : success(gemini.model),
      ),
    );
    const { gateway } = service();

    const result = await gateway.executeJson(
      request("public", { costPolicy: "free_only" }),
    );

    expect(result.provider).toBe("gemini");
  });

  it("does not cache or persist private prompts and outputs", async () => {
    const bai = providerCases[0];
    configure(bai, "paid");
    process.env.BAI_PAID_MODELS = bai.model;
    process.env.BAI_PRICING_VERIFIED_AT = new Date().toISOString();
    process.env.BAI_PRIVATE_DATA_AUTHORIZED = "true";
    process.env.AI_PROVIDER_ORDER = "bai";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/models")
          ? Response.json({ data: [{ id: bai.model }] })
          : success(bai.model, "private-output-must-not-be-persisted"),
      ),
    );
    const { gateway, prisma } = service();

    await gateway.executeJson(
      request("private-prompt-must-not-be-persisted", {
        dataClass: "user_private",
        costPolicy: "paid_allowed",
        bypassCache: false,
      }),
    );

    expect(prisma.aiCache.findUnique).not.toHaveBeenCalled();
    expect(prisma.aiCache.upsert).not.toHaveBeenCalled();
    const persistedInputs = prisma.aiRun.create.mock.calls.map(
      ([call]) => call.data.input,
    );
    expect(persistedInputs).not.toHaveLength(0);
    for (const input of persistedInputs) {
      expect(input).toMatchObject({
        redacted: true,
        dataClass: "user_private",
        messageCount: 1,
        imageCount: 0,
      });
      expect(JSON.stringify(input)).not.toContain(
        "private-prompt-must-not-be-persisted",
      );
    }
    const succeeded = prisma.aiRun.update.mock.calls.find(
      ([call]) => call.data.status === "succeeded",
    )?.[0];
    expect(succeeded?.data).not.toHaveProperty("output");
    expect(JSON.stringify(succeeded?.data)).not.toContain(
      "private-output-must-not-be-persisted",
    );
  });

  it("redacts sensitive image URLs from every AI run attempt", async () => {
    const cloudflare = providerCases[7];
    const visionModel = "@cf/meta/llama-3.2-11b-vision-instruct";
    configure(cloudflare, "free");
    process.env.CLOUDFLARE_AI_FREE_MODELS = visionModel;
    process.env.CLOUDFLARE_AI_PRIVATE_DATA_AUTHORIZED = "true";
    process.env.AI_PROVIDER_ORDER = "cloudflare";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/models/search")
          ? Response.json({ result: [{ name: visionModel }] })
          : success(visionModel),
      ),
    );
    const { gateway, prisma } = service();
    const privateImageUrl = "https://images.example.test/private-secret.jpg";

    await gateway.executeJson(
      request("analyze private image", {
        task: "image_analysis",
        dataClass: "sensitive_image",
        costPolicy: "free_only",
        imageUrls: [privateImageUrl],
      }),
    );

    for (const [call] of prisma.aiRun.create.mock.calls) {
      expect(call.data.input).toMatchObject({
        redacted: true,
        dataClass: "sensitive_image",
        imageCount: 1,
      });
      expect(JSON.stringify(call.data.input)).not.toContain(privateImageUrl);
    }
  });

  it("filters and orders models according to each cost policy", async () => {
    const openrouter = providerCases[1];
    configure(openrouter);
    process.env.AI_PROVIDER_ORDER = "openrouter";
    const requestedModels: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/models"))
          return Response.json({
            data: [
              { id: "deepseek/deepseek-v4-flash" },
              { id: "z-ai/glm-5.2:free" },
            ],
          });
        const body = JSON.parse(String(init?.body)) as { model: string };
        requestedModels.push(body.model);
        return success(body.model);
      }),
    );
    const { gateway } = service();

    await gateway.executeJson(
      request("free-only", { costPolicy: "free_only" }),
    );
    await gateway.executeJson(
      request("free-first", { costPolicy: "free_first" }),
    );
    await gateway.executeJson(request("paid", { costPolicy: "paid_allowed" }));

    expect(requestedModels).toEqual([
      "z-ai/glm-5.2:free",
      "z-ai/glm-5.2:free",
      "deepseek/deepseek-v4-flash",
    ]);
  });

  it("requires both paid controls and caps request policy at the global policy", async () => {
    const openrouter = providerCases[1];
    configure(openrouter);
    process.env.AI_PROVIDER_ORDER = "openrouter";
    const requestedModels: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/models"))
          return Response.json({
            data: [
              { id: "deepseek/deepseek-v4-flash" },
              { id: "z-ai/glm-5.2:free" },
            ],
          });
        const model = (JSON.parse(String(init?.body)) as { model: string })
          .model;
        requestedModels.push(model);
        return success(model);
      }),
    );
    const { gateway } = service();

    delete process.env.AI_ALLOW_PAID_MODELS;
    delete process.env.AI_COST_POLICY;
    await gateway.executeJson(
      request("missing-controls", { costPolicy: "paid_allowed" }),
    );
    process.env.AI_ALLOW_PAID_MODELS = "yes";
    process.env.AI_COST_POLICY = "paid_allowed";
    await gateway.executeJson(
      request("invalid-paid-switch", { costPolicy: "paid_allowed" }),
    );
    process.env.AI_ALLOW_PAID_MODELS = "true";
    process.env.AI_COST_POLICY = "free_only";
    await gateway.executeJson(
      request("global-free-cap", { costPolicy: "paid_allowed" }),
    );
    process.env.AI_COST_POLICY = "paid_allowed";
    await gateway.executeJson(
      request("paid-explicit", { costPolicy: "paid_allowed" }),
    );

    expect(requestedModels).toEqual([
      "z-ai/glm-5.2:free",
      "z-ai/glm-5.2:free",
      "z-ai/glm-5.2:free",
      "deepseek/deepseek-v4-flash",
    ]);
  });

  it("invalidates a provider catalogue immediately after a model 404", async () => {
    const groq = providerCases[3];
    configure(groq, "free");
    process.env.AI_PROVIDER_ORDER = "groq";
    let catalogueCalls = 0;
    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/models")) {
          catalogueCalls += 1;
          return Response.json({
            data: [{ id: "openai/gpt-oss-20b" }, { id: "openai/gpt-oss-120b" }],
          });
        }
        chatCalls += 1;
        return chatCalls === 1
          ? Response.json({ error: "model not found" }, { status: 404 })
          : success("openai/gpt-oss-120b");
      }),
    );
    const { gateway } = service();

    await gateway.executeJson(request("catalogue-404-a"));
    await gateway.executeJson(request("catalogue-404-b"));

    expect(catalogueCalls).toBe(2);
  });

  it("fails a provider closed when its catalogue is unavailable and uses another provider", async () => {
    const cloudflare = providerCases[7];
    const groq = providerCases[3];
    configure(cloudflare, "free");
    configure(groq, "paid");
    process.env.GROQ_PAID_MODELS = groq.model;
    process.env.GROQ_PRICING_VERIFIED_AT = new Date().toISOString();
    process.env.AI_PROVIDER_ORDER = "cloudflare|groq";
    let cloudflareChatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/models/search"))
          return Response.json(
            { error: "catalogue unavailable" },
            { status: 503 },
          );
        if (url.startsWith(groq.url) && url.endsWith("/models"))
          return Response.json({ data: [{ id: groq.model }] });
        if (url.startsWith(cloudflare.url)) {
          cloudflareChatCalls += 1;
          return success(cloudflare.model);
        }
        return success(groq.model);
      }),
    );
    const { gateway, prisma } = service();

    // Cloudflare is the free tier candidate and therefore precedes the paid
    // direct fallback regardless of the stable same-tier rotation seed.
    const result = await gateway.executeJson(
      request("catalogue fail closed 0", { costPolicy: "free_first" }),
    );

    expect(result.provider).toBe("groq");
    expect(cloudflareChatCalls).toBe(0);
    expect(prisma.aiRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "cloudflare",
          errorCode: "CATALOGUE_UNAVAILABLE",
        }),
      }),
    );
  });

  it("routes image requests only to a verified visual model", async () => {
    const groq = providerCases[3];
    configure(groq, "free");
    process.env.AI_PROVIDER_ORDER = "groq";
    process.env.AI_ROUTE_GROQ_ASSISTANT_CHAT =
      "openai/gpt-oss-20b|qwen/qwen3.8-27b";
    let requestedModel = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/models"))
          return Response.json({
            data: [{ id: "openai/gpt-oss-20b" }, { id: "qwen/qwen3.8-27b" }],
          });
        requestedModel = (JSON.parse(String(init?.body)) as { model: string })
          .model;
        return success(requestedModel);
      }),
    );
    const { gateway } = service();

    await gateway.executeJson(
      request("vision", { imageUrls: ["https://example.test/item.jpg"] }),
    );

    expect(requestedModel).toBe("qwen/qwen3.8-27b");
  });

  it("uses provider-qualified identities for cooldown and catalogue state", async () => {
    expect(modelStateKey("bai", "same-name")).not.toBe(
      modelStateKey("groq", "same-name"),
    );
    const groq = providerCases[3];
    configure(groq, "free");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/models")
          ? Response.json({ data: [{ id: "openai/gpt-oss-20b" }] })
          : success("openai/gpt-oss-20b"),
      ),
    );
    const { gateway, prisma } = service();

    const catalogue = await gateway.availableModelIds();
    await gateway.executeJson(request("state-key"));

    expect(catalogue).toContain("groq:openai/gpt-oss-20b");
    expect(prisma.aiModelState.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_model: {
            provider: "groq",
            model: "openai/gpt-oss-20b",
          },
        },
      }),
    );
  });

  it("reserves deadline time fairly for every untried provider", async () => {
    vi.useFakeTimers();
    for (const provider of providerCases.slice(0, 6))
      configure(provider, "free");
    process.env.AI_PROVIDER_ORDER =
      "bai|gemini|groq|siliconflow|nvidia|openrouter";
    process.env.AI_GATEWAY_DEADLINE_MS = "60000";
    const chatHosts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/models")) {
          const current = providerCases.find((entry) =>
            url.startsWith(entry.url),
          );
          return Response.json({
            data: current
              ? [
                  {
                    id:
                      current.provider === "gemini"
                        ? `models/${current.model}`
                        : current.model,
                  },
                ]
              : [],
          });
        }
        chatHosts.push(new URL(url).host);
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => {
            const error = new Error("timed out");
            error.name = "AbortError";
            reject(error);
          };
          init?.signal?.addEventListener("abort", abort, { once: true });
        });
      }),
    );
    const { gateway } = service();
    const pending = gateway
      .executeJson(request("fair deadline"))
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(60_100);
    const error = await pending;

    expect(new Set(chatHosts.slice(0, 6)).size).toBe(6);
    expect(
      (
        error as { getResponse(): { code: string; deadlineMs: number } }
      ).getResponse(),
    ).toEqual(expect.objectContaining({ deadlineMs: 60_000 }));
  });

  it("shares one deadline slice across every model from the same provider", async () => {
    vi.useFakeTimers();
    const groq = providerCases[3];
    const gemini = providerCases[2];
    const secondGroqModel = "openai/gpt-oss-120b";
    configure(groq, "free");
    configure(gemini, "paid");
    process.env.GROQ_FREE_MODELS = `${groq.model}|${secondGroqModel}`;
    process.env.AI_ROUTE_GROQ_ASSISTANT_CHAT = `${groq.model}|${secondGroqModel}`;
    process.env.GEMINI_PAID_MODELS = gemini.model;
    process.env.GEMINI_PRICING_VERIFIED_AT = new Date().toISOString();
    process.env.AI_PROVIDER_ORDER = "groq|gemini";
    process.env.AI_GATEWAY_DEADLINE_MS = "30000";
    const startedAt = Date.now();
    const chatAttempts: Array<{ model: string; at: number }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/models"))
          return Response.json({
            data: url.startsWith(groq.url)
              ? [{ id: groq.model }, { id: secondGroqModel }]
              : [{ id: `models/${gemini.model}` }],
          });
        const model = (JSON.parse(String(init?.body)) as { model: string })
          .model;
        chatAttempts.push({ model, at: Date.now() - startedAt });
        if (url.startsWith(gemini.url))
          return success(gemini.model, "provider-budget-fallback-ok");
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("timed out");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      }),
    );
    const { gateway } = service();
    const pending = gateway.executeJson(
      request("provider deadline slice", { costPolicy: "free_first" }),
    );

    await vi.advanceTimersByTimeAsync(30_100);
    const result = await pending;

    expect(result.data.answerZh).toBe("provider-budget-fallback-ok");
    expect(chatAttempts.map((entry) => entry.model)).toEqual([
      groq.model,
      gemini.model,
    ]);
    expect(chatAttempts.at(-1)?.at).toBeLessThanOrEqual(15_100);
  });

  it("adds deterministic bounded jitter to short HTTP retry delays", () => {
    expect(httpRetryDelayMs(1, 0)).toBe(400);
    expect(httpRetryDelayMs(1, 0.5)).toBe(500);
    expect(httpRetryDelayMs(1, 1)).toBe(600);
    expect(httpRetryDelayMs(2, 0)).toBe(800);
    expect(httpRetryDelayMs(2, 1)).toBe(1_200);
    expect(httpRetryDelayMs(99, 99)).toBe(1_200);
  });

  it("uses jitter once, retries at most twice, and succeeds within the deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.75);
    const groq = providerCases[3];
    configure(groq, "free");
    process.env.AI_PROVIDER_ORDER = "groq";
    process.env.AI_ROUTE_GROQ_ASSISTANT_CHAT = "openai/gpt-oss-20b";
    process.env.AI_HTTP_RETRIES = "2";
    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: "openai/gpt-oss-20b" }] });
        chatCalls += 1;
        return chatCalls === 1
          ? Response.json({ error: "temporary" }, { status: 500 })
          : success("openai/gpt-oss-20b", "retry-ok");
      }),
    );
    const { gateway } = service();
    const pending = gateway.executeJson(request("jitter retry"));

    await vi.advanceTimersByTimeAsync(549);
    expect(chatCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual(
      expect.objectContaining({
        data: { answerZh: "retry-ok" },
        provider: "groq",
      }),
    );
    expect(chatCalls).toBe(2);
    expect(Math.random).toHaveBeenCalledTimes(1);
  });

  it("does not start a second HTTP attempt when jitter would cross the deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
    const groq = providerCases[3];
    configure(groq, "free");
    process.env.AI_PROVIDER_ORDER = "groq";
    process.env.AI_ROUTE_GROQ_ASSISTANT_CHAT = "openai/gpt-oss-20b";
    process.env.AI_HTTP_RETRIES = "2";
    process.env.AI_GATEWAY_DEADLINE_MS = "30000";
    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: "openai/gpt-oss-20b" }] });
        chatCalls += 1;
        return new Promise<Response>((resolve) => {
          setTimeout(
            () =>
              resolve(Response.json({ error: "temporary" }, { status: 500 })),
            29_700,
          );
        });
      }),
    );
    const { gateway } = service();
    const pending = gateway
      .executeJson(request("deadline jitter"))
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(30_100);
    const error = await pending;

    expect(chatCalls).toBe(1);
    expect(
      (error as { getResponse(): { code: string } }).getResponse().code,
    ).toBe("AI_GATEWAY_DEADLINE_EXCEEDED");
  });

  it("keeps the absolute gateway deadline capped at 240 seconds", () => {
    process.env.AI_GATEWAY_DEADLINE_MS = "999999";
    const { gateway } = service();

    expect(
      (
        gateway as unknown as { gatewayDeadlineMs(): number }
      ).gatewayDeadlineMs(),
    ).toBe(240_000);
  });

  it("stops execution with a structured error at the global deadline", async () => {
    vi.useFakeTimers();
    const groq = providerCases[3];
    configure(groq, "free");
    process.env.AI_PROVIDER_ORDER = "groq";
    process.env.AI_GATEWAY_DEADLINE_MS = "30000";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: "openai/gpt-oss-20b" }] });
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("timed out");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      }),
    );
    const { gateway } = service();
    const pending = gateway
      .executeJson(request("absolute-deadline"))
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(30_100);
    const response = (
      (await pending) as { getResponse(): Record<string, unknown> }
    ).getResponse();

    expect(response).toEqual(
      expect.objectContaining({
        code: "AI_GATEWAY_DEADLINE_EXCEEDED",
        deadlineMs: 30_000,
        retryable: true,
      }),
    );
  });

  it("refreshes catalogues in parallel and negatively caches failures", async () => {
    const gemini = providerCases[2];
    const groq = providerCases[3];
    configure(gemini, "free");
    configure(groq, "free");
    const started: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      started.push(String(input));
      throw new TypeError("catalogue unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { gateway } = service();

    const first = await gateway.availableModelIds();
    const second = await gateway.availableModelIds();

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(started).toHaveLength(2);
    expect(started.map((url) => new URL(url).host)).toEqual(
      expect.arrayContaining(["gemini.test", "groq.test"]),
    );
  });

  it("retains failed provider catalogue evidence when another provider succeeds", async () => {
    configure(providerCases[2], "free");
    process.env.OVO_API_KEY = "test-ovo-key";
    process.env.OVO_INTERNAL_EVALUATION = "true";
    process.env.AI_PROVIDER_ORDER = "gemini|ovo";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (new URL(String(input)).host === "gemini.test")
        throw new TypeError("catalogue unavailable");
      return Response.json({ data: [{ id: "Astra" }] });
    }));
    const { gateway } = service();

    const first = await gateway.providerCatalogueSnapshot();
    const cached = await gateway.providerCatalogueSnapshot();

    expect(first).toEqual([
      { provider: "gemini", models: undefined, evidence: "catalogue_unavailable" },
      { provider: "ovo", models: new Set(["Astra"]), evidence: "live_catalogue" },
    ]);
    expect(cached).toEqual(first);
    expect(await gateway.availableModelIds()).toEqual(new Set(["ovo:Astra"]));
  });

  it("bounds a hanging catalogue request with the short catalogue timeout", async () => {
    vi.useFakeTimers();
    const groq = providerCases[3];
    configure(groq, "free");
    process.env.AI_CATALOG_TIMEOUT_MS = "500";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                const error = new Error("catalogue timeout");
                error.name = "AbortError";
                reject(error);
              },
              { once: true },
            );
          }),
      ),
    );
    const { gateway } = service();
    const pending = gateway.availableModelIds();

    await vi.advanceTimersByTimeAsync(600);

    await expect(pending).resolves.toBeUndefined();
  });

  it("forces Groq temperature to zero", async () => {
    const groq = providerCases[3];
    configure(groq, "free");
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: "openai/gpt-oss-20b" }] });
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return success("openai/gpt-oss-20b");
      }),
    );
    const { gateway } = service();

    await gateway.executeJson(request("temperature", { temperature: 0.8 }));

    expect(body.temperature).toBe(0);
  });

  it("retains OpenRouter attribution headers", async () => {
    const openrouter = providerCases[1];
    configure(openrouter);
    process.env.OPENROUTER_SITE_URL = "https://procurement.test";
    process.env.OPENROUTER_APP_NAME = "Kamen Procurement Test";
    let headers = new Headers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: "z-ai/glm-5.2:free" }] });
        headers = new Headers(init?.headers);
        return success("z-ai/glm-5.2:free");
      }),
    );
    const { gateway } = service();

    await gateway.executeJson(request("headers"));

    expect(headers.get("HTTP-Referer")).toBe("https://procurement.test");
    expect(headers.get("X-Title")).toBe("Kamen Procurement Test");
  });

  it("records Cloudflare Neurons and checks the local free allocation", async () => {
    const cloudflare = providerCases[7];
    configure(cloudflare, "free");
    process.env.AI_PROVIDER_ORDER = "cloudflare";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/models/search")
          ? Response.json({ result: [{ name: cloudflare.model }] })
          : Response.json({
              model: cloudflare.model,
              choices: [
                { message: { content: JSON.stringify({ answerZh: "可用" }) } },
              ],
              usage: {
                prompt_tokens: 24,
                completion_tokens: 10,
                neurons: 12.5,
              },
            }),
      ),
    );
    const { gateway, prisma } = service();

    const result = await gateway.executeJson(request("Cloudflare usage"));

    expect(result.provider).toBe("cloudflare");
    expect(prisma.aiRun.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: "cloudflare",
          providerUsage: { not: null },
        }),
        _sum: { providerUsage: true },
      }),
    );
    expect(prisma.aiRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ providerUsage: 12.5 }),
      }),
    );
  });

  it("uses the Cloudflare reservation when a successful response omits Neurons", async () => {
    const cloudflare = providerCases[7];
    configure(cloudflare, "free");
    process.env.AI_PROVIDER_ORDER = "cloudflare";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/models/search")
          ? Response.json({ result: [{ name: cloudflare.model }] })
          : success(cloudflare.model),
      ),
    );
    const { gateway, prisma } = service();

    await gateway.executeJson(request("Cloudflare usage fallback"));

    const succeededRun = prisma.aiRun.update.mock.calls.find(
      ([input]) => input.data?.status === "succeeded",
    )?.[0];
    expect(succeededRun?.data.providerUsage).toEqual(expect.any(Number));
    expect(succeededRun?.data.providerUsage).toBeGreaterThan(0);
  });

  it("persists the Cloudflare reservation when provider content fails validation", async () => {
    const cloudflare = providerCases[7];
    configure(cloudflare, "free");
    process.env.AI_PROVIDER_ORDER = "cloudflare";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/models/search")
          ? Response.json({ result: [{ name: cloudflare.model }] })
          : Response.json({
              model: cloudflare.model,
              choices: [{ message: { content: "not-json" } }],
              usage: { prompt_tokens: 4, completion_tokens: 2 },
            }),
      ),
    );
    const { gateway, prisma } = service();

    await gateway
      .executeJson(request("Cloudflare invalid JSON usage"))
      .catch(() => undefined);

    const failedRun = prisma.aiRun.update.mock.calls.find(
      ([input]) => input.data?.status === "failed",
    )?.[0];
    expect(failedRun?.data.providerUsage).toEqual(expect.any(Number));
    expect(failedRun?.data.providerUsage).toBeGreaterThan(0);
  });

  it.each([3041, 5016, 5018, 5035])(
    "keeps Cloudflare model-access error %s from cooling the whole provider",
    async (errorCode) => {
      const cloudflare = providerCases[7];
      configure(cloudflare, "free");
      process.env.AI_PROVIDER_ORDER = "cloudflare";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) =>
          String(input).includes("/models/search")
            ? Response.json({
                result: [{ name: "@cf/meta/llama-3.2-11b-vision-instruct" }],
              })
            : Response.json(
                {
                  success: false,
                  errors: [
                    {
                      code: errorCode,
                      message: "Model agreement has not been accepted",
                    },
                  ],
                },
                { status: 403 },
              ),
        ),
      );
      const { gateway, prisma } = service();

      const error = await gateway
        .executeJson(
          request("Cloudflare vision agreement", {
            task: "image_analysis",
            imageUrls: ["https://images.example.test/item.png"],
          }),
        )
        .catch((value: unknown) => value);

      expect(
        (error as { getResponse(): { attempts: Array<{ code: string }> } })
          .getResponse()
          .attempts.map((attempt) => attempt.code),
      ).toContain("MODEL_NOT_AVAILABLE");
      expect(prisma.aiProviderState.updateMany).not.toHaveBeenCalled();
      expect(prisma.aiModelState.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastErrorCode: "MODEL_NOT_AVAILABLE",
          }),
        }),
      );
    },
  );

  it("fails closed before Cloudflare can exceed the local free daily budget", async () => {
    const cloudflare = providerCases[7];
    configure(cloudflare, "free");
    process.env.AI_PROVIDER_ORDER = "cloudflare";
    process.env.CLOUDFLARE_AI_DAILY_NEURON_BUDGET = "8000";
    const prisma = prismaMock();
    prisma.aiRun.aggregate.mockResolvedValue({
      _sum: { providerUsage: 7_999 },
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/models/search"))
        return Response.json({ result: [{ name: cloudflare.model }] });
      return success(cloudflare.model);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { gateway } = service(prisma);

    const error = await gateway
      .executeJson(request("Cloudflare budget"))
      .catch((value: unknown) => value);

    expect(
      (error as { getResponse(): { attempts: Array<{ code: string }> } })
        .getResponse()
        .attempts.map((attempt) => attempt.code),
    ).toContain("FREE_QUOTA_BUDGET");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prisma.aiProviderState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastErrorCode: "FREE_QUOTA_BUDGET",
          remainingTokens: 1,
        }),
      }),
    );
  });

  it("keeps NVIDIA trial credentials out of production unless authorized", () => {
    const nvidia = providerCases[5];
    configure(nvidia);
    delete process.env.NVIDIA_INTERNAL_EVALUATION;
    process.env.NODE_ENV = "production";
    const blocked = service().gateway.configuredProviderIds();
    process.env.NVIDIA_PRODUCTION_AUTHORIZED = "true";
    const authorized = service().gateway.configuredProviderIds();

    expect(blocked).not.toContain("nvidia");
    expect(authorized).toContain("nvidia");
  });
});

describe("AI task timeout budgets", () => {
  it("gives complete background translation more time without slowing public chat fallback", () => {
    delete process.env.AI_BACKGROUND_MODEL_TIMEOUT_MS;
    process.env.AI_MODEL_TIMEOUT_MS = "30000";

    expect(modelTimeoutForTask("translation")).toBe(45_000);
    expect(modelTimeoutForTask("classification")).toBe(45_000);
    expect(modelTimeoutForTask("assistant_chat")).toBe(30_000);
  });
});
