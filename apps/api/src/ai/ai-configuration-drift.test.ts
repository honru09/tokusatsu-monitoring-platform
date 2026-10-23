import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_PROVIDER_IDS,
  PROVIDER_MODEL_ALLOWLIST,
  type AiProvider,
} from "./ai-model-catalog.js";
import {
  AI_ROUTE_REVISION,
  providerRoutesForDisplay,
  type AiTask,
} from "./ai-router.js";

const TASKS = [
  "bulk_filter",
  "translation",
  "classification",
  "image_analysis",
  "seller_analysis",
  "complex_analysis",
  "cross_validation",
  "market_analysis",
  "crawler_diagnosis",
  "logistics_analysis",
  "assistant_chat",
] as const satisfies readonly AiTask[];

const TASK_NAMES = new Set<string>(TASKS);

function repositoryFile(path: string) {
  return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

function unquote(value: string) {
  const trimmed = value.trim();
  const first = trimmed[0];
  return (first === '"' || first === "'") && trimmed.at(-1) === first
    ? trimmed.slice(1, -1)
    : trimmed;
}

function dotenvAssignments(source: string) {
  const assignments = new Map<string, string>();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match?.[1] != null && match[2] != null)
      assignments.set(match[1], unquote(match[2]));
  }
  return assignments;
}

function renderAssignments(source: string) {
  const assignments = new Map<string, string>();
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const key = lines[index]?.match(
      /^\s*-\s+key:\s*([A-Z][A-Z0-9_]*)\s*$/,
    )?.[1];
    if (!key) continue;
    const value = lines[index + 1]?.match(/^\s+value:\s*(.*?)\s*$/)?.[1];
    if (value != null) assignments.set(key, unquote(value));
  }
  return assignments;
}

function powershellAssignments(source: string) {
  const assignments = new Map<string, string>();
  for (const match of source.matchAll(
    /Set-Env(?:ValueIfEmpty|Default|Value)\s+\$content\s+'([A-Z][A-Z0-9_]*)'\s+'([^']*)'/g,
  )) {
    if (match[1] != null && match[2] != null)
      assignments.set(match[1], match[2]);
  }
  return assignments;
}

const assignmentSources = [
  {
    name: ".env.example",
    assignments: dotenvAssignments(repositoryFile(".env.example")),
  },
  {
    name: "render.yaml",
    assignments: renderAssignments(repositoryFile("render.yaml")),
  },
  {
    name: "sync-ai-secrets.ps1",
    assignments: powershellAssignments(
      repositoryFile("scripts/sync-ai-secrets.ps1"),
    ),
  },
] as const;

function routeEnvironmentName(task: AiTask, provider: AiProvider) {
  return provider === "bai"
    ? `AI_ROUTE_${task.toUpperCase()}`
    : `AI_ROUTE_${provider.toUpperCase()}_${task.toUpperCase()}`;
}

function routeDescriptor(
  name: string,
): { provider: AiProvider; task: AiTask } | undefined {
  if (!name.startsWith("AI_ROUTE_")) return undefined;
  const suffix = name.slice("AI_ROUTE_".length);
  const directProvider = AI_PROVIDER_IDS.filter(
    (provider) => provider !== "bai",
  )
    .sort((left, right) => right.length - left.length)
    .find((provider) => suffix.startsWith(`${provider.toUpperCase()}_`));
  const provider: AiProvider = directProvider ?? "bai";
  const task = directProvider
    ? suffix.slice(directProvider.length + 1).toLowerCase()
    : suffix.toLowerCase();
  return TASK_NAMES.has(task) ? { provider, task: task as AiTask } : undefined;
}

function models(value: string) {
  return value
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const providerOrderNames = [
  "AI_PROVIDER_ORDER",
  ...TASKS.map((task) => `AI_PROVIDER_ORDER_${task.toUpperCase()}`),
];

const routingEnvironmentNames = [
  ...providerOrderNames,
  ...AI_PROVIDER_IDS.flatMap((provider) =>
    TASKS.map((task) => routeEnvironmentName(task, provider)),
  ),
  "AI_ALLOW_PAID_MODELS",
  "AI_PAID_PROVIDER_ALLOWLIST",
];

function withoutConfiguredRouting<T>(run: () => T) {
  const previous = new Map(
    routingEnvironmentNames.map((name) => [name, process.env[name]]),
  );
  try {
    for (const name of routingEnvironmentNames) delete process.env[name];
    return run();
  } finally {
    for (const [name, value] of previous) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe("AI configuration drift", () => {
  it("uses the Gemini live-probe route revision and keeps every router route in the model catalog", () => {
    expect(AI_ROUTE_REVISION).toBe("gemini-live-probe-20260907-v10");
    const routes = withoutConfiguredRouting(() => providerRoutesForDisplay());
    const intentionallyEmpty = new Set([
      "nvidia:image_analysis",
      "sensenova:image_analysis",
    ]);

    for (const provider of AI_PROVIDER_IDS) {
      expect(PROVIDER_MODEL_ALLOWLIST[provider].size).toBeGreaterThan(0);
      for (const task of TASKS) {
        const configured = routes[provider][task];
        if (configured.length === 0) {
          expect(intentionallyEmpty).toContain(`${provider}:${task}`);
          continue;
        }
        expect(
          configured.some((model) =>
            PROVIDER_MODEL_ALLOWLIST[provider].has(model),
          ),
        ).toBe(true);
        expect(
          configured.filter(
            (model) => !PROVIDER_MODEL_ALLOWLIST[provider].has(model),
          ),
        ).toEqual([]);
      }
    }
  });

  it.each(assignmentSources)(
    "$name keeps every non-empty configured route in the model catalog",
    ({ assignments }) => {
      let configuredRouteCount = 0;
      for (const [name, value] of assignments) {
        const descriptor = routeDescriptor(name);
        if (!descriptor) continue;
        configuredRouteCount += 1;
        const configured = models(value);
        if (configured.length === 0) continue;
        const allowlist = PROVIDER_MODEL_ALLOWLIST[descriptor.provider];
        const unrestricted = configured.includes("*");
        if (unrestricted) expect(descriptor.provider).toBe("ovo");
        const pinned = configured.filter((model) => model !== "*");
        if (pinned.length > 0)
          expect(pinned.some((model) => allowlist.has(model))).toBe(true);
        expect(pinned.filter((model) => !allowlist.has(model))).toEqual([]);
      }
      expect(configuredRouteCount).toBeGreaterThan(0);
    },
  );

  it("keeps every deployment source Gemini-first for text and OVO-only for images", () => {
    for (const { assignments } of assignmentSources) {
      for (const name of providerOrderNames) {
        expect(assignments.has(name)).toBe(true);
        const order = models(assignments.get(name) ?? "");
        expect(order).toEqual(
          name === "AI_PROVIDER_ORDER_IMAGE_ANALYSIS"
            ? ["ovo"]
            : ["gemini", "ovo"],
        );
      }
      expect(assignments.get("GEMINI_MODEL")).toBe("gemini-3.1-flash-lite");
      expect(assignments.get("AI_COST_POLICY")).toBe("free_first");
      expect(assignments.get("AI_PUBLIC_COST_POLICY")).toBe("free_first");
      expect(assignments.get("AI_ALLOW_PAID_MODELS")).toBe("true");
      expect(assignments.get("AI_PAID_PROVIDER_ALLOWLIST")).toBe("ovo");
      for (const task of TASKS) {
        expect(
          models(assignments.get(routeEnvironmentName(task, "ovo")) ?? ""),
        ).toEqual(["*"]);
        expect(
          models(assignments.get(routeEnvironmentName(task, "gemini")) ?? ""),
        ).toEqual([
          task === "image_analysis"
            ? "gemini-3.7-flash"
            : "gemini-3.1-flash-lite",
        ]);
      }
    }
  });

  it("keeps SenseNova and OpenRouter current preferences aligned", () => {
    const routerRoutes = withoutConfiguredRouting(() =>
      providerRoutesForDisplay(),
    );
    for (const { name, assignments } of assignmentSources) {
      for (const provider of ["sensenova", "openrouter"] as const) {
        for (const task of TASKS) {
          const environmentName = routeEnvironmentName(task, provider);
          const configuredValue = assignments.get(environmentName);
          if (configuredValue == null) {
            // Render intentionally inherits Router defaults instead of freezing
            // another copy of all direct-provider model identifiers.
            expect(name).toBe("render.yaml");
            continue;
          }
          expect(models(configuredValue)[0]).toBe(
            routerRoutes[provider][task][0],
          );
        }
      }
      expect(assignments.get("SENSENOVA_API_URL")).toBe(
        "https://token.sensenova.cn/v1",
      );
      expect(assignments.get("OPENROUTER_API_URL")).toBe(
        "https://openrouter.ai/api/v1",
      );
    }
  });

  it.each(assignmentSources)(
    "$name keeps the cooldown probe cadence explicit",
    ({ assignments }) => {
      expect(assignments.get("AI_COOLDOWN_PROBE_INTERVAL_MS")).toBe("60000");
    },
  );

  it("keeps the Cerebras account switch aligned with the time-limited Free Trial", () => {
    const syncScript = repositoryFile("scripts/sync-ai-secrets.ps1");
    expect(syncScript).toContain("[Alias('EnableVerifiedCerebrasFreeTier')]");
    expect(syncScript).toContain("$EnableVerifiedCerebrasFreeTrial");
    expect(syncScript).toContain(
      "Set-EnvValue $content 'CEREBRAS_API_TIER' 'promotion'",
    );
    expect(syncScript).not.toContain("if ($EnableVerifiedCerebrasFreeTier)");
    expect(syncScript).not.toContain(
      "Set-EnvValue $content 'CEREBRAS_API_TIER' 'free'",
    );
  });

  it("keeps the local AI Gateway deployment profile explicit and opt-in", () => {
    const deploy = repositoryFile("scripts/deploy.ps1");
    expect(deploy).toMatch(/\[switch\]\$EnableAiGateway/);
    expect(deploy).toContain("@('--profile', 'ai-gateway')");
    expect(deploy).toContain("& docker @composeArguments");
  });

  it("keeps LiteLLM text aliases on independent upstream quota pools", () => {
    const syncScript = repositoryFile("scripts/sync-ai-secrets.ps1");
    const liteLlmConfig = repositoryFile(
      "infrastructure/litellm/config.example.yaml",
    );

    expect(syncScript).toMatch(
      /if \(\$geminiConfigured\) \{[\s\S]{0,500}LITELLM_FAST_MODEL' 'gemini\/gemini-3\.5-flash-lite'/,
    );
    expect(syncScript).toMatch(
      /if \(\$groqConfigured\) \{[\s\S]{0,500}LITELLM_SMART_MODEL' 'groq\/openai\/gpt-oss-120b'/,
    );
    expect(liteLlmConfig).toContain("- smart: [fast]");
  });
});
