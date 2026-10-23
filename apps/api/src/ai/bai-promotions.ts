const PROMOTION_LABELS: Record<string, string> = {
  "deepseek-v4-flash": "DeepSeek-V4-Flash",
  "deepseek-v4-flash-vision-exp": "DeepSeek-V4-Flash-Vision-Exp",
  "mimo-v2.5": "MiMo-V2.5",
  "glm-5.3-flash": "GLM-5.3-Flash",
  "qwen3.8-flash": "Qwen3.8-Flash",
  hy3: "Hy3",
};

function plainText(document: string) {
  return document
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
}

const PROMOTION_SECTION_LABELS = [...new Set(Object.values(PROMOTION_LABELS))];

function exactLabelIndexes(text: string, label: string) {
  const indexes: number[] = [];
  const haystack = text.toLowerCase();
  const needle = label.toLowerCase();
  let start = 0;
  for (;;) {
    const index = haystack.indexOf(needle, start);
    if (index < 0) return indexes;
    const before = index > 0 ? text[index - 1] : undefined;
    const after = text[index + label.length];
    if (!before?.match(/[a-z0-9-]/i) && !after?.match(/[a-z0-9-]/i))
      indexes.push(index);
    start = index + label.length;
  }
}

function headingSections(document: string, label: string) {
  const headings = [
    ...document.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi),
  ].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    text: plainText(match[2] ?? ""),
  }));
  return headings.flatMap((heading, index) =>
    exactLabelIndexes(heading.text, label).length
      ? [document.slice(heading.end, headings[index + 1]?.start)]
      : [],
  );
}

function plainTextSections(document: string, label: string) {
  const text = plainText(document);
  return exactLabelIndexes(text, label).map((index) => {
    const contentStart = index + label.length;
    const nextLabel = Math.min(
      ...PROMOTION_SECTION_LABELS.flatMap((candidate) =>
        exactLabelIndexes(text, candidate).filter(
          (candidateIndex) => candidateIndex >= contentStart,
        ),
      ),
      text.length,
    );
    return text.slice(contentStart, nextLabel);
  });
}

function activeFreeOffer(document: string, label: string) {
  const boundedHeadings = headingSections(document, label);
  const sections = boundedHeadings.length
    ? boundedHeadings
    : plainTextSections(document, label);
  return sections.some((section) => {
    const text = plainText(section);
    return /\bAPI\b/i.test(text) && /\b0\s*Credits\b/i.test(text);
  });
}

/**
 * Keep B.AI promotion models eligible only while their official active-offer
 * page still states that API usage is billed at zero credits.
 */
export function verifiedBaiPromotionModels(
  document: string,
  availableModels: ReadonlySet<string>,
) {
  return new Set(
    [...availableModels].filter((modelId) => {
      const label = PROMOTION_LABELS[modelId];
      return Boolean(label && activeFreeOffer(document, label));
    }),
  );
}
