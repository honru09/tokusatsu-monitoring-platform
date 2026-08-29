import type { Queue } from "bullmq";

export async function removePendingAdapterJobs(
  queue: Pick<Queue, "getJobs">,
  adapterKeys: string[],
) {
  const pending = await queue.getJobs(
    ["waiting", "delayed", "prioritized"],
    0,
    -1,
  );

  for (const job of pending) {
    if (job.repeatJobKey) continue;
    if (adapterKeys.includes(job.data?.adapterKey)) await job.remove();
  }
}
