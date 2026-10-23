import { isAbsolute } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  validateUpstreamApiKeys,
  type UpstreamLiveValidationReport,
  type UpstreamProvider,
} from "./upstream-key-live-validator.js";
import {
  loadUpstreamEnvironment,
  parseUpstreamValidatorArguments,
} from "./validate-upstream-keys.cli.js";

const TEST_CREDENTIALS = {
  openai: "test-openai-credential",
  anthropic: "test-anthropic-credential",
  deepseek: "test-deepseek-credential",
} as const;

type CompletionCase = {
  provider: UpstreamProvider;
  model: string;
  catalogueUrl: string;
  completionUrl: string;
  expectedHeaders: Record<string, string>;
  expectedBody: Record<string, unknown>;
  response: Record<string, unknown>;
};

const COMPLETION_CASES: CompletionCase[] = [
  {
    provider: "openai",
    model: "openai-test-model",
    catalogueUrl: "https://api.openai.com/v1/models",
    completionUrl: "https://api.openai.com/v1/responses",
    expectedHeaders: {
      authorization: `Bearer ${TEST_CREDENTIALS.openai}`,
    },
    expectedBody: {
      model: "openai-test-model",
      input: "Reply with OK.",
      max_output_tokens: 7,
      store: false,
    },
    response: {
      output: [{}],
      usage: { input_tokens: 11, output_tokens: 2 },
    },
  },
  {
    provider: "anthropic",
    model: "anthropic-test-model",
    catalogueUrl: "https://api.anthropic.com/v1/models?limit=1000",
    completionUrl: "https://api.anthropic.com/v1/messages",
    expectedHeaders: {
      "anthropic-version": "2023-06-01",
      "x-api-key": TEST_CREDENTIALS.anthropic,
    },
    expectedBody: {
      model: "anthropic-test-model",
      max_tokens: 7,
      messages: [{ role: "user", content: "Reply with OK." }],
    },
    response: {
      content: [{}],
      usage: { input_tokens: 11, output_tokens: 2 },
    },
  },
  {
    provider: "deepseek",
    model: "deepseek-test-model",
    catalogueUrl: "https://api.deepseek.com/models",
    completionUrl: "https://api.deepseek.com/chat/completions",
    expectedHeaders: {
      authorization: `Bearer ${TEST_CREDENTIALS.deepseek}`,
    },
    expectedBody: {
      model: "deepseek-test-model",
      messages: [{ role: "user", content: "Reply with OK." }],
      max_tokens: 7,
      stream: false,
    },
    response: {
      choices: [{}],
      usage: { prompt_tokens: 11, completion_tokens: 2 },
    },
  },
];

function serialized(report: UpstreamLiveValidationReport) {
  return JSON.stringify(report);
}

describe("upstream API key live validator", () => {
  it("defaults to catalogue-only probes for all three upstreams", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).toBeUndefined();
        expect(init?.body).toBeUndefined();
        expect(init?.redirect).toBe("error");
        return Response.json({ data: [{ id: "catalogue-test-model" }] });
      },
    );

    const report = await validateUpstreamApiKeys({
      credentials: TEST_CREDENTIALS,
      fetch: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.openai.com/v1/models",
      "https://api.anthropic.com/v1/models?limit=1000",
      "https://api.deepseek.com/models",
    ]);
    expect(report.results.map((result) => result.variableName)).toEqual([
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "DEEPSEEK_API_KEY",
    ]);
    expect(report.results.every((result) => !result.completion)).toBe(true);
  });

  it.each(COMPLETION_CASES)(
    "uses the exact $provider catalogue and completion protocol",
    async ({
      provider,
      model,
      catalogueUrl,
      completionUrl,
      expectedHeaders,
      expectedBody,
      response,
    }) => {
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          expect(init?.redirect).toBe("error");
          if (String(input) === catalogueUrl) {
            expect(init?.method).toBeUndefined();
            return Response.json({ data: [{ id: model }] });
          }
          expect(String(input)).toBe(completionUrl);
          expect(init?.method).toBe("POST");
          const headers = new Headers(init?.headers);
          expect(headers.get("accept")).toBe("application/json");
          expect(headers.get("content-type")).toBe("application/json");
          for (const [name, value] of Object.entries(expectedHeaders)) {
            expect(headers.get(name)).toBe(value);
          }
          expect(JSON.parse(String(init?.body))).toEqual(expectedBody);
          return Response.json(response);
        },
      );

      const report = await validateUpstreamApiKeys({
        providers: [provider],
        completion: true,
        model,
        maxTokens: 7,
        credentials: TEST_CREDENTIALS,
        fetch: fetchMock,
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(report.results[0]?.completion).toEqual({
        model,
        status: "OK",
        latencyMs: expect.any(Number),
        inputTokens: 11,
        outputTokens: 2,
      });
    },
  );

  it("does not fall back when the exact completion model is absent", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ data: [{ id: "different-model" }] }),
    );

    const report = await validateUpstreamApiKeys({
      providers: ["openai"],
      completion: true,
      model: "required-exact-model",
      credentials: TEST_CREDENTIALS,
      fetch: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(report.results[0]?.completion).toEqual({
      model: "required-exact-model",
      status: "MODEL_NOT_FOUND",
      latencyMs: 0,
    });
  });

  it.each([
    [401, "AUTH"],
    [403, "AUTH"],
    [402, "CREDITS"],
    [408, "TIMEOUT"],
    [429, "RATE_LIMIT"],
    [400, "INVALID_REQUEST"],
    [422, "INVALID_REQUEST"],
    [500, "PROVIDER_ERROR"],
    [503, "PROVIDER_ERROR"],
  ] as const)("classifies HTTP %i as %s", async (httpStatus, status) => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: `must-not-escape-${TEST_CREDENTIALS.openai}` },
        { status: httpStatus },
      ),
    );

    const report = await validateUpstreamApiKeys({
      providers: ["openai"],
      credentials: TEST_CREDENTIALS,
      fetch: fetchMock,
    });

    expect(report.results[0]?.catalogue).toMatchObject({
      models: [],
      status,
    });
    expect(serialized(report)).not.toContain(TEST_CREDENTIALS.openai);
    expect(serialized(report)).not.toContain("must-not-escape");
  });

  it.each([
    ["TimeoutError", "TIMEOUT"],
    ["AbortError", "TIMEOUT"],
    ["Error", "NETWORK"],
  ] as const)("classifies %s exceptions as %s", async (name, status) => {
    const failure = Object.assign(
      new Error(`must-not-escape-${TEST_CREDENTIALS.openai}`),
      { name },
    );
    const fetchMock = vi.fn(async () => {
      throw failure;
    });

    const report = await validateUpstreamApiKeys({
      providers: ["openai"],
      credentials: TEST_CREDENTIALS,
      fetch: fetchMock,
    });

    expect(report.results[0]?.catalogue.status).toBe(status);
    expect(serialized(report)).not.toContain(TEST_CREDENTIALS.openai);
    expect(serialized(report)).not.toContain("must-not-escape");
  });

  it.each([
    new Response("not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    Response.json({ unexpected: true }),
  ])("rejects malformed successful catalogue responses", async (response) => {
    const fetchMock = vi.fn(async () => response.clone());
    const report = await validateUpstreamApiKeys({
      providers: ["openai"],
      credentials: TEST_CREDENTIALS,
      fetch: fetchMock,
    });

    expect(report.results[0]?.catalogue.status).toBe("INVALID_RESPONSE");
  });

  it.each([
    { data: [{}] },
    { data: [{ id: "model\nwith-control" }] },
    { data: [{ id: "x".repeat(513) }] },
  ])("rejects malformed catalogue entries", async (payload) => {
    const fetchMock = vi.fn(async () => Response.json(payload));
    const report = await validateUpstreamApiKeys({
      providers: ["openai"],
      credentials: TEST_CREDENTIALS,
      fetch: fetchMock,
    });

    expect(report.results[0]?.catalogue.status).toBe("INVALID_RESPONSE");
    expect(serialized(report)).not.toContain("model\nwith-control");
  });

  it("rejects malformed successful completion responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [{ id: "exact-model" }] }))
      .mockResolvedValueOnce(Response.json({ unexpected: true }));

    const report = await validateUpstreamApiKeys({
      providers: ["openai"],
      completion: true,
      model: "exact-model",
      credentials: TEST_CREDENTIALS,
      fetch: fetchMock,
    });

    expect(report.results[0]?.completion?.status).toBe("INVALID_RESPONSE");
  });

  it.each([{ output: [] }, { output: [{}], usage: { input_tokens: -1 } }])(
    "rejects empty output while keeping optional usage bounded",
    async (body) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ data: [{ id: "exact-model" }] }))
        .mockResolvedValueOnce(Response.json(body));

      const report = await validateUpstreamApiKeys({
        providers: ["openai"],
        completion: true,
        model: "exact-model",
        credentials: TEST_CREDENTIALS,
        fetch: fetchMock,
      });

      expect(report.results[0]?.completion?.status).toBe(
        body.output.length === 0 ? "INVALID_RESPONSE" : "OK",
      );
    },
  );

  it("removes secrets echoed as model IDs and never retains generated text", async () => {
    const secret = TEST_CREDENTIALS.openai;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: `echo-${secret}` }, { id: "exact-model" }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          output: [{ content: [{ text: `echo-${secret}` }] }],
          usage: { input_tokens: 3, output_tokens: 1 },
        }),
      );

    const report = await validateUpstreamApiKeys({
      providers: ["openai"],
      completion: true,
      model: "exact-model",
      credentials: TEST_CREDENTIALS,
      fetch: fetchMock,
    });

    expect(report.results[0]?.catalogue.models).toEqual(["exact-model"]);
    expect(report.results[0]?.completion?.status).toBe("OK");
    expect(serialized(report)).not.toContain(secret);
    expect(Object.keys(report)).toEqual(["results"]);
    expect(Object.keys(report.results[0] ?? {}).sort()).toEqual(
      ["catalogue", "completion", "variableName"].sort(),
    );
    expect(Object.keys(report.results[0]?.catalogue ?? {}).sort()).toEqual(
      ["latencyMs", "models", "status"].sort(),
    );
    expect(Object.keys(report.results[0]?.completion ?? {}).sort()).toEqual(
      ["inputTokens", "latencyMs", "model", "outputTokens", "status"].sort(),
    );
  });

  it("filters another configured upstream secret echoed by the catalogue", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [
          { id: `prefix-${TEST_CREDENTIALS.anthropic}` },
          { id: "safe-model" },
        ],
      }),
    );

    const report = await validateUpstreamApiKeys({
      providers: ["openai"],
      credentials: TEST_CREDENTIALS,
      fetch: fetchMock,
    });

    expect(report.results[0]?.catalogue.models).toEqual(["safe-model"]);
    expect(serialized(report)).not.toContain(TEST_CREDENTIALS.anthropic);
  });

  it.each([
    { completion: true },
    { completion: true, providers: ["openai"] as const },
    {
      completion: true,
      providers: ["openai", "anthropic"] as const,
      model: "exact-model",
    },
    { providers: ["openai", "openai"] as const },
    { model: "exact-model" },
    { providers: ["unknown" as UpstreamProvider] },
  ])("rejects unsafe library options before fetching", async (unsafe) => {
    const fetchMock = vi.fn();

    await expect(
      validateUpstreamApiKeys({
        ...unsafe,
        credentials: TEST_CREDENTIALS,
        fetch: fetchMock,
      }),
    ).rejects.toThrow("INVALID_REQUEST");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("upstream validator CLI", () => {
  it("defaults to catalogue-only validation", () => {
    expect(parseUpstreamValidatorArguments([])).toEqual({
      envPath: ".env",
      completion: false,
      providers: ["openai", "anthropic", "deepseek"],
      model: undefined,
      timeoutMs: undefined,
      maxTokens: undefined,
    });
  });

  it("accepts one explicit provider and one exact completion model", () => {
    expect(
      parseUpstreamValidatorArguments([
        "--completion",
        "--provider",
        "openai",
        "--model",
        "exact-model",
        "--timeout-ms",
        "2500",
        "--max-tokens",
        "5",
      ]),
    ).toMatchObject({
      completion: true,
      providers: ["openai"],
      model: "exact-model",
      timeoutMs: 2500,
      maxTokens: 5,
    });
  });

  it.each([
    ["--completion", "--model", "exact-model"],
    ["--completion", "--provider", "openai"],
    [
      "--completion",
      "--provider",
      "openai,anthropic",
      "--model",
      "exact-model",
    ],
    ["--completion", "--provider", "openai,openai", "--model", "exact-model"],
    ["--completion", "--provider", "unknown", "--model", "exact-model"],
    ["--model", "exact-model"],
    ["--max-tokens", "4"],
  ])("rejects unsafe arguments: %s", (...argv) => {
    expect(() => parseUpstreamValidatorArguments(argv)).toThrow(
      "INVALID_REQUEST",
    );
  });

  it("loads only allow-listed variables through an injected text reader", () => {
    const environment: Record<string, string | undefined> = {
      OPENAI_API_KEY: "existing-process-value",
    };
    const readText = vi.fn((absolutePath: string) => {
      expect(isAbsolute(absolutePath)).toBe(true);
      return [
        "OPENAI_API_KEY=rejected-file-override",
        'ANTHROPIC_API_KEY="test-anthropic-value"',
        'DEEPSEEK_API_KEY="test-deepseek-value" # local comment',
        "UNRELATED_SECRET=must-be-ignored",
      ].join("\n");
    });

    loadUpstreamEnvironment("fixture.env", readText, environment);

    expect(readText).toHaveBeenCalledOnce();
    expect(environment).toEqual({
      OPENAI_API_KEY: "existing-process-value",
      ANTHROPIC_API_KEY: "test-anthropic-value",
      DEEPSEEK_API_KEY: "test-deepseek-value",
    });
  });

  it("rejects conflicting duplicate allow-listed variables", () => {
    expect(() =>
      loadUpstreamEnvironment(
        "fixture.env",
        () =>
          [
            "OPENAI_API_KEY=first-test-value",
            "OPENAI_API_KEY=second-test-value",
          ].join("\n"),
        {},
      ),
    ).toThrow("INVALID_REQUEST");
  });

  it("rejects malformed quoted values instead of retaining quote syntax", () => {
    expect(() =>
      loadUpstreamEnvironment(
        "fixture.env",
        () => 'OPENAI_API_KEY="unterminated # comment',
        {},
      ),
    ).toThrow("INVALID_REQUEST");
  });

  it("normalizes reader failures without exposing their message", () => {
    const secret = "reader-secret-value";
    let thrown: unknown;
    try {
      loadUpstreamEnvironment(
        "fixture.env",
        () => {
          throw new Error(secret);
        },
        {},
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(new Error("INVALID_REQUEST"));
    expect(String(thrown)).not.toContain(secret);
  });
});
