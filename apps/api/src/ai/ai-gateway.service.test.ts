import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma.service.js";
import {
  AiGatewayService,
  httpRetryDelayMs,
  modelTimeoutForTask,
} from "./ai-gateway.service.js";
import { modelStateKey } from "./ai-router.js";
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
  const mock = {
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
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation(
    async (callback: (tx: unknown) => unknown) => callback(mock),
  );
  return mock;
}

type ProviderCase = {
  provider: string;
  key: string;
  urlKey: string;
  customEndpointAuthorizationKey: string;
  url: string;
  model: string;
  tierKey?: string;
};

const providerCases: readonly ProviderCase[] = [
  {
    provider: "zhipu",
    key: "ZHIPU_API_KEY",
    urlKey: "ZHIPU_API_URL",
    customEndpointAuthorizationKey: "ZHIPU_CUSTOM_ENDPOINT_AUTHORIZED",
    url: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.3-flash",
  },
];

const originalEnvironment = { ...process.env };

function clearProviderEnvironment() {
  for (const name of [
    "ZHIPU_API_KEY",
    "ZHIPU_API_URL",
    "ZHIPU_API_TIER",
    "ZHIPU_CUSTOM_ENDPOINT_AUTHORIZED",
    "ZHIPU_PRIVATE_DATA_AUTHORIZED",
    "AI_ALLOW_CUSTOM_PROVIDER_ENDPOINTS",
    "AI_PROVIDER_ORDER",
    "AI_HTTP_RETRIES",
    "AI_MODEL_TIMEOUT_MS",
    "AI_BACKGROUND_MODEL_TIMEOUT_MS",
    "AI_GATEWAY_DEADLINE_MS",
    "AI_CATALOG_TIMEOUT_MS",
    "AI_ALLOW_PAID_MODELS",
    "AI_COST_POLICY",
    ...providerCases.map((provider) => provider.customEndpointAuthorizationKey),
  ])
    delete process.env[name];
}

function configure(
  provider: ProviderCase,
  tier: "free" | "paid" | "unknown" = "unknown",
) {
  process.env[provider.key] = `test-${provider.provider}-key`;
  process.env[provider.urlKey] = provider.url;
  process.env[provider.customEndpointAuthorizationKey] = "true";
  const prefix = provider.provider.toUpperCase();
  const tierEnv =
    "tierKey" in provider && provider.tierKey
      ? provider.tierKey
      : `${prefix}_API_TIER`;
  process.env[tierEnv] = tier;
  if (tier === "free") {
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

describe("AiGatewayService", () => {
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

  it.each(providerCases)(
    "works when only $provider is configured",
    async (provider) => {
      configure(provider, "free");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          expect(init?.redirect).toBe("error");
          const url = String(input);
          if (url.includes("/models"))
            return Response.json({ data: [{ id: provider.model }] });
          return success(provider.model);
        }),
      );
      const { gateway } = service();

      const result = await gateway.executeJson(request(provider.provider));

      expect(result.provider).toBe(provider.provider);
      expect(result.model).toBe(provider.model);
    },
  );

  it("reports OUTPUT_SCHEMA_INVALID when every called model violates the contract", async () => {
    const zhipu = providerCases[0];
    configure(zhipu, "free");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/models")
          ? Response.json({ data: [{ id: zhipu.model }] })
          : Response.json({
              model: zhipu.model,
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
    const zhipu = providerCases[0];
    const providerOutputMarker = "provider-output-must-not-leak";
    configure(zhipu, "free");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/models")
          ? Response.json({ data: [{ id: zhipu.model }] })
          : Response.json({
              model: zhipu.model,
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

  it("serves a valid public cache while its provider is cooling down", async () => {
    const zhipu = providerCases[0];
    configure(zhipu, "free");
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
          return Response.json({ data: [{ id: zhipu.model }] });
        chatCalls += 1;
        return Response.json({
          model: zhipu.model,
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

  it("classifies ordinary network failures without persisting their message", async () => {
    const zhipu = providerCases[0];
    const sensitiveText = "synthetic-secret-must-never-be-persisted";
    configure(zhipu, "paid");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: zhipu.model }] });
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

  it("puts a 503 provider outage into a long circuit cooldown", async () => {
    const zhipu = providerCases[0];
    configure(zhipu);
    process.env.AI_PROVIDER_5XX_COOLDOWN_MS = "900000";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/models")
          ? Response.json({ data: [{ id: zhipu.model }] })
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

  it("retains both failures when another request creates each health-state row first", async () => {
    const zhipu = providerCases[0];
    configure(zhipu, "free");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/models")
          ? Response.json({ data: [{ id: zhipu.model }] })
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

  it("adds deterministic bounded jitter to short HTTP retry delays", () => {
    expect(httpRetryDelayMs(1, 0)).toBe(400);
    expect(httpRetryDelayMs(1, 0.5)).toBe(500);
    expect(httpRetryDelayMs(1, 1)).toBe(600);
    expect(httpRetryDelayMs(2, 0)).toBe(800);
    expect(httpRetryDelayMs(2, 1)).toBe(1_200);
    expect(httpRetryDelayMs(99, 99)).toBe(1_200);
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
