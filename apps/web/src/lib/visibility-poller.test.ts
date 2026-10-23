import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedPollDelay, createVisibilityPoller } from "./visibility-poller";

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  vi.useRealTimers();
});

describe("visibility poller", () => {
  it("caps exponential retry delays", () => {
    expect(boundedPollDelay(2_000, 1, 30_000)).toBe(4_000);
    expect(boundedPollDelay(2_000, 3, 30_000)).toBe(16_000);
    expect(boundedPollDelay(2_000, 8, 30_000)).toBe(30_000);
  });

  it("keeps only one task in flight", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const poller = createVisibilityPoller({
      task,
      intervalMs: 2_000,
      maxBackoffMs: 30_000,
    });

    poller.start();
    poller.resume();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(1);

    finish?.();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("pauses while hidden and runs immediately after resume", async () => {
    vi.useFakeTimers();
    let hidden = false;
    const signals: AbortSignal[] = [];
    const task = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signals.push(signal);
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const poller = createVisibilityPoller({
      task,
      intervalMs: 2_000,
      maxBackoffMs: 30_000,
      isPaused: () => hidden,
    });

    poller.start();
    expect(task).toHaveBeenCalledTimes(1);
    hidden = true;
    poller.pause();
    expect(signals[0]?.aborted).toBe(true);

    hidden = false;
    poller.resume();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("backs off after failures and resets after success", async () => {
    vi.useFakeTimers();
    const task = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const poller = createVisibilityPoller({
      task,
      intervalMs: 2_000,
      maxBackoffMs: 8_000,
    });

    poller.start();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(7_999);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(3);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(task).toHaveBeenCalledTimes(4);
    poller.stop();
  });
});
