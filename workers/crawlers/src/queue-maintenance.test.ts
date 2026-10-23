import type { Queue } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import {
  cleanTerminalQueueHistory,
  removePendingAdapterJobs,
} from "./queue-maintenance.js";

describe("removePendingAdapterJobs", () => {
  it("removes pending repeat children for disabled adapters without touching enabled adapters", async () => {
    const removeSchedulerJob = vi.fn().mockResolvedValue(undefined);
    const removeOrdinaryJob = vi.fn().mockResolvedValue(undefined);
    const removeEnabledJob = vi.fn().mockResolvedValue(undefined);
    const removeUnknownJob = vi.fn().mockResolvedValue(undefined);
    const queue = {
      getJobs: vi.fn().mockResolvedValue([
        {
          data: { adapterKey: "mandarake" },
          repeatJobKey: "scheduler-key",
          remove: removeSchedulerJob,
        },
        {
          data: { adapterKey: "mandarake" },
          remove: removeOrdinaryJob,
        },
        {
          data: { adapterKey: "mercari" },
          repeatJobKey: "enabled-scheduler-key",
          remove: removeEnabledJob,
        },
        {
          data: {},
          remove: removeUnknownJob,
        },
      ]),
    } as unknown as Pick<Queue, "getJobs">;

    await removePendingAdapterJobs(queue, ["mandarake"]);

    expect(queue.getJobs).toHaveBeenCalledWith(
      ["waiting", "delayed", "prioritized"],
      0,
      -1,
    );
    expect(removeSchedulerJob).toHaveBeenCalledOnce();
    expect(removeOrdinaryJob).toHaveBeenCalledOnce();
    expect(removeEnabledJob).not.toHaveBeenCalled();
    expect(removeUnknownJob).not.toHaveBeenCalled();
  });
});

describe("BullMQ terminal history maintenance", () => {
  it("is a dry run by default and preserves repeat definitions", async () => {
    const clean = vi.fn();
    const queue = {
      name: "image-classification",
      getJobCounts: vi.fn(async () => ({ completed: 240, failed: 15 })),
      getRepeatableJobs: vi.fn(async () => [
        { key: "repeat:key", name: "classify" },
      ]),
      clean,
    };

    await expect(cleanTerminalQueueHistory(queue as never)).resolves.toEqual(
      expect.objectContaining({
        queue: "image-classification",
        mode: "dry-run",
        repeatDefinitions: 1,
        removed: { completed: 0, failed: 0 },
      }),
    );
    expect(clean).not.toHaveBeenCalled();
  });

  it("cleans only old completed and failed records in bounded batches", async () => {
    const clean = vi
      .fn()
      .mockResolvedValueOnce(["completed-1", "completed-2"])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["failed-1"]);
    const getJobCounts = vi
      .fn()
      .mockResolvedValueOnce({ completed: 10, failed: 4 })
      .mockResolvedValueOnce({ completed: 8, failed: 3 });
    const queue = {
      name: "title-translation",
      getJobCounts,
      getRepeatableJobs: vi.fn(async () => [{ key: "current-repeat" }]),
      clean,
    };

    const report = await cleanTerminalQueueHistory(queue as never, {
      apply: true,
      graceMs: 3_600_000,
      batchSize: 2,
      maxPassesPerState: 5,
    });

    expect(clean.mock.calls).toEqual([
      [3_600_000, 2, "completed"],
      [3_600_000, 2, "completed"],
      [3_600_000, 2, "failed"],
    ]);
    expect(report.removed).toEqual({ completed: 2, failed: 1 });
    expect(report.repeatDefinitions).toBe(1);
    expect(report.after).toEqual({ completed: 8, failed: 3 });
  });

  it("stops at the configured pass ceiling instead of looping forever", async () => {
    const clean = vi.fn(async () => ["a", "b"]);
    const queue = {
      name: "ai-operations",
      getJobCounts: vi.fn(async () => ({ completed: 9_999, failed: 9_999 })),
      getRepeatableJobs: vi.fn(async () => []),
      clean,
    };

    const report = await cleanTerminalQueueHistory(queue as never, {
      apply: true,
      batchSize: 2,
      maxPassesPerState: 2,
    });

    expect(clean).toHaveBeenCalledTimes(4);
    expect(report.capped).toEqual({ completed: true, failed: true });
  });
});
