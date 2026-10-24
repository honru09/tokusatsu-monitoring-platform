import { createHash } from "node:crypto";

export type AutomaticClassificationCandidate = {
  needsReview?: boolean | null;
  categoryIp?: string | null;
  categoryToyType?: string | null;
  manufacturer?: string | null;
  conditionGrade?: string | null;
  quantityEst?: number | null;
  priceCurrent?: number | null;
  titleRaw?: string | null;
  descriptionRaw?: string | null;
  conditionRaw?: string | null;
  imageUrls?: readonly string[];
};

function unknown(value: string | null | undefined) {
  return value == null || value === "unknown";
}

function highValueThreshold() {
  const configured = Number(
    process.env.AI_IMAGE_HIGH_VALUE_THRESHOLD_JPY ?? 20_000,
  );
  return Number.isFinite(configured) && configured >= 0 ? configured : 20_000;
}

/**
 * Automatic AI is reserved for facts the deterministic pipeline could not
 * establish, explicit review cases, and high-value purchases where a second
 * pass is worth the spend. Fully classified ordinary listings stay on the
 * rules-only path.
 */
export function shouldQueueAutomaticClassification(
  candidate: AutomaticClassificationCandidate,
) {
  return (
    candidate.needsReview === true ||
    unknown(candidate.categoryIp) ||
    unknown(candidate.categoryToyType) ||
    unknown(candidate.manufacturer) ||
    unknown(candidate.conditionGrade) ||
    candidate.quantityEst == null ||
    (Number.isFinite(candidate.priceCurrent) &&
      Number(candidate.priceCurrent) >= highValueThreshold())
  );
}

/**
 * Only facts that can change the classifier input or the spend decision belong
 * in the version. Operational writes such as lastSeenAt/updatedAt must not
 * create another paid job for identical marketplace content.
 */
export function automaticClassificationContentVersion(
  candidate: AutomaticClassificationCandidate,
) {
  const normalized = JSON.stringify({
    titleRaw: candidate.titleRaw?.trim() ?? null,
    descriptionRaw: candidate.descriptionRaw?.trim() ?? null,
    conditionRaw: candidate.conditionRaw?.trim() ?? null,
    categoryIp: candidate.categoryIp ?? null,
    categoryToyType: candidate.categoryToyType ?? null,
    manufacturer: candidate.manufacturer ?? null,
    conditionGrade: candidate.conditionGrade ?? null,
    quantityEst: candidate.quantityEst ?? null,
    needsReview: candidate.needsReview === true,
    highValue:
      Number.isFinite(candidate.priceCurrent) &&
      Number(candidate.priceCurrent) >= highValueThreshold(),
    imageUrls: [...(candidate.imageUrls ?? [])],
  });
  return createHash("sha256").update(normalized).digest("hex").slice(0, 24);
}

export type AiJobItemState = {
  status?: string | null;
  archivedAt?: Date | string | null;
  deletedAt?: Date | string | null;
  ignored?: boolean | null;
  importOrigin?: string | null;
  purchaseRecord?: unknown;
};

export type AiJobAbortReason =
  | "item_not_live"
  | "item_archived"
  | "item_deleted"
  | "item_ignored"
  | "item_purchased";

/**
 * Item state can change while a job waits in the queue, and again while
 * earlier stages of the same job run. Processors re-read the row and
 * consult this predicate immediately before an AI call so terminal,
 * archived, ignored, or already-purchased listings stop consuming model
 * spend. A missing status is treated as live: when in doubt, run the job.
 *
 * Purchase imports are the one archive exception: their row is archived
 * only as staging until the operator confirms the purchase, so callers
 * that serve that flow pass allowArchivedPurchaseImport. A recorded
 * purchase still aborts unless the caller passes allowPurchaseRecord.
 */
export function aiJobAbortReason(
  item: AiJobItemState,
  options: {
    allowArchivedPurchaseImport?: boolean;
    allowPurchaseRecord?: boolean;
  } = {},
): AiJobAbortReason | null {
  if (
    item.status != null &&
    item.status !== "active" &&
    item.status !== "unknown"
  )
    return "item_not_live";
  if (
    item.archivedAt != null &&
    !(
      options.allowArchivedPurchaseImport && item.importOrigin === "purchase"
    )
  )
    return "item_archived";
  if (item.deletedAt != null) return "item_deleted";
  if (item.ignored) return "item_ignored";
  if (item.purchaseRecord != null && !options.allowPurchaseRecord)
    return "item_purchased";
  return null;
}

export function shouldAbortAiJobForItem(
  item: AiJobItemState,
  options: {
    allowArchivedPurchaseImport?: boolean;
    allowPurchaseRecord?: boolean;
  } = {},
) {
  return aiJobAbortReason(item, options) != null;
}

/**
 * Every field the automatic classifier can fill is already established.
 * Combined with shouldQueueAutomaticClassification returning false, this
 * is the run-time expression for "the analysis is no longer needed": a
 * queued job whose item was completed by another pass can stop, while a
 * high-value or review item still runs despite complete fields.
 */
export function hasCompleteClassificationFields(
  candidate: AutomaticClassificationCandidate,
) {
  return (
    candidate.needsReview !== true &&
    !unknown(candidate.categoryIp) &&
    !unknown(candidate.categoryToyType) &&
    !unknown(candidate.manufacturer) &&
    !unknown(candidate.conditionGrade) &&
    candidate.quantityEst != null
  );
}

/** One BullMQ de-duplication key per item and classifier-input version. */
export function classificationJobId(
  itemId: string,
  version: Date | string | AutomaticClassificationCandidate,
) {
  const versionKey =
    version instanceof Date
      ? version.toISOString()
      : typeof version === "string"
        ? version
        : automaticClassificationContentVersion(version);
  const digest = createHash("sha256")
    .update(versionKey)
    .digest("hex")
    .slice(0, 24);
  return `classification-${itemId}-${digest}`;
}
