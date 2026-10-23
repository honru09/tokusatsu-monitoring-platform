import { isStatusRefreshEligible } from "./status-refresh-policy.js";

type StatusJobData = {
  itemId?: string;
  sourceItemId?: string;
  sourceUrl?: string;
  auctionEndAt?: string | Date | null;
  adapterKey?: string;
  listingType?: string;
};
type StatusRefreshResult = {
  status?: string;
  auctionEndAt?: string | Date | null;
  listingType?: string;
};
type ScheduleStatus = (
  itemId: string, sourceItemId: string, sourceUrl: string, status: string,
  auctionEndAt: Date | null, adapterKey: string,
) => Promise<unknown>;

/** Schedule only surviving listings, using freshly verified auction data rather
 * than the old job payload (including an explicit removal of a deadline). */
export async function rescheduleCompletedStatusJob(
  data: StatusJobData,
  result: StatusRefreshResult | null | undefined,
  schedule: ScheduleStatus,
) {
  if (!isStatusRefreshEligible(result?.status) || !data.itemId || !data.sourceItemId || !data.sourceUrl || !data.adapterKey)
    return;
  const deadline = result && Object.hasOwn(result, "auctionEndAt")
    ? result.auctionEndAt : data.auctionEndAt;
  const listingType = result?.listingType ?? data.listingType;
  const parsedDeadline = deadline ? new Date(deadline) : null;
  const auctionEndAt = listingType === "direct" || !parsedDeadline || !Number.isFinite(parsedDeadline.getTime())
    ? null : parsedDeadline;
  return schedule(data.itemId, data.sourceItemId, data.sourceUrl, result!.status!, auctionEndAt, data.adapterKey);
}
