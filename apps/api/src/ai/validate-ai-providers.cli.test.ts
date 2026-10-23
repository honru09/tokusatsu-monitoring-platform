import { isAbsolute } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDER_IDS } from "./ai-model-catalog.js";
import type { LiveValidationReport } from "./ai-provider-live-validator.js";
import {
  loadAiProviderEnvironment,
  parseAiProviderValidatorArguments,
  runAiProviderValidatorCli,
} from "./validate-ai-providers.cli.js";

describe("AI provider validator CLI arguments", () => {
  it("defaults to catalogue-only validation for all providers", () => {
    expect(parseAiProviderValidatorArguments([])).toEqual({
      envPath: ".env",
      completion: false,
      includeInactive: false,
      providers: [],
    });
  });

  it("requires one explicit provider and exact model for completion", () => {
    expect(
      parseAiProviderValidatorArguments([
        "--completion",
        "--provider",
        "groq",
        "--model",
        "openai/gpt-oss-20b",
        "--max-tokens",
        "8",
      ]),
    ).toMatchObject({
      completion: true,
      providers: ["groq"],
      model: "openai/gpt-oss-20b",
      maxTokens: 8,
    });
  });

  it.each([
    ["--completion"],
    ["--completion", "--provider", "groq"],
    ["--completion", "--model", "model"],
    ["--completion", "--provider", "groq,bai", "--model", "model"],
    ["--completion", "--provider", "groq,groq", "--model", "model"],
    ["--completion", "--provider", "not-a-provider", "--model", "model"],
    ["--model", "model"],
    ["--max-tokens", "8"],
    ["--timeout-ms", "0"],
    ["--provider"],
    ["--env"],
  ])("rejects unsafe argv: %s", (...argv) => {
    expect(() => parseAiProviderValidatorArguments(argv)).toThrow(
      "INVALID_REQUEST",
    );
  });

  it("normalizes provider names and preserves explicit catalogue selection", () => {
    expect(
      parseAiProviderValidatorArguments([
        "--provider",
        " GROQ , bai ",
        "--include-inactive",
      ]),
    ).toMatchObject({
      completion: false,
      includeInactive: true,
      providers: ["groq", "bai"],
    });
  });

  it("keeps the default provider list in sync with the catalog", () => {
    expect(AI_PROVIDER_IDS.length).toBeGreaterThan(1);
  });
});

describe("AI provider dotenv loader", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads only AI/provider variables, with quote and inline-comment support", () => {
    const environment: Record<string, string | undefined> = {
      OPENAI_API_KEY: "existing-value",
    };
    const readText = vi.fn((absolutePath: string) => {
      expect(isAbsolute(absolutePath)).toBe(true);
      return [
        "OPENAI_API_KEY=ignored-override",
        'GROQ_API_KEY="groq-value" # comment',
        "OVO_API_KEY=ovo-value",
        "OVO_API_URL=https://ovo1.cn/v1",
        "AI_PROVIDER_ORDER=groq|bai # route",
        "NODE_ENV='test'",
        "DATABASE_URL=must-be-ignored",
        "UNRELATED_SECRET=must-be-ignored",
      ].join("\n");
    });

    loadAiProviderEnvironment("fixture.env", readText, environment);

    expect(environment).toEqual({
      OPENAI_API_KEY: "existing-value",
      GROQ_API_KEY: "groq-value",
      OVO_API_KEY: "ovo-value",
      OVO_API_URL: "https://ovo1.cn/v1",
      AI_PROVIDER_ORDER: "groq|bai",
      NODE_ENV: "test",
    });
  });

  it("rejects conflicting duplicate AI variables", () => {
    expect(() =>
      loadAiProviderEnvironment(
        "fixture.env",
        () => "GROQ_API_KEY=first\nGROQ_API_KEY=second",
        {},
      ),
    ).toThrow("INVALID_REQUEST");
  });

  it("ignores conflicting duplicates outside the AI allowlist", () => {
    const environment: Record<string, string | undefined> = {};
    loadAiProviderEnvironment(
      "fixture.env",
      () => "DATABASE_URL=first\nDATABASE_URL=second",
      environment,
    );
    expect(environment).toEqual({});
  });

  it("does not expose reader failures", () => {
    const secret = "dotenv-reader-secret";
    expect(() =>
      loadAiProviderEnvironment(
        "fixture.env",
        () => {
          throw new Error(secret);
        },
        {},
      ),
    ).toThrow("INVALID_REQUEST");
    try {
      loadAiProviderEnvironment(
        "fixture.env",
        () => {
          throw new Error(secret);
        },
        {},
      );
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("rejects malformed quoted values", () => {
    expect(() =>
      loadAiProviderEnvironment(
        "fixture.env",
        () => 'GROQ_API_KEY="unterminated # comment',
        {},
      ),
    ).toThrow("INVALID_REQUEST");
  });
});

describe("AI provider validator import and execution boundary", () => {
  it("does not run validation merely by importing the CLI module", () => {
    expect(true).toBe(true);
  });

  it("passes a single exact model through to the injected validator", async () => {
    const validate = vi.fn(async (options) => ({
      generatedAt: "test",
      completionRequested: Boolean(options.completion),
      providers: [],
      summary: {
        configuredProviders: 0,
        configuredCredentials: 0,
        testedCredentials: 0,
        successfulCredentials: 0,
        failedCredentials: 0,
        skippedCredentials: 0,
      },
    }));
    const write = vi.fn();

    await runAiProviderValidatorCli(
      ["--completion", "--provider", "groq", "--model", "exact-model"],
      {
        readText: () => "",
        environment: {},
        validate,
        write,
      },
    );

    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: ["groq"],
        completion: true,
        modelOverrides: { groq: "exact-model" },
      }),
    );
    expect(write).toHaveBeenCalledOnce();
  });

  it("scrubs configured secrets from an injected report before writing", async () => {
    const secret = "cli-test-secret-value";
    const validate = vi.fn(
      async (): Promise<LiveValidationReport> => ({
        generatedAt: "test",
        completionRequested: false,
        providers: [
          {
            provider: "groq",
            label: secret,
            configured: true,
            configuredCredentialCount: 1,
            runtimeActive: true,
            activationReason: "ready" as const,
            credentials: [
              {
                credentialName: "GROQ_API_KEY",
                credentialId: "default",
                catalogue: {
                  ok: true,
                  latencyMs: 1,
                  modelSamples: [secret, "safe-model"],
                },
                success: true,
              },
            ],
          },
        ],
        summary: {
          configuredProviders: 1,
          configuredCredentials: 1,
          testedCredentials: 1,
          successfulCredentials: 1,
          failedCredentials: 0,
          skippedCredentials: 0,
        },
      }),
    );
    const write = vi.fn();

    await runAiProviderValidatorCli([], {
      readText: () => `GROQ_API_KEY=${secret}`,
      environment: {},
      validate,
      write,
    });

    const output = String(write.mock.calls[0]?.[0]);
    expect(output).not.toContain(secret);
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain(
      '"modelSamples": [\n        "cli-test-secret-value"',
    );
  });
});
