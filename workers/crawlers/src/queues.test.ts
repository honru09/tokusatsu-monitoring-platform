import { describe, expect, it, vi } from "vitest";

const queueCalls = vi.hoisted(
  () =>
    [] as Array<{
      name: string;
      options: {
        defaultJobOptions?: {
          attempts?: number;
          backoff?: { type?: string; delay?: number };
        };
      };
    }>,
);

vi.mock("bullmq", () => ({
  Queue: class QueueMock {
    name: string;

    constructor(
      name: string,
      options: {
        defaultJobOptions?: {
          attempts?: number;
          backoff?: { type?: string; delay?: number };
        };
      },
    ) {
      this.name = name;
      queueCalls.push({ name, options });
    }
  },
}));

vi.mock("ioredis", () => ({
  Redis: class RedisMock {},
}));

vi.mock("@tokusatsu/db", () => ({ prisma: {} }));

vi.mock("./queue-maintenance.js", () => ({
  removePendingAdapterJobs: vi.fn(),
}));

describe("source search queue retry policy", () => {
  it("retries transient marketplace failures with exponential backoff", async () => {
    await import("./queues.js");

    const searchQueue = queueCalls.find(({ name }) => name === "source-search");

    expect(searchQueue?.options.defaultJobOptions).toEqual({
      attempts: 4,
      backoff: { type: "exponential", delay: 30_000 },
    });
  });
});
