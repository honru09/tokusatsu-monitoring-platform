import { describe, expect, it, vi } from "vitest";
import { SystemContextService } from "./system-context.service.js";
import { ZHIPU_MODEL } from "./ai-config.js";

describe("SystemContextService AI snapshot", () => {
  function providerSnapshotFixture(
    state: Record<string, unknown>,
    catalogue: Set<string> | undefined = new Set([`zhipu:${ZHIPU_MODEL}`]),
    options: {
      modelStates?: Record<string, unknown>[];
      active?: boolean;
    } = {},
  ) {
    const prisma = {
      item: {
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      source: { findMany: vi.fn().mockResolvedValue([]) },
      crawlJob: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      aiRun: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      aiModelState: {
        findMany: vi.fn().mockResolvedValue(options.modelStates ?? []),
      },
      aiProviderState: { findMany: vi.fn().mockResolvedValue([state]) },
      aiCache: { count: vi.fn().mockResolvedValue(0) },
      marketIntel: { count: vi.fn().mockResolvedValue(0) },
      keywordInsight: { findMany: vi.fn().mockResolvedValue([]) },
      purchaseRecord: { count: vi.fn().mockResolvedValue(0) },
      discoveryFeedback: { groupBy: vi.fn().mockResolvedValue([]) },
    };
    const gateway = {
      availableModelIds: vi.fn().mockResolvedValue(catalogue),
      providerCatalogueSnapshot: vi.fn().mockResolvedValue([
        {
          provider: "zhipu",
          models: catalogue
            ? new Set(
                [...catalogue]
                  .filter((model) => model.startsWith("zhipu:"))
                  .map((model) => model.slice("zhipu:".length)),
              )
            : undefined,
          evidence: catalogue ? "live_catalogue" : "catalogue_unavailable",
        },
      ]),
      providerConfigurations: vi.fn().mockReturnValue([
        {
          provider: "zhipu",
          credentialConfigured: true,
          active: options.active ?? true,
          modelAvailabilityEvidence: "live_catalogue",
        },
      ]),
    };
    const service = new SystemContextService(prisma as never, gateway as never);
    (
      service as unknown as {
        queueSnapshot(): Promise<{ status: string; counts: never[] }>;
      }
    ).queueSnapshot = vi.fn().mockResolvedValue({ status: "ok", counts: [] });
    return { service, prisma, gateway };
  }

  it("replaces stale unavailable state with catalogue readiness without claiming a successful completion", async () => {
    const expired = new Date(Date.now() - 60_000);
    const { service } = providerSnapshotFixture({
      provider: "zhipu",
      status: "unavailable",
      cooldownUntil: expired,
      quotaResetAt: null,
      remainingRequests: null,
      remainingTokens: null,
      consecutiveFailures: 3,
      lastErrorCode: "MODEL_NOT_AVAILABLE",
      updatedAt: expired,
    });

    const snapshot = await service.snapshot({ includePrivateActivity: false });

    expect(snapshot.ai.providerStates).toEqual([
      expect.objectContaining({
        provider: "zhipu",
        status: "ready",
        cooldownUntil: null,
        lastErrorCode: null,
        modelCount: 1,
      }),
    ]);
    expect(snapshot.ai.providerStates[0].status).not.toBe("online");
  });

  it("reports an unavailable catalogue as unverified instead of hiding it behind persisted state", async () => {
    const { service, gateway } = providerSnapshotFixture(
      {
        provider: "zhipu",
        status: "online",
        cooldownUntil: null,
        lastErrorCode: null,
      },
      new Set([`zhipu:${ZHIPU_MODEL}`]),
      {
        modelStates: [
          {
            provider: "zhipu",
            model: ZHIPU_MODEL,
            status: "online",
            lastSuccessAt: new Date(),
            cooldownUntil: null,
            lastErrorCode: null,
          },
        ],
      },
    );
    gateway.providerCatalogueSnapshot.mockResolvedValue([
      {
        provider: "zhipu",
        models: undefined,
        evidence: "catalogue_unavailable",
      },
    ]);

    const snapshot = await service.snapshot({ includePrivateActivity: false });

    expect(snapshot.ai.providerStates).toEqual([
      expect.objectContaining({
        provider: "zhipu",
        status: "unverified",
        evidence: "catalogue_unavailable",
        lastErrorCode: "AI_GATEWAY_CATALOGUE_UNAVAILABLE",
      }),
    ]);
    expect(snapshot.ai.models).toEqual([
      expect.objectContaining({
        provider: "zhipu",
        model: ZHIPU_MODEL,
        status: "unverified",
        lastErrorCode: "AI_GATEWAY_CATALOGUE_UNAVAILABLE",
      }),
    ]);
  });

  it("marks a catalogue model online only after a persisted completion succeeds", async () => {
    const now = new Date();
    const { service } = providerSnapshotFixture(
      {
        provider: "zhipu",
        status: "unavailable",
        cooldownUntil: new Date(Date.now() - 60_000),
        quotaResetAt: null,
        remainingRequests: null,
        remainingTokens: null,
        consecutiveFailures: 2,
        lastErrorCode: "MODEL_NOT_AVAILABLE",
        updatedAt: now,
      },
      new Set([`zhipu:${ZHIPU_MODEL}`]),
      {
        modelStates: [
          {
            provider: "zhipu",
            model: ZHIPU_MODEL,
            status: "online",
            lastSuccessAt: now,
            cooldownUntil: null,
            quotaResetAt: null,
            consecutiveFailures: 0,
            lastErrorCode: null,
          },
        ],
      },
    );

    const snapshot = await service.snapshot({ includePrivateActivity: false });

    expect(snapshot.ai.providerStates).toEqual([
      expect.objectContaining({ provider: "zhipu", status: "online" }),
    ]);
  });

  it.each(["degraded", "online"])(
    "does not let historical success hide a newer model failure even if stored status is %s",
    async (status) => {
      const lastSuccessAt = new Date(Date.now() - 60_000);
      const lastFailureAt = new Date(Date.now() - 1_000);
      const { service } = providerSnapshotFixture(
        {
          provider: "zhipu",
          status: "online",
          cooldownUntil: null,
          lastErrorCode: null,
        },
        new Set([`zhipu:${ZHIPU_MODEL}`]),
        {
          modelStates: [
            {
              provider: "zhipu",
              model: ZHIPU_MODEL,
              status,
              lastSuccessAt,
              lastFailureAt,
              cooldownUntil: null,
              lastErrorCode: "TIMEOUT",
            },
          ],
        },
      );

      const snapshot = await service.snapshot({
        includePrivateActivity: false,
      });

      expect(snapshot.ai.providerStates).toEqual([
        expect.objectContaining({ provider: "zhipu", status: "degraded" }),
      ]);
      expect(snapshot.ai.models).toEqual([
        expect.objectContaining({
          model: ZHIPU_MODEL,
          status: "degraded",
          lastSuccessAt,
          lastFailureAt,
          lastErrorCode: "TIMEOUT",
        }),
      ]);
    },
  );

  it("does not label configured catalogue fallback as live or online", async () => {
    const { service, gateway } = providerSnapshotFixture(
      {
        provider: "zhipu",
        status: "online",
        cooldownUntil: null,
        lastErrorCode: null,
      },
      new Set([`zhipu:${ZHIPU_MODEL}`]),
      {
        modelStates: [
          {
            provider: "zhipu",
            model: ZHIPU_MODEL,
            status: "online",
            lastSuccessAt: new Date(),
            cooldownUntil: null,
            lastFailureAt: null,
            lastErrorCode: null,
          },
        ],
      },
    );
    gateway.providerCatalogueSnapshot.mockResolvedValue([
      {
        provider: "zhipu",
        models: new Set([ZHIPU_MODEL]),
        evidence: "configured_fallback",
      },
    ]);

    const snapshot = await service.snapshot({ includePrivateActivity: false });

    expect(snapshot.ai.providerStates).toEqual([
      expect.objectContaining({
        provider: "zhipu",
        status: "unverified",
        evidence: "configured_fallback",
      }),
    ]);
    expect(snapshot.ai.models).toEqual([
      expect.objectContaining({ model: ZHIPU_MODEL, status: "unverified" }),
    ]);
  });

  it("keeps the static Zhipu route unverified even after a persisted completion", async () => {
    // This is the production evidence shape: the gateway always reports
    // operator_static_route for Zhipu, so the snapshot never promotes the
    // provider to online from catalogue evidence alone.
    const { service, gateway } = providerSnapshotFixture(
      {
        provider: "zhipu",
        status: "online",
        cooldownUntil: null,
        lastErrorCode: null,
      },
      new Set([`zhipu:${ZHIPU_MODEL}`]),
      {
        modelStates: [
          {
            provider: "zhipu",
            model: ZHIPU_MODEL,
            status: "online",
            lastSuccessAt: new Date(),
            cooldownUntil: null,
            lastFailureAt: null,
            lastErrorCode: null,
          },
        ],
      },
    );
    gateway.providerCatalogueSnapshot.mockResolvedValue([
      {
        provider: "zhipu",
        models: new Set([ZHIPU_MODEL]),
        evidence: "operator_static_route",
      },
    ]);

    const snapshot = await service.snapshot({ includePrivateActivity: false });

    expect(snapshot.ai.providerStates).toEqual([
      expect.objectContaining({
        provider: "zhipu",
        status: "unverified",
        evidence: "operator_static_route",
      }),
    ]);
    expect(snapshot.ai.models).toEqual([
      expect.objectContaining({ model: ZHIPU_MODEL, status: "unverified" }),
    ]);
  });

  it("does not expose a credential that is present but inactive as an online provider", async () => {
    const { service } = providerSnapshotFixture(
      {
        provider: "zhipu",
        status: "online",
        cooldownUntil: null,
        quotaResetAt: null,
        remainingRequests: null,
        remainingTokens: null,
        consecutiveFailures: 0,
        lastErrorCode: null,
        updatedAt: new Date(),
      },
      new Set([`zhipu:${ZHIPU_MODEL}`]),
      { active: false },
    );

    const snapshot = await service.snapshot({ includePrivateActivity: false });

    expect(snapshot.ai.providerStates).toEqual([
      expect.objectContaining({ provider: "zhipu", status: "not_configured" }),
    ]);
  });

  it.each(["AUTH", "CREDITS", "RATE_LIMIT"])(
    "does not let a visible catalogue clear an active %s boundary",
    async (lastErrorCode) => {
      const future = new Date(Date.now() + 60_000);
      const { service } = providerSnapshotFixture({
        provider: "zhipu",
        status: "cooldown",
        cooldownUntil: future,
        quotaResetAt: future,
        remainingRequests: 0,
        remainingTokens: 50,
        consecutiveFailures: 2,
        lastErrorCode,
        updatedAt: new Date(),
      });

      const snapshot = await service.snapshot({
        includePrivateActivity: false,
      });

      expect(snapshot.ai.providerStates).toEqual([
        expect.objectContaining({
          provider: "zhipu",
          status: "cooldown",
          cooldownUntil: future,
          quotaResetAt: future,
          remainingRequests: 0,
          remainingTokens: 50,
          lastErrorCode,
          consecutiveFailures: 2,
        }),
      ]);
    },
  );

  it("excludes legacy provider rows and exposes Zhipu quota state", async () => {
    const future = new Date(Date.now() + 60_000);
    const cacheCount = vi.fn().mockResolvedValue(2);
    const prisma = {
      item: {
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      source: { findMany: vi.fn().mockResolvedValue([]) },
      crawlJob: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      aiRun: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      aiModelState: { findMany: vi.fn().mockResolvedValue([]) },
      aiProviderState: {
        findMany: vi.fn().mockResolvedValue([
          {
            provider: "groq",
            status: "cooldown",
            cooldownUntil: future,
            quotaResetAt: future,
            remainingRequests: 0,
            remainingTokens: 50,
            lastErrorCode: "RATE_LIMIT",
            consecutiveFailures: 1,
            updatedAt: new Date(),
          },
          {
            provider: "zhipu",
            status: "cooldown",
            cooldownUntil: future,
            quotaResetAt: future,
            remainingRequests: 0,
            remainingTokens: 50,
            lastErrorCode: "RATE_LIMIT",
            consecutiveFailures: 1,
            updatedAt: new Date(),
          },
        ]),
      },
      aiCache: { count: cacheCount },
      marketIntel: { count: vi.fn().mockResolvedValue(0) },
      keywordInsight: { findMany: vi.fn().mockResolvedValue([]) },
      purchaseRecord: { count: vi.fn().mockResolvedValue(0) },
      discoveryFeedback: { groupBy: vi.fn().mockResolvedValue([]) },
    };
    const service = new SystemContextService(prisma as never);
    (
      service as unknown as {
        queueSnapshot(): Promise<{ status: string; counts: never[] }>;
      }
    ).queueSnapshot = vi.fn().mockResolvedValue({ status: "ok", counts: [] });

    const snapshot = await service.snapshot();

    expect(cacheCount).toHaveBeenCalledWith({
      where: {
        expiresAt: { gt: expect.any(Date) },
        provider: { not: null },
      },
    });
    expect(snapshot.ai.cacheEntries).toBe(2);
    expect(snapshot.ai.providerStates).toEqual([
      expect.objectContaining({
        provider: "zhipu",
        cooldownUntil: future,
        quotaResetAt: future,
        remainingRequests: 0,
        remainingTokens: 50,
      }),
    ]);
  });

  it("does not query or expose shared user activity in a public snapshot", async () => {
    const prisma = {
      item: {
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      source: { findMany: vi.fn().mockResolvedValue([]) },
      crawlJob: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      aiRun: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      aiModelState: { findMany: vi.fn().mockResolvedValue([]) },
      aiProviderState: { findMany: vi.fn().mockResolvedValue([]) },
      aiCache: { count: vi.fn().mockResolvedValue(0) },
      marketIntel: { count: vi.fn().mockResolvedValue(0) },
      keywordInsight: { findMany: vi.fn().mockResolvedValue([]) },
      purchaseRecord: { count: vi.fn().mockResolvedValue(0) },
      discoveryFeedback: { groupBy: vi.fn().mockResolvedValue([]) },
    };
    const service = new SystemContextService(prisma as never);
    (
      service as unknown as {
        queueSnapshot(): Promise<{ status: string; counts: never[] }>;
      }
    ).queueSnapshot = vi.fn().mockResolvedValue({ status: "ok", counts: [] });

    const snapshot = await service.snapshot({ includePrivateActivity: false });

    expect(prisma.purchaseRecord.count).not.toHaveBeenCalled();
    expect(prisma.discoveryFeedback.groupBy).not.toHaveBeenCalled();
    expect(
      prisma.item.count.mock.calls.some(([query]) => query?.where?.favorite),
    ).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain("recentUserActivity");
  });
});
