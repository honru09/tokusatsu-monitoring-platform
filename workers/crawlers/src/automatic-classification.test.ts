import { afterEach, describe, expect, it } from "vitest";
import {
  aiJobAbortReason,
  automaticClassificationContentVersion,
  classificationJobId,
  hasCompleteClassificationFields,
  shouldAbortAiJobForItem,
  shouldQueueAutomaticClassification,
} from "./automatic-classification.js";

const originalThreshold = process.env.AI_IMAGE_HIGH_VALUE_THRESHOLD_JPY;

afterEach(() => {
  if (originalThreshold == null)
    delete process.env.AI_IMAGE_HIGH_VALUE_THRESHOLD_JPY;
  else process.env.AI_IMAGE_HIGH_VALUE_THRESHOLD_JPY = originalThreshold;
});

const completeCandidate = {
  needsReview: false,
  categoryIp: "kamen_rider",
  categoryToyType: "dx_belt",
  manufacturer: "bandai",
  conditionGrade: "used",
  quantityEst: 1,
  priceCurrent: 8_000,
  titleRaw: "仮面ライダー DX変身ベルト",
  descriptionRaw: "中古、付属品あり",
  conditionRaw: "中古",
  imageUrls: ["https://images.example/item-1.jpg"],
} as const;

describe("automatic classification spend decision", () => {
  it("keeps deterministic ordinary listings on the rules-only path", () => {
    expect(shouldQueueAutomaticClassification(completeCandidate)).toBe(false);
  });

  it("queues unknown, review, or high-value evidence", () => {
    expect(
      shouldQueueAutomaticClassification({
        ...completeCandidate,
        categoryToyType: "unknown",
      }),
    ).toBe(true);
    expect(
      shouldQueueAutomaticClassification({
        ...completeCandidate,
        needsReview: true,
      }),
    ).toBe(true);
    expect(
      shouldQueueAutomaticClassification({
        ...completeCandidate,
        priceCurrent: 20_000,
      }),
    ).toBe(true);
  });
});

describe("run-time AI job abort predicate", () => {
  const liveItem = {
    status: "active",
    archivedAt: null,
    ignored: false,
    importOrigin: "search",
    purchaseRecord: null,
  } as const;

  it("lets live listings run", () => {
    expect(aiJobAbortReason(liveItem)).toBeNull();
    expect(shouldAbortAiJobForItem(liveItem)).toBe(false);
    expect(aiJobAbortReason({ ...liveItem, status: "unknown" })).toBeNull();
    // A missing status is not evidence the listing is dead.
    expect(aiJobAbortReason({ ...liveItem, status: null })).toBeNull();
    expect(aiJobAbortReason({})).toBeNull();
  });

  it("aborts a deleted listing even when it otherwise looks live", () => {
    expect(
      aiJobAbortReason({ ...liveItem, deletedAt: new Date() }),
    ).toBe("item_deleted");
    expect(
      shouldAbortAiJobForItem({ ...liveItem, deletedAt: new Date() }),
    ).toBe(true);
    expect(aiJobAbortReason({ ...liveItem, deletedAt: null })).toBeNull();
  });

  it("aborts terminal, archived, ignored, and purchased listings", () => {
    expect(aiJobAbortReason({ ...liveItem, status: "sold" })).toBe(
      "item_not_live",
    );
    expect(aiJobAbortReason({ ...liveItem, status: "ended" })).toBe(
      "item_not_live",
    );
    expect(aiJobAbortReason({ ...liveItem, status: "reserved" })).toBe(
      "item_not_live",
    );
    expect(
      aiJobAbortReason({ ...liveItem, archivedAt: new Date() }),
    ).toBe("item_archived");
    expect(aiJobAbortReason({ ...liveItem, ignored: true })).toBe(
      "item_ignored",
    );
    expect(
      aiJobAbortReason({ ...liveItem, purchaseRecord: { id: "purchase-1" } }),
    ).toBe("item_purchased");
  });

  it("keeps the purchase-import staging archive exception", () => {
    const purchaseImport = {
      ...liveItem,
      archivedAt: new Date(),
      importOrigin: "purchase",
    };
    expect(
      aiJobAbortReason(purchaseImport, { allowArchivedPurchaseImport: true }),
    ).toBeNull();
    expect(aiJobAbortReason(purchaseImport)).toBe("item_archived");
    // The exception never covers a recorded purchase.
    expect(
      aiJobAbortReason(
        { ...purchaseImport, purchaseRecord: { id: "purchase-1" } },
        { allowArchivedPurchaseImport: true },
      ),
    ).toBe("item_purchased");
    expect(
      aiJobAbortReason(
        { ...liveItem, purchaseRecord: { id: "purchase-1" } },
        { allowPurchaseRecord: true },
      ),
    ).toBeNull();
  });
});

describe("classification completeness at run time", () => {
  it("recognizes complete fields and pairs with the queue predicate", () => {
    expect(hasCompleteClassificationFields(completeCandidate)).toBe(true);
    // Complete and ordinary: a stale queued job no longer needs the run.
    expect(shouldQueueAutomaticClassification(completeCandidate)).toBe(false);
    expect(
      hasCompleteClassificationFields({
        ...completeCandidate,
        manufacturer: "unknown",
      }),
    ).toBe(false);
    expect(
      hasCompleteClassificationFields({
        ...completeCandidate,
        quantityEst: null,
      }),
    ).toBe(false);
    expect(
      hasCompleteClassificationFields({
        ...completeCandidate,
        needsReview: true,
      }),
    ).toBe(false);
    // Complete but high-value: completeness alone must not abort the run.
    expect(
      shouldQueueAutomaticClassification({
        ...completeCandidate,
        priceCurrent: 25_000,
      }),
    ).toBe(true);
  });
});

describe("automatic classification content key", () => {
  it("is stable for identical content and changes with classifier evidence", () => {
    const version = automaticClassificationContentVersion(completeCandidate);
    expect(automaticClassificationContentVersion(completeCandidate)).toBe(
      version,
    );
    expect(
      automaticClassificationContentVersion({
        ...completeCandidate,
        imageUrls: ["https://images.example/item-2.jpg"],
      }),
    ).not.toBe(version);
    expect(classificationJobId("item-1", version)).toBe(
      classificationJobId("item-1", version),
    );
  });
});
