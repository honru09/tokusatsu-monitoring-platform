import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_PROVIDER_IDS,
  AI_SCOPED_TASKS,
  AI_TASKS,
  PROVIDER_MODEL_ALLOWLIST,
  ZHIPU_MODEL,
} from "./ai-model-catalog.js";
import { AI_ROUTE_REVISION, providerRoutesForDisplay } from "./ai-router.js";

// This suite guards the one living configuration surface: ai-config.ts is
// the single source of truth for providers, models and routes, and
// .env.example is the operator-facing copy of that world. The retired
// Render/Windows deployment artifacts (render.yaml, scripts/*.ps1, the
// LiteLLM profile) described the old multi-provider deployment and are no
// longer compared here; they are scheduled for removal with the legacy
// provider code.

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

const envExample = dotenvAssignments(repositoryFile(".env.example"));

const routingEnvironmentNames = [
  "AI_PROVIDER_ORDER",
  ...AI_TASKS.map((task) => `AI_PROVIDER_ORDER_${task.toUpperCase()}`),
  ...AI_TASKS.map((task) => `AI_ROUTE_ZHIPU_${task.toUpperCase()}`),
  "AI_ALLOW_PAID_MODELS",
  "AI_PAID_PROVIDER_ALLOWLIST",
  "AI_EXTENDED_SCOPES_ENABLED",
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
  it("uses the Zhipu-scoped route revision and keeps every router route in the model catalog", () => {
    expect(AI_ROUTE_REVISION).toBe("zhipu-scoped-20261009-v1");
    expect(AI_PROVIDER_IDS).toEqual(["zhipu"]);
    const routes = withoutConfiguredRouting(() => providerRoutesForDisplay());
    const allowlist = PROVIDER_MODEL_ALLOWLIST.zhipu;
    expect(allowlist.size).toBeGreaterThan(0);

    for (const task of AI_TASKS) {
      const configured = routes.zhipu[task];
      expect(
        configured.filter((model) => !allowlist.has(model)),
      ).toEqual([]);
      if (AI_SCOPED_TASKS.includes(task)) {
        // Scoped tasks are the ones the free Zhipu package serves today.
        expect(configured).toEqual([ZHIPU_MODEL]);
      } else {
        // Everything else stays unrouted while the extended scopes are
        // switched off (AI_EXTENDED_SCOPES_ENABLED defaults to off).
        expect(configured).toEqual([]);
      }
    }
  });

  it(".env.example describes the same single-provider, free-only world", () => {
    expect(envExample.get("AI_PROVIDER_ORDER")).toBe("zhipu");
    expect(envExample.get("AI_COST_POLICY")).toBe("free_only");
    expect(envExample.get("AI_PUBLIC_COST_POLICY")).toBe("free_only");
    expect(envExample.get("AI_ALLOW_PAID_MODELS")).toBe("false");
    expect(envExample.get("AI_PUBLIC_ALLOW_PAID_MODELS")).toBe("false");
    expect(envExample.get("ZHIPU_API_URL")).toBe(
      "https://open.bigmodel.cn/api/paas/v4",
    );
    // The example file must not resurrect routes or provider orders for
    // providers the catalog no longer carries as live.
    for (const name of envExample.keys()) {
      if (name.startsWith("AI_ROUTE_"))
        expect(name.startsWith("AI_ROUTE_ZHIPU_")).toBe(true);
      if (name.startsWith("AI_PROVIDER_ORDER"))
        expect(envExample.get(name)).toBe("zhipu");
    }
  });
});
