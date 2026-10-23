import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AutomaticAiDeferredError,
  AutomaticAiGuard,
  automaticBackgroundAiEnabled,
  automaticPaidAiEnabled,
  backgroundAiFetch,
  resetAutomaticAiGuardForTests,
  runAutomaticAiTask,
  type AutomaticAiCooldown,
  type AutomaticAiCoordination,
} from "./background-ai-guard.js";

class SharedTestCoordination implements AutomaticAiCoordination {
  cooldown: AutomaticAiCooldown | null = null;
  lockOwner: string | null = null;

  async readCooldown() {
    return this.cooldown;
  }

  async writeCooldown(cooldown: AutomaticAiCooldown) {
    if (!this.cooldown || cooldown.retryAt > this.cooldown.retryAt)
      this.cooldown = cooldown;
  }

  async acquire(owner: string) {
    if (this.lockOwner) return false;
    this.lockOwner = owner;
    return true;
  }

  async renew(owner: string) {
    return this.lockOwner === owner;
  }

  async release(owner: string) {
    if (this.lockOwner === owner) this.lockOwner = null;
  }
}

afterEach(() => {
  resetAutomaticAiGuardForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("automatic AI spend guard", () => {
  it("allows explicitly authorized free background work without authorizing paid automation", async () => {
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "true");
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    const operation = vi.fn(async () => "translated");

    expect(automaticBackgroundAiEnabled()).toBe(true);
    expect(automaticPaidAiEnabled()).toBe(false);
    await expect(
      runAutomaticAiTask("scheduled:title-translation", operation, undefined, {
        authorization: "free",
      }),
    ).resolves.toBe("translated");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("keeps free background work disabled unless its independent authorization is explicit", async () => {
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "false");
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    const operation = vi.fn(async () => "must-not-run");

    expect(automaticBackgroundAiEnabled()).toBe(false);
    await expect(
      runAutomaticAiTask("scheduled:title-translation", operation, undefined, {
        authorization: "free",
      }),
    ).rejects.toMatchObject({ reason: "background_automation_not_authorized" });
    expect(operation).not.toHaveBeenCalled();
  });

  it("blocks every scheduled paid operation until the live probe is authorized", async () => {
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    const operation = vi.fn(async () => "must-not-run");

    expect(automaticPaidAiEnabled()).toBe(false);
    await expect(
      runAutomaticAiTask("scheduled:image-classification", operation),
    ).rejects.toMatchObject({ reason: "paid_automation_not_authorized" });
    expect(operation).not.toHaveBeenCalled();
  });

  it("deduplicates an identical request and serializes different background work", async () => {
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "true");
    const guard = new AutomaticAiGuard({ maxConcurrency: 1 });
    const releases: Array<() => void> = [];
    let invocation = 0;
    const work = vi.fn(() => {
      const current = ++invocation;
      return new Promise<string>((resolve) => {
        releases.push(() => resolve(`result-${current}`));
      });
    });

    const first = guard.run("same-item", work);
    const duplicate = guard.run("same-item", work);
    const next = guard.run("another-item", work);
    await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(1));

    releases.shift()?.();
    await expect(first).resolves.toBe("result-1");
    await expect(duplicate).resolves.toBe("result-1");
    await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(2));
    releases.shift()?.();
    await expect(next).resolves.toBe("result-2");
  });

  it("shares a provider cooldown across unrelated automatic queues", async () => {
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "true");
    let now = Date.parse("2026-09-05T00:00:00Z");
    const guard = new AutomaticAiGuard({
      maxConcurrency: 1,
      now: () => now,
      defaultCooldownMs: 600_000,
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"code":"AI_GATEWAY_CAPACITY_COOLDOWN"}', {
          status: 503,
          headers: { "retry-after": "900" },
        }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await expect(
      backgroundAiFetch("title:item-1", "https://api.test/one", undefined, {
        guard,
        fetcher,
      }),
    ).rejects.toBeInstanceOf(AutomaticAiDeferredError);
    await expect(
      backgroundAiFetch("detail:item-2", "https://api.test/two", undefined, {
        guard,
        fetcher,
      }),
    ).rejects.toBeInstanceOf(AutomaticAiDeferredError);
    expect(fetcher).toHaveBeenCalledTimes(1);

    now += 900_001;
    await expect(
      backgroundAiFetch("detail:item-2", "https://api.test/two", undefined, {
        guard,
        fetcher,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not trip the shared provider cooldown for a single content/schema 4xx", async () => {
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "true");
    const guard = new AutomaticAiGuard({ maxConcurrency: 1 });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"code":"INVALID_RESPONSE_SCHEMA"}', { status: 422 }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));

    const invalid = await backgroundAiFetch(
      "classification:item-1",
      "https://api.test/invalid",
      undefined,
      { guard, fetcher },
    );
    expect(invalid.status).toBe(422);
    await expect(
      backgroundAiFetch(
        "classification:item-2",
        "https://api.test/valid",
        undefined,
        { guard, fetcher },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("serializes automatic work across separate worker processes through shared coordination", async () => {
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "true");
    const coordination = new SharedTestCoordination();
    const guardOptions = {
      coordination,
      maxConcurrency: 1,
      wait: (milliseconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
      lockPollMs: 1,
    };
    const firstGuard = new AutomaticAiGuard(guardOptions);
    const secondGuard = new AutomaticAiGuard(guardOptions);
    let releaseFirst!: () => void;
    const firstWork = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseFirst = () => resolve("first");
        }),
    );
    const secondWork = vi.fn(async () => "second");

    const first = firstGuard.run("worker-a", firstWork);
    const second = secondGuard.run("worker-b", secondWork);
    await vi.waitFor(() => expect(firstWork).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(secondWork).not.toHaveBeenCalled();

    releaseFirst();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });

  it("reuses a persisted cooldown across separate guard instances", async () => {
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "true");
    let now = Date.parse("2026-09-05T00:00:00Z");
    const coordination = new SharedTestCoordination();
    const firstGuard = new AutomaticAiGuard({
      coordination,
      now: () => now,
    });
    const secondGuard = new AutomaticAiGuard({
      coordination,
      now: () => now,
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"code":"AI_GATEWAY_CAPACITY_COOLDOWN"}', {
        status: 503,
        headers: { "retry-after": "900" },
      }),
    );

    await expect(
      backgroundAiFetch("first", "https://api.test/first", undefined, {
        guard: firstGuard,
        fetcher,
      }),
    ).rejects.toBeInstanceOf(AutomaticAiDeferredError);
    await expect(
      backgroundAiFetch("second", "https://api.test/second", undefined, {
        guard: secondGuard,
        fetcher,
      }),
    ).rejects.toBeInstanceOf(AutomaticAiDeferredError);
    expect(fetcher).toHaveBeenCalledOnce();

    now += 900_001;
    coordination.cooldown = null;
  });

  it("classifies AbortSignal timeout errors as a shared transport outage", async () => {
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "true");
    const guard = new AutomaticAiGuard({ maxConcurrency: 1 });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new DOMException("The operation timed out", "TimeoutError"),
      );

    await expect(
      backgroundAiFetch("timed-out", "https://api.test/slow", undefined, {
        guard,
        fetcher,
      }),
    ).rejects.toBeInstanceOf(AutomaticAiDeferredError);
  });

  it("cools down automatic work when the internal Gateway has no routable model", async () => {
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "true");
    const guard = new AutomaticAiGuard({ maxConcurrency: 1 });
    const operation = vi
      .fn()
      .mockRejectedValue(new Error("AI Gateway vision returned 404"));

    await expect(
      runAutomaticAiTask("vision:item-1", operation, guard),
    ).rejects.toBeInstanceOf(AutomaticAiDeferredError);
    await expect(
      runAutomaticAiTask("vision:item-2", operation, guard),
    ).rejects.toBeInstanceOf(AutomaticAiDeferredError);
    expect(operation).toHaveBeenCalledOnce();
  });
});
