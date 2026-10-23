import { recordResponseSchema } from "./ai-response-schema.js";

export type ProductReading = {
  summaryZh: string;
  observedFacts: { field: string; value: string | null; evidence: string }[];
  missingFacts: string[];
};

export const PRODUCT_READING_SCHEMA = recordResponseSchema<ProductReading>(
  "product.reading", 1, (input) => {
    if (!input || typeof input !== "object" || Array.isArray(input))
      return { success: false, issues: [{ path: "$", code: "invalid_object" }] };
    const data = input as Record<string, unknown>;
    if (typeof data.summaryZh !== "string" || !data.summaryZh.trim() || data.summaryZh.length > 1800 ||
        !Array.isArray(data.observedFacts) || data.observedFacts.length > 16 ||
        !Array.isArray(data.missingFacts) || data.missingFacts.length > 16 ||
        data.missingFacts.some(v => typeof v !== "string" || !v.trim() || v.length > 180))
      return { success: false, issues: [{ path: "$", code: "invalid_reading" }] };
    const facts: ProductReading["observedFacts"] = [];
    for (const entry of data.observedFacts) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return { success: false, issues: [{ path: "observedFacts", code: "invalid_fact" }] };
      const fact = entry as Record<string, unknown>;
      if (typeof fact.field !== "string" || !fact.field.trim() || fact.field.length > 80 ||
          !(fact.value === null || (typeof fact.value === "string" && fact.value.length <= 500)) ||
          typeof fact.evidence !== "string" || !fact.evidence.trim() || fact.evidence.length > 500)
        return { success: false, issues: [{ path: "observedFacts", code: "missing_evidence" }] };
      facts.push({ field: fact.field, value: fact.value, evidence: fact.evidence });
    }
    return { success: true, value: { summaryZh: data.summaryZh.trim(), observedFacts: facts, missingFacts: data.missingFacts as string[] } };
  },
);
