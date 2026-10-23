import { afterEach, describe, expect, it } from "vitest";
import {
  automaticClassificationContentVersion,
  classificationJobId,
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
