import { createHash } from "node:crypto";

export type ResponseSchemaIssue = Readonly<{
  path: string;
  code: string;
}>;

export type ResponseValidationResult<T> =
  | Readonly<{ success: true; value: T }>
  | Readonly<{ success: false; issues: readonly ResponseSchemaIssue[] }>;

export type ResponseValidator<T> = (
  value: unknown,
) => ResponseValidationResult<T>;

export type ResponseSchema<T extends Record<string, unknown>> = Readonly<{
  id: string;
  version: number;
  validate: ResponseValidator<T>;
}>;

export type BatchTranslationResponse = {
  translations: string[];
};

export type DetailFragmentTranslation = {
  fragmentKey: string;
  path: string;
  labelZh: string;
  valueZh: string;
};

export type DetailFragmentsResponse = {
  translations: DetailFragmentTranslation[];
};

const MAX_SCHEMA_ID_LENGTH = 80;
const MAX_SCHEMA_VERSION = 999_999;
const MAX_EXPECTED_ITEMS = 10_000;
const MAX_FRAGMENT_IDENTITY_LENGTH = 500;
const SAFE_SCHEMA_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function assertSchemaIdentity(id: string, version: number) {
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > MAX_SCHEMA_ID_LENGTH ||
    !SAFE_SCHEMA_ID.test(id)
  )
    throw new TypeError("Response schema id is invalid");
  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > MAX_SCHEMA_VERSION
  )
    throw new RangeError("Response schema version is invalid");
}

export function responseSchemaIdentity(id: string, version: number) {
  assertSchemaIdentity(id, version);
  return `${id}@${version}`;
}

export function responseSchemaIdentityHash(id: string, version: number) {
  return createHash("sha256")
    .update(responseSchemaIdentity(id, version), "utf8")
    .digest("hex");
}

export function recordResponseSchema<T extends Record<string, unknown>>(
  id: string,
  version: number,
  validate: ResponseValidator<T>,
): ResponseSchema<T> {
  assertSchemaIdentity(id, version);
  if (typeof validate !== "function")
    throw new TypeError("Response schema validator is invalid");
  return Object.freeze({ id, version, validate });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function issue(path: string, code: string): ResponseSchemaIssue {
  return { path, code };
}

function trimmedString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ResponseSchemaIssue[],
) {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    issues.push(issue(path, "required"));
    return undefined;
  }
  const value = record[key];
  if (typeof value !== "string") {
    issues.push(issue(path, "type"));
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    issues.push(issue(path, "empty"));
    return undefined;
  }
  return trimmed;
}

function assertExpectedCount(expectedCount: number) {
  if (
    !Number.isSafeInteger(expectedCount) ||
    expectedCount < 1 ||
    expectedCount > MAX_EXPECTED_ITEMS
  )
    throw new RangeError("Expected response item count is invalid");
}

function normalizedTranslationText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function numericFacts(value: string) {
  return (value.normalize("NFKC").match(/\d+(?:[.,]\d+)*/g) ?? []).map(
    (entry) => entry.replace(/[.,]/g, ""),
  );
}

/**
 * Reject structurally valid responses that are not usable translations. The
 * checks are deliberately conservative: they catch verbatim Japanese output,
 * severe truncation, and dropped numeric facts without rejecting retained
 * product names or model numbers.
 */
export function translationQualityIssues(
  source: string,
  translated: string,
  path: string,
): ResponseSchemaIssue[] {
  const issues: ResponseSchemaIssue[] = [];
  const sourceText = source.trim();
  const translatedText = translated.trim();
  const hasJapaneseKana = /[\u3040-\u30ff\u31f0-\u31ff]/u.test(sourceText);
  if (
    hasJapaneseKana &&
    normalizedTranslationText(sourceText) ===
      normalizedTranslationText(translatedText)
  )
    issues.push(issue(path, "untranslated"));

  const minimumLength = Math.min(
    160,
    Math.max(4, Math.ceil(sourceText.length * 0.2)),
  );
  if (
    hasJapaneseKana &&
    sourceText.length >= 12 &&
    translatedText.length < minimumLength
  )
    issues.push(issue(path, "truncated"));

  const translatedNumbers = new Set(numericFacts(translatedText));
  if (numericFacts(sourceText).some((number) => !translatedNumbers.has(number)))
    issues.push(issue(path, "numeric_fact_missing"));
  return issues;
}

export function batchTranslationSchema(
  expected: number | readonly string[],
): ResponseSchema<BatchTranslationResponse> {
  const expectedSources = Array.isArray(expected)
    ? expected.map((entry) => entry.trim())
    : undefined;
  const expectedCount = expectedSources?.length ?? (expected as number);
  assertExpectedCount(expectedCount);
  return recordResponseSchema(
    "translation.batch",
    expectedSources ? 2 : 1,
    (value) => {
      if (!isRecord(value))
        return { success: false, issues: [issue("$", "type")] };
      if (!Object.prototype.hasOwnProperty.call(value, "translations"))
        return {
          success: false,
          issues: [issue("translations", "required")],
        };
      if (!Array.isArray(value.translations))
        return { success: false, issues: [issue("translations", "type")] };

      const issues: ResponseSchemaIssue[] = [];
      if (value.translations.length !== expectedCount)
        issues.push(issue("translations", "length"));
      const translations = value.translations.map((entry, index) => {
        if (typeof entry !== "string") {
          issues.push(issue(`translations[${index}]`, "type"));
          return undefined;
        }
        const trimmed = entry.trim();
        if (!trimmed) {
          issues.push(issue(`translations[${index}]`, "empty"));
          return undefined;
        }
        const source = expectedSources?.[index];
        if (source)
          issues.push(
            ...translationQualityIssues(
              source,
              trimmed,
              `translations[${index}]`,
            ),
          );
        return trimmed;
      });
      if (issues.length) return { success: false, issues };
      return {
        success: true,
        value: { translations: translations as string[] },
      };
    },
  );
}

function expectedFragmentsSnapshot(
  expected: ReadonlyMap<string, string>,
): Map<string, string> {
  if (!(expected instanceof Map))
    throw new TypeError("Expected fragments must be a Map");
  if (expected.size < 1 || expected.size > MAX_EXPECTED_ITEMS)
    throw new RangeError("Expected fragment count is invalid");
  const snapshot = new Map<string, string>();
  for (const [fragmentKey, path] of expected) {
    if (
      typeof fragmentKey !== "string" ||
      fragmentKey.length === 0 ||
      fragmentKey.length > MAX_FRAGMENT_IDENTITY_LENGTH ||
      fragmentKey.trim() !== fragmentKey
    )
      throw new TypeError("Expected fragment key is invalid");
    if (
      typeof path !== "string" ||
      path.length === 0 ||
      path.length > MAX_FRAGMENT_IDENTITY_LENGTH ||
      path.trim() !== path
    )
      throw new TypeError("Expected fragment path is invalid");
    snapshot.set(fragmentKey, path);
  }
  return snapshot;
}

export function detailFragmentsSchema(
  expected: ReadonlyMap<string, string>,
  sources?: ReadonlyMap<string, string>,
): ResponseSchema<DetailFragmentsResponse> {
  const expectedFragments = expectedFragmentsSnapshot(expected);
  return recordResponseSchema(
    "translation.detail-fragments",
    sources ? 2 : 1,
    (value) => {
      if (!isRecord(value))
        return { success: false, issues: [issue("$", "type")] };
      if (!Object.prototype.hasOwnProperty.call(value, "translations"))
        return {
          success: false,
          issues: [issue("translations", "required")],
        };
      if (!Array.isArray(value.translations))
        return { success: false, issues: [issue("translations", "type")] };

      const issues: ResponseSchemaIssue[] = [];
      if (value.translations.length !== expectedFragments.size)
        issues.push(issue("translations", "length"));
      const seen = new Set<string>();
      const canonical = new Map<string, DetailFragmentTranslation>();

      value.translations.forEach((entry, index) => {
        const rowPath = `translations[${index}]`;
        if (!isRecord(entry)) {
          issues.push(issue(rowPath, "type"));
          return;
        }
        const fragmentKey = trimmedString(
          entry,
          "fragmentKey",
          `${rowPath}.fragmentKey`,
          issues,
        );
        const path = trimmedString(entry, "path", `${rowPath}.path`, issues);
        const labelZh = trimmedString(
          entry,
          "labelZh",
          `${rowPath}.labelZh`,
          issues,
        );
        const valueZh = trimmedString(
          entry,
          "valueZh",
          `${rowPath}.valueZh`,
          issues,
        );
        if (!fragmentKey) return;
        const expectedPath = expectedFragments.get(fragmentKey);
        if (expectedPath === undefined) {
          issues.push(issue(`${rowPath}.fragmentKey`, "unknown_fragment"));
          return;
        }
        if (seen.has(fragmentKey)) {
          issues.push(issue(`${rowPath}.fragmentKey`, "duplicate_fragment"));
          return;
        }
        seen.add(fragmentKey);
        if (path !== undefined && path !== expectedPath)
          issues.push(issue(`${rowPath}.path`, "path_mismatch"));
        if (
          path === expectedPath &&
          labelZh !== undefined &&
          valueZh !== undefined
        ) {
          const source = sources?.get(fragmentKey);
          if (source)
            issues.push(
              ...translationQualityIssues(
                source,
                valueZh,
                `${rowPath}.valueZh`,
              ),
            );
          canonical.set(fragmentKey, {
            fragmentKey,
            path,
            labelZh,
            valueZh,
          });
        }
      });

      for (const fragmentKey of expectedFragments.keys()) {
        if (!seen.has(fragmentKey))
          issues.push(
            issue(`translations[${fragmentKey}]`, "missing_fragment"),
          );
      }
      if (issues.length) return { success: false, issues };
      return {
        success: true,
        value: {
          translations: [...expectedFragments.keys()].map(
            (fragmentKey) => canonical.get(fragmentKey)!,
          ),
        },
      };
    },
  );
}
