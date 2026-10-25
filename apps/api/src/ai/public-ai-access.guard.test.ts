import type { ExecutionContext } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PublicAiAccessGuard,
  publicAiCostPolicy,
} from "./public-ai-access.guard.js";

const envKeys = [
  "AI_PUBLIC_COST_POLICY",
  "AI_PUBLIC_ALLOW_PAID_MODELS",
  "AI_PUBLIC_CHAT_RATE_LIMIT",
  "AI_PUBLIC_CHAT_RATE_WINDOW_MS",
  "AI_PUBLIC_RATE_LIMIT_CLEANUP_MS",
  "AI_PUBLIC_RATE_LIMIT_MAX_BUCKETS",
  "AI_TRUSTED_PROXY_CIDRS",
] as const;
const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
);
const guards: PublicAiAccessGuard[] = [];

afterEach(() => {
  for (const guard of guards.splice(0)) guard.onModuleDestroy();
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.useRealTimers();
});

function createGuard(endpoint: "chat" = "chat") {
  const guard = new PublicAiAccessGuard({
    get: vi.fn().mockReturnValue(endpoint),
  } as never);
  guards.push(guard);
  return guard;
}

function requestContext(options: {
  clientHeader?: string;
  peerIp?: string;
  responseHeaders?: Map<string, string | number>;
}) {
  const peerIp = options.peerIp ?? "172.18.0.2";
  const responseHeaders = options.responseHeaders ?? new Map();
  return {
    getHandler: () => requestContext,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: options.clientHeader
          ? { "x-client-ip": options.clientHeader }
          : {},
        ip: peerIp,
        socket: { remoteAddress: peerIp },
      }),
      getResponse: () => ({
        setHeader: (name: string, value: string | number) =>
          responseHeaders.set(name, value),
      }),
    }),
  } as unknown as ExecutionContext;
}

function bucketCount(guard: PublicAiAccessGuard) {
  return (guard as unknown as { buckets: Map<string, { expiresAt: number }> })
    .buckets.size;
}

describe("PublicAiAccessGuard", () => {
  it("keeps different forwarded client IPs in different buckets", () => {
    process.env.AI_PUBLIC_CHAT_RATE_LIMIT = "1";
    process.env.AI_PUBLIC_CHAT_RATE_WINDOW_MS = "60000";
    const guard = createGuard();

    expect(
      guard.canActivate(requestContext({ clientHeader: "203.0.113.10" })),
    ).toBe(true);
    expect(
      guard.canActivate(requestContext({ clientHeader: "203.0.113.11" })),
    ).toBe(true);
    expect(() =>
      guard.canActivate(requestContext({ clientHeader: "203.0.113.10" })),
    ).toThrow(expect.objectContaining({ status: 429 }));
  });

  it("does not turn arbitrary header strings into map keys", () => {
    process.env.AI_PUBLIC_CHAT_RATE_LIMIT = "1";
    const guard = createGuard();

    expect(
      guard.canActivate(requestContext({ clientHeader: "not-an-ip-1" })),
    ).toBe(true);
    expect(() =>
      guard.canActivate(requestContext({ clientHeader: "not-an-ip-2" })),
    ).toThrow(expect.objectContaining({ status: 429 }));
    expect(bucketCount(guard)).toBe(1);
  });

  it("ignores an x-client-ip supplied through an untrusted peer", () => {
    process.env.AI_PUBLIC_CHAT_RATE_LIMIT = "1";
    const guard = createGuard();

    expect(
      guard.canActivate(
        requestContext({
          clientHeader: "203.0.113.10",
          peerIp: "198.51.100.40",
        }),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        requestContext({
          clientHeader: "203.0.113.11",
          peerIp: "198.51.100.40",
        }),
      ),
    ).toThrow(expect.objectContaining({ status: 429 }));
  });

  it("keeps the in-memory map within its configured bound", () => {
    process.env.AI_PUBLIC_CHAT_RATE_LIMIT = "100";
    process.env.AI_PUBLIC_RATE_LIMIT_MAX_BUCKETS = "2";
    const guard = createGuard();

    for (let index = 1; index <= 20; index += 1) {
      guard.canActivate(requestContext({ clientHeader: `203.0.113.${index}` }));
    }
    expect(bucketCount(guard)).toBeLessThanOrEqual(2);
  });

  it("automatically removes expired buckets", () => {
    vi.useFakeTimers();
    process.env.AI_PUBLIC_CHAT_RATE_WINDOW_MS = "1000";
    process.env.AI_PUBLIC_RATE_LIMIT_CLEANUP_MS = "1000";
    const guard = createGuard();

    guard.canActivate(requestContext({ clientHeader: "203.0.113.10" }));
    expect(bucketCount(guard)).toBe(1);
    vi.advanceTimersByTime(1_001);
    expect(bucketCount(guard)).toBe(0);
  });
});

describe("publicAiCostPolicy", () => {
  it("defaults public calls to free_only", () => {
    delete process.env.AI_PUBLIC_COST_POLICY;
    delete process.env.AI_PUBLIC_ALLOW_PAID_MODELS;
    expect(publicAiCostPolicy()).toBe("free_only");
  });

  it("requires an explicit paid-model gate before widening the policy", () => {
    process.env.AI_PUBLIC_COST_POLICY = "free_first";
    delete process.env.AI_PUBLIC_ALLOW_PAID_MODELS;
    expect(publicAiCostPolicy()).toBe("free_only");

    process.env.AI_PUBLIC_ALLOW_PAID_MODELS = "true";
    expect(publicAiCostPolicy()).toBe("free_first");
  });
});
