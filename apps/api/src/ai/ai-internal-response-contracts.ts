import { BadRequestException } from "@nestjs/common";
import {
  categoryIps,
  conditionGrades,
  manufacturers,
  toyTypes,
} from "@tokusatsu/shared";
import type { AiTask } from "./ai-router.js";
import type { ProductAiOperation } from "./product-ai.service.js";
import {
  recordResponseSchema,
  type ResponseSchemaIssue,
} from "./ai-response-schema.js";

export const INTERNAL_RESPONSE_CONTRACTS = [
  "market_intel_translation",
  "china_search_keywords",
  "china_candidate_decisions",
  "procurement_review",
  "automatic_classification",
  "advanced_classification",
] as const;

export type InternalResponseContract =
  (typeof INTERNAL_RESPONSE_CONTRACTS)[number];

export const INTERNAL_RESPONSE_SCHEMA_IDS = [
  "internal.market-intel-translation",
  "internal.china-search-keywords",
  "internal.china-candidate-decisions",
  "internal.procurement-review",
  "internal.automatic-classification",
  "internal.advanced-classification",
] as const;

export type InternalResponseSchemaId =
  (typeof INTERNAL_RESPONSE_SCHEMA_IDS)[number];

const CONTRACT_BY_SCHEMA_ID = {
  "internal.market-intel-translation": "market_intel_translation",
  "internal.china-search-keywords": "china_search_keywords",
  "internal.china-candidate-decisions": "china_candidate_decisions",
  "internal.procurement-review": "procurement_review",
  "internal.automatic-classification": "automatic_classification",
  "internal.advanced-classification": "advanced_classification",
} as const satisfies Record<InternalResponseSchemaId, InternalResponseContract>;

function contractForSchema(id: string, version: number) {
  if (
    version !== 1 ||
    !INTERNAL_RESPONSE_SCHEMA_IDS.includes(id as InternalResponseSchemaId)
  )
    throw new BadRequestException("Unknown response schema id or version");
  return CONTRACT_BY_SCHEMA_ID[id as InternalResponseSchemaId];
}

type Validator<T> = (
  value: unknown,
  path: string,
  issues: ResponseSchemaIssue[],
) => T | undefined;

function issue(issues: ResponseSchemaIssue[], path: string, code: string) {
  issues.push({ path, code });
}

function recordValue(
  value: unknown,
  path: string,
  issues: ResponseSchemaIssue[],
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issue(issues, path, "type");
    return undefined;
  }
  return value as Record<string, unknown>;
}

function required<T>(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ResponseSchemaIssue[],
  validate: Validator<T>,
) {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    issue(issues, path, "required");
    return undefined;
  }
  return validate(record[key], path, issues);
}

function textValue(maximum: number, allowEmpty = false): Validator<string> {
  return (value, path, issues) => {
    if (typeof value !== "string") {
      issue(issues, path, "type");
      return undefined;
    }
    const canonical = value.trim();
    if (!allowEmpty && !canonical) {
      issue(issues, path, "empty");
      return undefined;
    }
    if (canonical.length > maximum) {
      issue(issues, path, "length");
      return undefined;
    }
    return canonical;
  };
}

function booleanValue(
  value: unknown,
  path: string,
  issues: ResponseSchemaIssue[],
) {
  if (typeof value !== "boolean") {
    issue(issues, path, "type");
    return undefined;
  }
  return value;
}

function numberValue(minimum: number, maximum: number): Validator<number> {
  return (value, path, issues) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issue(issues, path, "type");
      return undefined;
    }
    if (value < minimum || value > maximum) {
      issue(issues, path, "range");
      return undefined;
    }
    return value;
  };
}

function integerValue(
  minimum: number,
  maximum: number,
  nullable = false,
): Validator<number | null> {
  return (value, path, issues) => {
    if (nullable && value === null) return null;
    if (!Number.isSafeInteger(value)) {
      issue(issues, path, "integer");
      return undefined;
    }
    const number = value as number;
    if (number < minimum || number > maximum) {
      issue(issues, path, "range");
      return undefined;
    }
    return number;
  };
}

function allowedValue<T extends string>(values: readonly T[]): Validator<T> {
  const allowed = new Set<string>(values);
  return (value, path, issues) => {
    if (typeof value !== "string") {
      issue(issues, path, "type");
      return undefined;
    }
    if (!allowed.has(value)) {
      issue(issues, path, "not_allowed");
      return undefined;
    }
    return value as T;
  };
}

function arrayValue<T>(
  validate: Validator<T>,
  options: { minimum?: number; maximum: number; unique?: boolean },
): Validator<T[]> {
  return (value, path, issues) => {
    if (!Array.isArray(value)) {
      issue(issues, path, "type");
      return undefined;
    }
    if (value.length < (options.minimum ?? 0) || value.length > options.maximum)
      issue(issues, path, "length");
    const start = issues.length;
    const canonical = value.flatMap((entry, index) => {
      const parsed = validate(entry, `${path}[${index}]`, issues);
      return parsed === undefined ? [] : [parsed];
    });
    if (options.unique && new Set(canonical).size !== canonical.length)
      issue(issues, path, "duplicate");
    return issues.length === start ? canonical : undefined;
  };
}

function strictSchema(
  id: string,
  build: (
    record: Record<string, unknown>,
    issues: ResponseSchemaIssue[],
  ) => Record<string, unknown>,
) {
  return recordResponseSchema(id, 1, (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { success: false, issues: [{ path: "$", code: "type" }] };
    const issues: ResponseSchemaIssue[] = [];
    const canonical = build(value as Record<string, unknown>, issues);
    return issues.length
      ? { success: false, issues }
      : { success: true, value: canonical };
  });
}

const strings = (minimum: number, maximum: number, itemMaximum = 2_000) =>
  arrayValue(textValue(itemMaximum), { minimum, maximum, unique: true });

const MARKET_INTEL_TRANSLATION_SCHEMA = strictSchema(
  "internal.market-intel-translation",
  (record, issues) => ({
    titleZh: required(
      record,
      "titleZh",
      "titleZh",
      issues,
      textValue(2_000, true),
    ),
    bodyZh: required(record, "bodyZh", "bodyZh", issues, textValue(20_000)),
  }),
);

const CHINA_SEARCH_KEYWORDS_SCHEMA = strictSchema(
  "internal.china-search-keywords",
  (record, issues) => ({
    keywords: required(
      record,
      "keywords",
      "keywords",
      issues,
      arrayValue(textValue(100), { minimum: 3, maximum: 8, unique: true }),
    ),
  }),
);

function expectedIdSet(expectedIds: readonly string[]) {
  if (
    !Array.isArray(expectedIds) ||
    expectedIds.some((id) => typeof id !== "string")
  )
    throw new BadRequestException("Invalid response schema context");
  const normalized = expectedIds.map((id) => id.trim());
  if (
    normalized.length < 1 ||
    normalized.length > 100 ||
    normalized.some((id) => !id || id.length > 200) ||
    new Set(normalized).size !== normalized.length
  )
    throw new BadRequestException("Invalid response schema context");
  return new Set(normalized);
}

function chinaCandidateDecisionsSchema(expectedIds: readonly string[]) {
  const allowed = expectedIdSet(expectedIds);
  return strictSchema(
    "internal.china-candidate-decisions",
    (record, issues) => {
      const decisions = required(
        record,
        "decisions",
        "decisions",
        issues,
        arrayValue(
          (entry, path, entryIssues) => {
            const row = recordValue(entry, path, entryIssues);
            if (!row) return undefined;
            const sourceListingId = required(
              row,
              "sourceListingId",
              `${path}.sourceListingId`,
              entryIssues,
              textValue(200),
            );
            if (sourceListingId && !allowed.has(sourceListingId))
              issue(entryIssues, `${path}.sourceListingId`, "not_allowed");
            return {
              sourceListingId,
              sameProduct: required(
                row,
                "sameProduct",
                `${path}.sameProduct`,
                entryIssues,
                booleanValue,
              ),
              confidence: required(
                row,
                "confidence",
                `${path}.confidence`,
                entryIssues,
                numberValue(0, 1),
              ),
              accessoryOnly: required(
                row,
                "accessoryOnly",
                `${path}.accessoryOnly`,
                entryIssues,
                booleanValue,
              ),
              damaged: required(
                row,
                "damaged",
                `${path}.damaged`,
                entryIssues,
                booleanValue,
              ),
              quantityConflict: required(
                row,
                "quantityConflict",
                `${path}.quantityConflict`,
                entryIssues,
                booleanValue,
              ),
              modelConflict: required(
                row,
                "modelConflict",
                `${path}.modelConflict`,
                entryIssues,
                booleanValue,
              ),
              versionConflict: required(
                row,
                "versionConflict",
                `${path}.versionConflict`,
                entryIssues,
                booleanValue,
              ),
              scaleConflict: required(
                row,
                "scaleConflict",
                `${path}.scaleConflict`,
                entryIssues,
                booleanValue,
              ),
              conditionConflict: required(
                row,
                "conditionConflict",
                `${path}.conditionConflict`,
                entryIssues,
                booleanValue,
              ),
              evidence: required(
                row,
                "evidence",
                `${path}.evidence`,
                entryIssues,
                strings(1, 6, 500),
              ),
            };
          },
          { minimum: allowed.size, maximum: allowed.size },
        ),
      );
      if (Array.isArray(decisions)) {
        const ids = decisions.map((entry) => entry.sourceListingId);
        if (new Set(ids).size !== ids.length)
          issue(issues, "decisions", "duplicate");
        for (const id of allowed)
          if (!ids.includes(id)) issue(issues, `decisions[${id}]`, "missing");
      }
      return { decisions };
    },
  );
}

const PROCUREMENT_REVIEW_SCHEMA = strictSchema(
  "internal.procurement-review",
  (record, issues) => ({
    scope: required(
      record,
      "scope",
      "scope",
      issues,
      allowedValue([
        "tokusatsu_toy",
        "excluded_card_or_book",
        "unrelated",
        "unknown",
      ] as const),
    ),
    procurementCategory: required(
      record,
      "procurementCategory",
      "procurementCategory",
      issues,
      allowedValue([
        "preferred",
        "promising",
        "needs_facts",
        "deprioritized",
      ] as const),
    ),
    compactness: required(
      record,
      "compactness",
      "compactness",
      issues,
      allowedValue(["compact", "likely_compact", "bulky", "unknown"] as const),
    ),
    verifiedFacts: required(
      record,
      "verifiedFacts",
      "verifiedFacts",
      issues,
      strings(0, 50),
    ),
    contradictedFacts: required(
      record,
      "contradictedFacts",
      "contradictedFacts",
      issues,
      arrayValue(
        (entry, path, entryIssues) => {
          const row = recordValue(entry, path, entryIssues);
          return row
            ? {
                field: required(
                  row,
                  "field",
                  `${path}.field`,
                  entryIssues,
                  textValue(200),
                ),
                evidence: required(
                  row,
                  "evidence",
                  `${path}.evidence`,
                  entryIssues,
                  textValue(2_000),
                ),
              }
            : undefined;
        },
        { maximum: 50 },
      ),
    ),
    missingFacts: required(
      record,
      "missingFacts",
      "missingFacts",
      issues,
      arrayValue(
        allowedValue([
          "price",
          "shipping_fee",
          "listing_type",
          "quantity",
          "volume",
          "condition",
        ] as const),
        { maximum: 6, unique: true },
      ),
    ),
    shouldAnalyze: required(
      record,
      "shouldAnalyze",
      "shouldAnalyze",
      issues,
      booleanValue,
    ),
    confidence: required(
      record,
      "confidence",
      "confidence",
      issues,
      numberValue(0, 1),
    ),
    evidence: required(record, "evidence", "evidence", issues, strings(0, 50)),
  }),
);

function evidenceField(
  valueValidator: Validator<unknown>,
): Validator<Record<string, unknown>> {
  return (value, path, issues) => {
    const record = recordValue(value, path, issues);
    return record
      ? {
          value: required(
            record,
            "value",
            `${path}.value`,
            issues,
            valueValidator,
          ),
          confidence: required(
            record,
            "confidence",
            `${path}.confidence`,
            issues,
            numberValue(0, 1),
          ),
          evidence: required(
            record,
            "evidence",
            `${path}.evidence`,
            issues,
            strings(0, 20, 1_000),
          ),
        }
      : undefined;
  };
}

function nullable<T>(validate: Validator<T>): Validator<T | null> {
  return (value, path, issues) =>
    value === null ? null : validate(value, path, issues);
}

const AUTOMATIC_CLASSIFICATION_SCHEMA = strictSchema(
  "internal.automatic-classification",
  (record, issues) => ({
    scope: required(
      record,
      "scope",
      "scope",
      issues,
      allowedValue([
        "tokusatsu_toy",
        "excluded_card_or_book",
        "unrelated",
        "unknown",
      ] as const),
    ),
    categoryIp: required(
      record,
      "categoryIp",
      "categoryIp",
      issues,
      evidenceField(nullable(allowedValue(categoryIps))),
    ),
    categoryToyType: required(
      record,
      "categoryToyType",
      "categoryToyType",
      issues,
      evidenceField(nullable(allowedValue(toyTypes))),
    ),
    manufacturer: required(
      record,
      "manufacturer",
      "manufacturer",
      issues,
      evidenceField(nullable(allowedValue(manufacturers))),
    ),
    conditionGrade: required(
      record,
      "conditionGrade",
      "conditionGrade",
      issues,
      evidenceField(nullable(allowedValue(conditionGrades))),
    ),
    quantity: required(
      record,
      "quantity",
      "quantity",
      issues,
      evidenceField(integerValue(1, 500, true)),
    ),
    series: required(
      record,
      "series",
      "series",
      issues,
      evidenceField(nullable(textValue(1_000))),
    ),
    subSeries: required(
      record,
      "subSeries",
      "subSeries",
      issues,
      evidenceField(nullable(textValue(1_000))),
    ),
    bulkSale: required(
      record,
      "bulkSale",
      "bulkSale",
      issues,
      evidenceField(nullable(booleanValue)),
    ),
    needsImageAnalysis: required(
      record,
      "needsImageAnalysis",
      "needsImageAnalysis",
      issues,
      evidenceField(nullable(booleanValue)),
    ),
    confidence: required(
      record,
      "confidence",
      "confidence",
      issues,
      numberValue(0, 1),
    ),
  }),
);

const ADVANCED_CLASSIFICATION_SCHEMA = strictSchema(
  "internal.advanced-classification",
  (record, issues) => ({
    knownFacts: required(
      record,
      "knownFacts",
      "knownFacts",
      issues,
      strings(0, 100),
    ),
    inferences: required(
      record,
      "inferences",
      "inferences",
      issues,
      strings(0, 100),
    ),
    uncertainties: required(
      record,
      "uncertainties",
      "uncertainties",
      issues,
      strings(0, 100),
    ),
    risks: required(record, "risks", "risks", issues, strings(0, 100)),
    evidence: required(record, "evidence", "evidence", issues, strings(0, 100)),
    recommendedAction: required(
      record,
      "recommendedAction",
      "recommendedAction",
      issues,
      textValue(5_000),
    ),
    confidence: required(
      record,
      "confidence",
      "confidence",
      issues,
      numberValue(0, 1),
    ),
  }),
);

const STATIC_SCHEMAS = {
  market_intel_translation: MARKET_INTEL_TRANSLATION_SCHEMA,
  china_search_keywords: CHINA_SEARCH_KEYWORDS_SCHEMA,
  procurement_review: PROCUREMENT_REVIEW_SCHEMA,
  automatic_classification: AUTOMATIC_CLASSIFICATION_SCHEMA,
  advanced_classification: ADVANCED_CLASSIFICATION_SCHEMA,
} as const;

const PRODUCT_CONTRACTS: Record<
  ProductAiOperation,
  readonly InternalResponseContract[]
> = {
  product_identification: ["china_candidate_decisions"],
  image_analysis: ["china_candidate_decisions"],
  price_judgement: [],
  procurement_filter: ["procurement_review"],
  title_parsing: ["china_search_keywords"],
  automatic_classification: [
    "automatic_classification",
    "advanced_classification",
  ],
  translation: [],
};

export function internalGatewayResponseSchema(
  task: AiTask,
  schemaId: string,
  schemaVersion: number,
) {
  const contract = contractForSchema(schemaId, schemaVersion);
  if (task !== "translation" || contract !== "market_intel_translation")
    throw new BadRequestException("Response schema is not allowed for task");
  return STATIC_SCHEMAS.market_intel_translation;
}

export function internalProductResponseSchema(
  operation: ProductAiOperation,
  schemaId: string,
  schemaVersion: number,
  expectedIds?: readonly string[],
) {
  const contract = contractForSchema(schemaId, schemaVersion);
  const allowedContracts = Object.prototype.hasOwnProperty.call(
    PRODUCT_CONTRACTS,
    operation,
  )
    ? PRODUCT_CONTRACTS[operation]
    : undefined;
  if (!allowedContracts?.includes(contract))
    throw new BadRequestException(
      "Response schema is not allowed for operation",
    );
  if (contract === "china_candidate_decisions")
    return chinaCandidateDecisionsSchema(expectedIds ?? []);
  if (expectedIds !== undefined)
    throw new BadRequestException("Invalid response schema context");
  const schema = STATIC_SCHEMAS[contract as keyof typeof STATIC_SCHEMAS];
  if (!schema) throw new BadRequestException("Unknown response schema");
  return schema;
}
