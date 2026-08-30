import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma.service.js";
import { AiGatewayService } from "./ai-gateway.service.js";
import { modelStateKey } from "./ai-router.js";

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
    url: "https://bai.test/v1",
    model: "glm-5.3-flash",
  },
  {
    provider: "openrouter",
    key: "OPENROUTER_API_KEY",
    urlKey: "OPENROUTER_API_URL",
    url: "https://openrouter.test/api/v1",
    model: "z-ai/glm-5.2:free",
  },
  {
    provider: "gemini",
    key: "GEMINI_API_KEY",
    urlKey: "GEMINI_API_URL",
    url: "https://gemini.test/v1beta/openai",
    model: "gemini-3.7-flash",
    tierKey: "GEMINI_API_TIER",
  },
  {
    provider: "groq",
    key: "GROQ_API_KEY",
    urlKey: "GROQ_API_URL",
    url: "https://groq.test/openai/v1",
    model: "openai/gpt-oss-20b",
    tierKey: "GROQ_API_TIER",
  },
  {
    provider: "siliconflow",
    key: "SILICONFLOW_API_KEY",
    urlKey: "SILICONFLOW_API_URL",
    url: "https://silicon.test/v1",
    model: "Qwen/Qwen2.5-7B-Instruct",
  },
  {
    provider: "nvidia",
    key: "NVIDIA_API_KEY",
    urlKey: "NVIDIA_API_URL",
    url: "https://nvidia.test/v1",
    model: "nvidia/nemotron-3-nano-30b-a3b",
  },
  {
    provider: "cerebras",
    key: "CEREBRAS_API_KEY",
    urlKey: "CEREBRAS_API_URL",
    url: "https://cerebras.test/v1",
    model: "gpt-oss-120b",
    tierKey: "CEREBRAS_API_TIER",
  },
  {
    provider: "cloudflare",
    key: "CLOUDFLARE_AI_API_TOKEN",
    urlKey: "CLOUDFLARE_AI_API_URL",
    url: "https://cloudflare.test/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1",
    model: "@cf/zai-org/glm-4.7-flash",
    tierKey: "CLOUDFLARE_AI_API_TIER",
  },
  {
    provider: "cohere",
    key: "COHERE_API_KEY",
    urlKey: "COHERE_API_URL",
    url: "https://cohere.test/compatibility/v1",
    model: "command-a-plus-05-2026",
    tierKey: "COHERE_API_TIER",
  },
] as const;

const originalEnvironment = { ...process.env };

function clearProviderEnvironment() {
  for (const name of [
    "BAI_API_KEY",
    "OPENROUTER_API_KEY",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "SILICONFLOW_API_KEY",
    "CEREBRAS_API_KEY",
    "CLOUDFLARE_AI_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "COHERE_API_KEY",
    "NVIDIA_API_KEY",
    "NVIDIA_INTERNAL_EVALUATION",
    "COHERE_INTERNAL_EVALUATION",
    "COHERE_PRODUCTION_AUTHORIZED",
    "AI_PROVIDER_ORDER",
    "AI_PROVIDER_ORDER_ASSISTANT_CHAT",
    "AI_ROUTE_GROQ_ASSISTANT_CHAT",
    "AI_ALLOW_PAID_MODELS",
    "AI_COST_POLICY",
  ])
    delete process.env[name];
}

function configure(
  provider: (typeof providerCases)[number],
  tier: "free" | "paid" | "unknown" = "unknown",
) {
  process.env[provider.key] = `test-${provider.provider}-key`;
  process.env[provider.urlKey] = provider.url;
  if (provider.provider === "nvidia")
    process.env.NVIDIA_INTERNAL_EVALUATION = "true";
  if (provider.provider === "cloudflare")
    process.env.CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
  if (provider.provider === "cohere")
    process.env.COHERE_INTERNAL_EVALUATION = "true";
  if ("tierKey" in provider && provider.tierKey)
    process.env[provider.tierKey] = tier;
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

  it.each(providerCases)(
    "works when only $provider is configured",
    async (provider) => {
      configure(provider, "free");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
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
            ? [{ id: "models/gemini-3.7-flash" }]
            : [{ id: "openai/gpt-oss-20b" }],
        });
      return url.startsWith(gemini.url)
        ? success("gemini-3.7-flash")
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
      expect(prisma.aiProviderState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ lastErrorCode: expectedCode }),
        }),
      );
    },
  );

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
    expect(prisma.aiProviderState.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ lastErrorCode: "RATE_LIMIT" }),
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
    expect(prisma.aiProviderState.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ lastErrorCode: "RATE_LIMIT" }),
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

    const failureUpdate = prisma.aiModelState.upsert.mock.calls.find(
      ([input]) => input.update?.lastErrorCode === expectedCode,
    )?.[0];
    expect(failureUpdate?.update.cooldownUntil).toBeInstanceOf(Date);
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
          const boundary = input.where.updatedAt.lte as Date;
          if (!current || current.updatedAt > boundary) return { count: 0 };
          write({ ...current, ...input.data, updatedAt: new Date() });
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
      ).toBe("AI_GATEWAY_NO_ELIGIBLE_MODEL");
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
    ).toBe("AI_GATEWAY_NO_ELIGIBLE_MODEL");
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
      ).toBe("AI_GATEWAY_NO_ELIGIBLE_MODEL");
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
          ? Response.json({ data: [{ id: "models/gemini-3.7-flash" }] })
          : success("gemini-3.7-flash"),
      ),
    );
    const { gateway } = service();

    const result = await gateway.executeJson(
      request("public", { costPolicy: "free_only" }),
    );

    expect(result.provider).toBe("gemini");
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
    configure(groq, "free");
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

    // This input's stable rotation seed keeps Cloudflare first in the declared
    // two-provider order, so the test exercises failover instead of early Groq success.
    const result = await gateway.executeJson(
      request("catalogue fail closed 0"),
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
            imageUrls: ["data:image/png;base64,AA=="],
          }),
        )
        .catch((value: unknown) => value);

      expect(
        (error as { getResponse(): { attempts: Array<{ code: string }> } })
          .getResponse()
          .attempts.map((attempt) => attempt.code),
      ).toContain("MODEL_NOT_AVAILABLE");
      expect(prisma.aiProviderState.upsert).not.toHaveBeenCalled();
      expect(prisma.aiModelState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
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
    expect(prisma.aiProviderState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
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
