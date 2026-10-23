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
