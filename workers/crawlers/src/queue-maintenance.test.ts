import type { Queue } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { removePendingAdapterJobs } from "./queue-maintenance.js";

describe("removePendingAdapterJobs", () => {
  it("removes ordinary pending jobs but preserves scheduler-managed jobs", async () => {
    const removeSchedulerJob = vi.fn().mockResolvedValue(undefined);
    const removeOrdinaryJob = vi.fn().mockResolvedValue(undefined);
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
      ]),
    } as unknown as Pick<Queue, "getJobs">;

    await removePendingAdapterJobs(queue, ["mandarake"]);

    expect(removeSchedulerJob).not.toHaveBeenCalled();
    expect(removeOrdinaryJob).toHaveBeenCalledOnce();
  });
});
