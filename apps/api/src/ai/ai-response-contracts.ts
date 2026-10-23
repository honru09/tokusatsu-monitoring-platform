import {
  categoryIps,
  conditionGrades,
  manufacturers,
  toyTypes,
  type CategoryIp,
  type ConditionGrade,
  type EvidenceField,
  type Manufacturer,
  type ToyType,
  type VisionClassification,
} from "@tokusatsu/shared";
import {
  recordResponseSchema,
  translationQualityIssues,
  type ResponseSchema,
  type ResponseSchemaIssue,
  type ResponseValidationResult,
} from "./ai-response-schema.js";

const INVALID = Symbol("invalid response value");
type Invalid = typeof INVALID;
type ReadResult<T> = T | Invalid;

const MAX_ALLOWED_VALUES = 1_000;
const MAX_ID_LENGTH = 200;
const MAX_SHORT_TEXT = 2_000;
const MAX_LONG_TEXT = 20_000;
const MAX_LIST_ITEMS = 100;

export type PriceJudgementResponse = {
  bestValueId: string;
  largestQuantityId: string;
  bestConditionId: string;
  recommendation: string;
  ranked: Array<{ id: string; reason: string }>;
  insights: string[];
  risks: string[];
};

export type ItemTranslationResponse = {
  titleZh: string;
  descriptionZh: string;
  conditionZh: string;
  shippingZh: string;
};

export type SellerBatchSummaryResponse = {
  catalogSummary: string;
  facts: string[];
  risks: string[];
};

export type SellerProfileResponse = {
  profile: string;
  negotiationJa: string;
  negotiationZh: string;
  suggestedPrice: number | null;
};

export type VisionClassificationResponse = VisionClassification &
  Record<string, unknown>;

export type AssistantToolPlanResponse = {
  selectedTools: string[];
  reasonZh: string;
};

export type AssistantAnswerResponse = {
  answerZh: string;
  referencedItemIds: string[];
  suggestions: string[];
};

export type CrawlerDiagnosisResponse = {
  summary: string;
  facts: string[];
  hypotheses: Array<{
    cause: string;
    evidence: string;
    verification: string;
  }>;
  recommendedPatch: string;
  tests: string[];
  requiresHumanApproval: true;
};

export type MarketBriefResponse = {
  facts: string[];
  inferences: string[];
  uncertainties: string[];
  risks: string[];
  actions: string[];
};

export type LogisticsPredictionResponse = {
  weightGrams: number | null;
  packageWeightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  estimatedSalePriceYen: number | null;
  reasoningZh: string;
  cautionsZh: string;
};

export type LogisticsExplanationResponse = {
  summaryZh: string;
  cautionsZh: string[];
  recommendationZh: string;
};

function issue(path: string, code: string): ResponseSchemaIssue {
  return { path, code };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredValue(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ResponseSchemaIssue[],
): unknown | Invalid {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    issues.push(issue(path, "required"));
    return INVALID;
  }
  return record[key];
}

function stringValue(
  value: unknown,
  path: string,
  issues: ResponseSchemaIssue[],
  maximum = MAX_SHORT_TEXT,
): ReadResult<string> {
  if (typeof value !== "string") {
    issues.push(issue(path, "type"));
    return INVALID;
  }
  const canonical = value.trim();
  if (!canonical) {
    issues.push(issue(path, "empty"));
    return INVALID;
  }
  if (canonical.length > maximum) {
    issues.push(issue(path, "length"));
    return INVALID;
  }
  return canonical;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ResponseSchemaIssue[],
  maximum = MAX_SHORT_TEXT,
): ReadResult<string> {
  const value = requiredValue(record, key, path, issues);
  return value === INVALID
    ? INVALID
    : stringValue(value, path, issues, maximum);
}

type StringArrayOptions = {
  minimum?: number;
  maximum?: number;
  itemMaximum?: number;
  unique?: boolean;
  allowed?: ReadonlySet<string>;
};

function stringArrayValue(
  value: unknown,
  path: string,
  issues: ResponseSchemaIssue[],
  options: StringArrayOptions = {},
): ReadResult<string[]> {
  if (!Array.isArray(value)) {
    issues.push(issue(path, "type"));
    return INVALID;
  }
  const start = issues.length;
  const minimum = options.minimum ?? 0;
  const maximum = options.maximum ?? MAX_LIST_ITEMS;
  if (value.length < minimum || value.length > maximum)
    issues.push(issue(path, "length"));
  const seen = new Set<string>();
  const canonical = value.flatMap((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const item = stringValue(
      entry,
      itemPath,
      issues,
      options.itemMaximum ?? MAX_SHORT_TEXT,
    );
    if (item === INVALID) return [];
    if (options.allowed && !options.allowed.has(item)) {
      issues.push(issue(itemPath, "not_allowed"));
      return [];
    }
    if (options.unique && seen.has(item)) {
      issues.push(issue(itemPath, "duplicate"));
      return [];
    }
    seen.add(item);
    return [item];
  });
  return issues.length === start ? canonical : INVALID;
}

function requiredStringArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ResponseSchemaIssue[],
  options: StringArrayOptions = {},
): ReadResult<string[]> {
  const value = requiredValue(record, key, path, issues);
  return value === INVALID
    ? INVALID
    : stringArrayValue(value, path, issues, options);
}

function requiredAllowedString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ResponseSchemaIssue[],
  allowed: ReadonlySet<string>,
): ReadResult<string> {
  const value = requiredString(record, key, path, issues, MAX_ID_LENGTH);
  if (value !== INVALID && !allowed.has(value)) {
    issues.push(issue(path, "not_allowed"));
    return INVALID;
  }
  return value;
}

function nullableIntegerValue(
  value: unknown,
  path: string,
  issues: ResponseSchemaIssue[],
  minimum: number,
  maximum: number,
): ReadResult<number | null> {
  if (value === INVALID) return INVALID;
  if (value === null) return null;
  if (typeof value !== "number") {
    issues.push(issue(path, "type"));
    return INVALID;
  }
  if (!Number.isSafeInteger(value)) {
    issues.push(issue(path, "integer"));
    return INVALID;
  }
  if (value < minimum || value > maximum) {
    issues.push(issue(path, "range"));
    return INVALID;
  }
  return value;
}

function requiredNullableInteger(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ResponseSchemaIssue[],
  minimum: number,
  maximum: number,
): ReadResult<number | null> {
  return nullableIntegerValue(
    requiredValue(record, key, path, issues),
    path,
    issues,
    minimum,
    maximum,
  );
}

function numberValue(
  value: unknown,
  path: string,
  issues: ResponseSchemaIssue[],
  minimum: number,
  maximum: number,
  integer = false,
): ReadResult<number> {
  if (typeof value !== "number") {
    issues.push(issue(path, "type"));
    return INVALID;
  }
  if (!Number.isFinite(value)) {
    issues.push(issue(path, "finite"));
    return INVALID;
  }
  if (integer && !Number.isSafeInteger(value)) {
    issues.push(issue(path, "integer"));
    return INVALID;
  }
  if (value < minimum || value > maximum) {
    issues.push(issue(path, "range"));
    return INVALID;
  }
  return value;
}

function requiredNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ResponseSchemaIssue[],
  minimum: number,
  maximum: number,
  integer = false,
): ReadResult<number> {
  const value = requiredValue(record, key, path, issues);
  return value === INVALID
    ? INVALID
    : numberValue(value, path, issues, minimum, maximum, integer);
}

function enumValue<T extends string>(
  value: unknown,
  path: string,
  issues: ResponseSchemaIssue[],
  allowed: ReadonlySet<string>,
): ReadResult<T> {
  const canonical = stringValue(value, path, issues, MAX_ID_LENGTH);
  if (canonical === INVALID) return INVALID;
  if (!allowed.has(canonical)) {
    issues.push(issue(path, "not_allowed"));
    return INVALID;
  }
  return canonical as T;
}

function nullableStringValue(
  value: unknown,
  path: string,
  issues: ResponseSchemaIssue[],
  maximum = MAX_SHORT_TEXT,
): ReadResult<string | null> {
  return value === null ? null : stringValue(value, path, issues, maximum);
}

function nullableStringArrayValue(
  value: unknown,
  path: string,
  issues: ResponseSchemaIssue[],
  options: StringArrayOptions = {},
): ReadResult<string[] | null> {
  return value === null ? null : stringArrayValue(value, path, issues, options);
}

function nullableEnumValue<T extends string>(
  value: unknown,
  path: string,
  issues: ResponseSchemaIssue[],
  allowed: ReadonlySet<string>,
): ReadResult<T | null> {
  return value === null ? null : enumValue<T>(value, path, issues, allowed);
}

function nullableEnumArrayValue<T extends string>(
  value: unknown,
  path: string,
  issues: ResponseSchemaIssue[],
  allowed: ReadonlySet<string>,
): ReadResult<T[] | null> {
  if (value === null) return null;
  const canonical = stringArrayValue(value, path, issues, {
    maximum: allowed.size,
    itemMaximum: MAX_ID_LENGTH,
    unique: true,
    allowed,
  });
  return canonical === INVALID ? INVALID : (canonical as T[]);
}

function nullablePositiveIntegerValue(
  value: unknown,
  path: string,
  issues: ResponseSchemaIssue[],
  maximum: number,
): ReadResult<number | null> {
  return value === null
    ? null
    : numberValue(value, path, issues, 1, maximum, true);
}

type EvidenceValueReader<T> = (
  value: unknown,
  path: string,
  issues: ResponseSchemaIssue[],
) => ReadResult<T | null>;

function evidenceField<T>(
  record: Record<string, unknown>,
  key: string,
  issues: ResponseSchemaIssue[],
  readValue: EvidenceValueReader<T>,
): ReadResult<EvidenceField<T>> {
  const raw = requiredValue(record, key, key, issues);
  if (raw === INVALID) return INVALID;
  if (!isRecord(raw)) {
    issues.push(issue(key, "type"));
    return INVALID;
  }
  const valueInput = requiredValue(raw, "value", `${key}.value`, issues);
  const value =
    valueInput === INVALID
      ? INVALID
      : readValue(valueInput, `${key}.value`, issues);
  const confidenceInput = requiredValue(
    raw,
    "confidence",
    `${key}.confidence`,
    issues,
  );
  const confidence =
    confidenceInput === INVALID
      ? INVALID
      : numberValue(confidenceInput, `${key}.confidence`, issues, 0, 1);
  const evidence = requiredStringArray(
    raw,
    "evidence",
    `${key}.evidence`,
    issues,
    { maximum: 20, itemMaximum: 1_000, unique: true },
  );
  return value === INVALID || confidence === INVALID || evidence === INVALID
    ? INVALID
    : { value, confidence, evidence };
}

function validateRecord<T extends Record<string, unknown>>(
  value: unknown,
  build: (record: Record<string, unknown>, issues: ResponseSchemaIssue[]) => T,
): ResponseValidationResult<T> {
  if (!isRecord(value)) return { success: false, issues: [issue("$", "type")] };
  const issues: ResponseSchemaIssue[] = [];
  const canonical = build(value, issues);
  return issues.length
    ? { success: false, issues }
    : { success: true, value: canonical };
}

function allowedValuesSnapshot(
  values: Iterable<string>,
  allowEmpty = false,
): ReadonlySet<string> {
  if (
    !values ||
    typeof values === "string" ||
    typeof (values as { [Symbol.iterator]?: unknown })[Symbol.iterator] !==
      "function"
  )
    throw new TypeError("Response contract allowlist is invalid");
  const snapshot = new Set<string>();
  let entryCount = 0;
  for (const value of values) {
    entryCount += 1;
    if (entryCount > MAX_ALLOWED_VALUES)
      throw new RangeError("Response contract allowlist is too large");
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > MAX_ID_LENGTH ||
      value.trim() !== value
    )
      throw new TypeError("Response contract allowlist value is invalid");
    snapshot.add(value);
  }
  if (!allowEmpty && snapshot.size === 0)
    throw new RangeError("Response contract allowlist is empty");
  return snapshot;
}

function priceRanking(
  value: unknown,
  issues: ResponseSchemaIssue[],
  allowed: ReadonlySet<string>,
): ReadResult<Array<{ id: string; reason: string }>> {
  if (value === INVALID) return INVALID;
  if (!Array.isArray(value)) {
    issues.push(issue("ranked", "type"));
    return INVALID;
  }
  const start = issues.length;
  if (value.length < 1 || value.length > 5)
    issues.push(issue("ranked", "length"));
  const seen = new Set<string>();
  const canonical = value.flatMap((entry, index) => {
    const path = `ranked[${index}]`;
    if (!isRecord(entry)) {
      issues.push(issue(path, "type"));
      return [];
    }
    const id = requiredAllowedString(
      entry,
      "id",
      `${path}.id`,
      issues,
      allowed,
    );
    const reason = requiredString(
      entry,
      "reason",
      `${path}.reason`,
      issues,
      80,
    );
    if (id !== INVALID && seen.has(id))
      issues.push(issue(`${path}.id`, "duplicate"));
    if (id !== INVALID) seen.add(id);
    return id === INVALID || reason === INVALID ? [] : [{ id, reason }];
  });
  return issues.length === start ? canonical : INVALID;
}

export function priceJudgementSchema(
  allowedIds: Iterable<string>,
): ResponseSchema<PriceJudgementResponse> {
  const allowed = allowedValuesSnapshot(allowedIds);
  return recordResponseSchema("procurement.price-judgement", 1, (value) =>
    validateRecord(value, (record, issues) => ({
      bestValueId: requiredAllowedString(
        record,
        "bestValueId",
        "bestValueId",
        issues,
        allowed,
      ) as string,
      largestQuantityId: requiredAllowedString(
        record,
        "largestQuantityId",
        "largestQuantityId",
        issues,
        allowed,
      ) as string,
      bestConditionId: requiredAllowedString(
        record,
        "bestConditionId",
        "bestConditionId",
        issues,
        allowed,
      ) as string,
      recommendation: requiredString(
        record,
        "recommendation",
        "recommendation",
        issues,
        MAX_LONG_TEXT,
      ) as string,
      ranked: priceRanking(
        requiredValue(record, "ranked", "ranked", issues),
        issues,
        allowed,
      ) as Array<{ id: string; reason: string }>,
      insights: requiredStringArray(record, "insights", "insights", issues, {
        minimum: 2,
        maximum: 4,
      }) as string[],
      risks: requiredStringArray(record, "risks", "risks", issues, {
        minimum: 2,
        maximum: 4,
      }) as string[],
    })),
  );
}

function validateItemTranslation(value: unknown) {
  return validateRecord<ItemTranslationResponse>(value, (record, issues) => ({
    titleZh: requiredString(
      record,
      "titleZh",
      "titleZh",
      issues,
      MAX_SHORT_TEXT,
    ) as string,
    descriptionZh: requiredString(
      record,
      "descriptionZh",
      "descriptionZh",
      issues,
      MAX_LONG_TEXT,
    ) as string,
    conditionZh: requiredString(
      record,
      "conditionZh",
      "conditionZh",
      issues,
      MAX_LONG_TEXT,
    ) as string,
    shippingZh: requiredString(
      record,
      "shippingZh",
      "shippingZh",
      issues,
      MAX_LONG_TEXT,
    ) as string,
  }));
}

export const ITEM_TRANSLATION_SCHEMA = recordResponseSchema(
  "translation.item-full",
  1,
  validateItemTranslation,
);

export function itemTranslationSchema(
  sources: Readonly<Record<keyof ItemTranslationResponse, string>>,
) {
  return recordResponseSchema<ItemTranslationResponse>(
    "translation.item-full",
    2,
    (value) => {
      const validated = validateItemTranslation(value);
      if (!validated.success) return validated;
      const issues = (
        Object.keys(sources) as Array<keyof ItemTranslationResponse>
      ).flatMap((field) =>
        translationQualityIssues(sources[field], validated.value[field], field),
      );
      return issues.length
        ? { success: false, issues }
        : { success: true, value: validated.value };
    },
  );
}

export const SELLER_BATCH_SUMMARY_SCHEMA = recordResponseSchema(
  "seller.batch-summary",
  1,
  (value) =>
    validateRecord<SellerBatchSummaryResponse>(value, (record, issues) => ({
      catalogSummary: requiredString(
        record,
        "catalogSummary",
        "catalogSummary",
        issues,
        MAX_LONG_TEXT,
      ) as string,
      facts: requiredStringArray(record, "facts", "facts", issues, {
        minimum: 1,
        maximum: 50,
      }) as string[],
      risks: requiredStringArray(record, "risks", "risks", issues, {
        maximum: 50,
      }) as string[],
    })),
);

export const SELLER_PROFILE_SCHEMA = recordResponseSchema(
  "seller.profile",
  1,
  (value) =>
    validateRecord<SellerProfileResponse>(value, (record, issues) => ({
      profile: requiredString(
        record,
        "profile",
        "profile",
        issues,
        MAX_LONG_TEXT,
      ) as string,
      negotiationJa: requiredString(
        record,
        "negotiationJa",
        "negotiationJa",
        issues,
        MAX_LONG_TEXT,
      ) as string,
      negotiationZh: requiredString(
        record,
        "negotiationZh",
        "negotiationZh",
        issues,
        MAX_LONG_TEXT,
      ) as string,
      suggestedPrice: nullableIntegerValue(
        requiredValue(record, "suggestedPrice", "suggestedPrice", issues),
        "suggestedPrice",
        issues,
        0,
        100_000_000,
      ) as number | null,
    })),
);

const CATEGORY_IP_VALUES = new Set<string>(categoryIps);
const TOY_TYPE_VALUES = new Set<string>(toyTypes);
const MANUFACTURER_VALUES = new Set<string>(manufacturers);
const CONDITION_VALUES = new Set<string>(conditionGrades);

export const VISION_CLASSIFICATION_SCHEMA = recordResponseSchema(
  "vision.classification",
  1,
  (value) =>
    validateRecord<VisionClassificationResponse>(value, (record, issues) => {
      const canonical: VisionClassification = {
        franchise: evidenceField<CategoryIp[]>(
          record,
          "franchise",
          issues,
          (entry, path, entryIssues) =>
            nullableEnumArrayValue<CategoryIp>(
              entry,
              path,
              entryIssues,
              CATEGORY_IP_VALUES,
            ),
        ) as EvidenceField<CategoryIp[]>,
        series: evidenceField<string[]>(
          record,
          "series",
          issues,
          (entry, path, entryIssues) =>
            nullableStringArrayValue(entry, path, entryIssues, {
              maximum: 50,
              itemMaximum: 1_000,
              unique: true,
            }),
        ) as EvidenceField<string[]>,
        characters: evidenceField<string[]>(
          record,
          "characters",
          issues,
          (entry, path, entryIssues) =>
            nullableStringArrayValue(entry, path, entryIssues, {
              maximum: 50,
              itemMaximum: 1_000,
              unique: true,
            }),
        ) as EvidenceField<string[]>,
        toyTypes: evidenceField<ToyType[]>(
          record,
          "toyTypes",
          issues,
          (entry, path, entryIssues) =>
            nullableEnumArrayValue<ToyType>(
              entry,
              path,
              entryIssues,
              TOY_TYPE_VALUES,
            ),
        ) as EvidenceField<ToyType[]>,
        manufacturers: evidenceField<Manufacturer[]>(
          record,
          "manufacturers",
          issues,
          (entry, path, entryIssues) =>
            nullableEnumArrayValue<Manufacturer>(
              entry,
              path,
              entryIssues,
              MANUFACTURER_VALUES,
            ),
        ) as EvidenceField<Manufacturer[]>,
        quantity: evidenceField<number>(
          record,
          "quantity",
          issues,
          (entry, path, entryIssues) =>
            nullablePositiveIntegerValue(entry, path, entryIssues, 1_000_000),
        ) as EvidenceField<number>,
        sealedCount: evidenceField<number>(
          record,
          "sealedCount",
          issues,
          (entry, path, entryIssues) =>
            nullablePositiveIntegerValue(entry, path, entryIssues, 1_000_000),
        ) as EvidenceField<number>,
        packaging: evidenceField<string[]>(
          record,
          "packaging",
          issues,
          (entry, path, entryIssues) =>
            nullableStringArrayValue(entry, path, entryIssues, {
              maximum: 50,
              itemMaximum: 1_000,
              unique: true,
            }),
        ) as EvidenceField<string[]>,
        condition: evidenceField<ConditionGrade>(
          record,
          "condition",
          issues,
          (entry, path, entryIssues) =>
            nullableEnumValue<ConditionGrade>(
              entry,
              path,
              entryIssues,
              CONDITION_VALUES,
            ),
        ) as EvidenceField<ConditionGrade>,
        visibleDamage: evidenceField<string[]>(
          record,
          "visibleDamage",
          issues,
          (entry, path, entryIssues) =>
            nullableStringArrayValue(entry, path, entryIssues, {
              maximum: 50,
              itemMaximum: 1_000,
              unique: true,
            }),
        ) as EvidenceField<string[]>,
        missingParts: evidenceField<string[]>(
          record,
          "missingParts",
          issues,
          (entry, path, entryIssues) =>
            nullableStringArrayValue(entry, path, entryIssues, {
              maximum: 50,
              itemMaximum: 1_000,
              unique: true,
            }),
        ) as EvidenceField<string[]>,
        backMarkings: evidenceField<string[]>(
          record,
          "backMarkings",
          issues,
          (entry, path, entryIssues) =>
            nullableStringArrayValue(entry, path, entryIssues, {
              maximum: 50,
              itemMaximum: 1_000,
              unique: true,
            }),
        ) as EvidenceField<string[]>,
        year: evidenceField<number>(
          record,
          "year",
          issues,
          (entry, path, entryIssues) =>
            nullablePositiveIntegerValue(entry, path, entryIssues, 10_000),
        ) as EvidenceField<number>,
        modelNumber: evidenceField<string>(
          record,
          "modelNumber",
          issues,
          (entry, path, entryIssues) =>
            nullableStringValue(entry, path, entryIssues, 1_000),
        ) as EvidenceField<string>,
        copyrightText: evidenceField<string[]>(
          record,
          "copyrightText",
          issues,
          (entry, path, entryIssues) =>
            nullableStringArrayValue(entry, path, entryIssues, {
              maximum: 50,
              itemMaximum: 1_000,
              unique: true,
            }),
        ) as EvidenceField<string[]>,
        confidence: requiredNumber(
          record,
          "confidence",
          "confidence",
          issues,
          0,
          1,
        ) as number,
      };
      return canonical as VisionClassificationResponse;
    }),
);

export function assistantToolPlanSchema(
  allowlist: Iterable<string>,
): ResponseSchema<AssistantToolPlanResponse> {
  const allowed = allowedValuesSnapshot(allowlist);
  return recordResponseSchema("assistant.tool-plan", 1, (value) =>
    validateRecord<AssistantToolPlanResponse>(value, (record, issues) => ({
      selectedTools: requiredStringArray(
        record,
        "selectedTools",
        "selectedTools",
        issues,
        {
          minimum: 1,
          maximum: 8,
          itemMaximum: MAX_ID_LENGTH,
          unique: true,
          allowed,
        },
      ) as string[],
      reasonZh: requiredString(
        record,
        "reasonZh",
        "reasonZh",
        issues,
        1_000,
      ) as string,
    })),
  );
}

export function assistantAnswerSchema(
  allowedItemIds: Iterable<string>,
): ResponseSchema<AssistantAnswerResponse> {
  const allowed = allowedValuesSnapshot(allowedItemIds, true);
  return recordResponseSchema("assistant.answer", 1, (value) =>
    validateRecord<AssistantAnswerResponse>(value, (record, issues) => ({
      answerZh: requiredString(
        record,
        "answerZh",
        "answerZh",
        issues,
        4_000,
      ) as string,
      referencedItemIds: requiredStringArray(
        record,
        "referencedItemIds",
        "referencedItemIds",
        issues,
        {
          maximum: 8,
          itemMaximum: MAX_ID_LENGTH,
          unique: true,
          allowed,
        },
      ) as string[],
      suggestions: requiredStringArray(
        record,
        "suggestions",
        "suggestions",
        issues,
        { maximum: 4, itemMaximum: 1_000, unique: true },
      ) as string[],
    })),
  );
}

function diagnosisHypotheses(
  value: unknown,
  issues: ResponseSchemaIssue[],
): ReadResult<CrawlerDiagnosisResponse["hypotheses"]> {
  if (value === INVALID) return INVALID;
  if (!Array.isArray(value)) {
    issues.push(issue("hypotheses", "type"));
    return INVALID;
  }
  const start = issues.length;
  if (value.length > 50) issues.push(issue("hypotheses", "length"));
  const canonical = value.flatMap((entry, index) => {
    const path = `hypotheses[${index}]`;
    if (!isRecord(entry)) {
      issues.push(issue(path, "type"));
      return [];
    }
    const cause = requiredString(
      entry,
      "cause",
      `${path}.cause`,
      issues,
      5_000,
    );
    const evidence = requiredString(
      entry,
      "evidence",
      `${path}.evidence`,
      issues,
      5_000,
    );
    const verification = requiredString(
      entry,
      "verification",
      `${path}.verification`,
      issues,
      5_000,
    );
    return cause === INVALID || evidence === INVALID || verification === INVALID
      ? []
      : [{ cause, evidence, verification }];
  });
  return issues.length === start ? canonical : INVALID;
}

function requiredLiteralTrue(
  record: Record<string, unknown>,
  key: string,
  issues: ResponseSchemaIssue[],
): ReadResult<true> {
  const value = requiredValue(record, key, key, issues);
  if (value === INVALID) return INVALID;
  if (value !== true) {
    issues.push(issue(key, "literal"));
    return INVALID;
  }
  return true;
}

export const CRAWLER_DIAGNOSIS_SCHEMA = recordResponseSchema(
  "crawler.diagnosis",
  1,
  (value) =>
    validateRecord<CrawlerDiagnosisResponse>(value, (record, issues) => ({
      summary: requiredString(
        record,
        "summary",
        "summary",
        issues,
        5_000,
      ) as string,
      facts: requiredStringArray(record, "facts", "facts", issues, {
        minimum: 1,
        maximum: 100,
        itemMaximum: 2_000,
      }) as string[],
      hypotheses: diagnosisHypotheses(
        requiredValue(record, "hypotheses", "hypotheses", issues),
        issues,
      ) as CrawlerDiagnosisResponse["hypotheses"],
      recommendedPatch: requiredString(
        record,
        "recommendedPatch",
        "recommendedPatch",
        issues,
        MAX_LONG_TEXT,
      ) as string,
      tests: requiredStringArray(record, "tests", "tests", issues, {
        minimum: 1,
        maximum: 100,
        itemMaximum: 2_000,
      }) as string[],
      requiresHumanApproval: requiredLiteralTrue(
        record,
        "requiresHumanApproval",
        issues,
      ) as true,
    })),
);

export const MARKET_BRIEF_SCHEMA = recordResponseSchema(
  "market.brief",
  1,
  (value) =>
    validateRecord<MarketBriefResponse>(value, (record, issues) => ({
      facts: requiredStringArray(record, "facts", "facts", issues, {
        minimum: 1,
        maximum: 100,
        itemMaximum: 2_000,
      }) as string[],
      inferences: requiredStringArray(
        record,
        "inferences",
        "inferences",
        issues,
        { maximum: 100, itemMaximum: 2_000 },
      ) as string[],
      uncertainties: requiredStringArray(
        record,
        "uncertainties",
        "uncertainties",
        issues,
        { maximum: 100, itemMaximum: 2_000 },
      ) as string[],
      risks: requiredStringArray(record, "risks", "risks", issues, {
        maximum: 100,
        itemMaximum: 2_000,
      }) as string[],
      actions: requiredStringArray(record, "actions", "actions", issues, {
        maximum: 100,
        itemMaximum: 2_000,
      }) as string[],
    })),
);

export const LOGISTICS_PREDICTION_SCHEMA = recordResponseSchema(
  "logistics.prediction",
  1,
  (value) =>
    validateRecord<LogisticsPredictionResponse>(value, (record, issues) => ({
      weightGrams: requiredNullableInteger(
        record,
        "weightGrams",
        "weightGrams",
        issues,
        1,
        2_000_000,
      ) as number | null,
      packageWeightGrams: requiredNullableInteger(
        record,
        "packageWeightGrams",
        "packageWeightGrams",
        issues,
        1,
        2_000_000,
      ) as number | null,
      lengthMm: requiredNullableInteger(
        record,
        "lengthMm",
        "lengthMm",
        issues,
        1,
        5_000,
      ) as number | null,
      widthMm: requiredNullableInteger(
        record,
        "widthMm",
        "widthMm",
        issues,
        1,
        5_000,
      ) as number | null,
      heightMm: requiredNullableInteger(
        record,
        "heightMm",
        "heightMm",
        issues,
        1,
        5_000,
      ) as number | null,
      estimatedSalePriceYen: requiredNullableInteger(
        record,
        "estimatedSalePriceYen",
        "estimatedSalePriceYen",
        issues,
        1,
        100_000_000,
      ) as number | null,
      reasoningZh: requiredString(
        record,
        "reasoningZh",
        "reasoningZh",
        issues,
        5_000,
      ) as string,
      cautionsZh: requiredString(
        record,
        "cautionsZh",
        "cautionsZh",
        issues,
        5_000,
      ) as string,
    })),
);

export const LOGISTICS_EXPLANATION_SCHEMA = recordResponseSchema(
  "logistics.explanation",
  1,
  (value) =>
    validateRecord<LogisticsExplanationResponse>(value, (record, issues) => ({
      summaryZh: requiredString(
        record,
        "summaryZh",
        "summaryZh",
        issues,
        5_000,
      ) as string,
      cautionsZh: requiredStringArray(
        record,
        "cautionsZh",
        "cautionsZh",
        issues,
        { maximum: 50, itemMaximum: 2_000 },
      ) as string[],
      recommendationZh: requiredString(
        record,
        "recommendationZh",
        "recommendationZh",
        issues,
        5_000,
      ) as string,
    })),
);
