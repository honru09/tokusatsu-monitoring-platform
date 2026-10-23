import { afterEach, describe, expect, it, vi } from "vitest";
import { startPeriodicTask } from "./periodic-task.js";

afterEach(() => { vi.useRealTimers(); });

describe("non-overlapping periodic work", () => {
  it("coalesces slow ticks and resumes on the next interval without a queued backlog", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const task = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    const runner = startPeriodicTask({ intervalMs: 60_000, task, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(task).toHaveBeenCalledOnce();
    const first = runner.run();
    expect(runner.run()).toBe(first);
    finish();
    await first;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(2);
    await runner.stop();
  });

  it("reports failure and permits the following tick", async () => {
    vi.useFakeTimers();
    const error = new Error("temporarily unavailable");
    const task = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const onError = vi.fn();
    const runner = startPeriodicTask({ intervalMs: 60_000, task, onError });
    await runner.run();
    expect(onError).toHaveBeenCalledWith(error);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(2);
    await runner.stop();
  });

  it("waits for in-flight work during shutdown and never dispatches after stopping", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const task = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const runner = startPeriodicTask({ intervalMs: 60_000, task, onError: vi.fn() });
    const first = runner.run();
    await Promise.resolve();
    let stopped = false;
    const shutdown = runner.stop().then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(stopped).toBe(false);
    expect(task).toHaveBeenCalledOnce();
    finish();
    await Promise.all([first, shutdown]);
    await runner.run();
    expect(stopped).toBe(true);
    expect(task).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
