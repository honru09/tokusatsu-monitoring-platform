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

function activeFreeOffer(text: string, label: string) {
  let start = 0;
  for (;;) {
    const index = text.toLowerCase().indexOf(label.toLowerCase(), start);
    if (index < 0) return false;
    const section = text.slice(index, index + 900);
    if (/\bAPI\b/i.test(section) && /\b0\s*Credits\b/i.test(section))
      return true;
    start = index + label.length;
  }
}

/**
 * Keep B.AI promotion models eligible only while their official active-offer
 * page still states that API usage is billed at zero credits.
 */
export function verifiedBaiPromotionModels(
  document: string,
  availableModels: ReadonlySet<string>,
) {
  const text = plainText(document);
  return new Set(
    [...availableModels].filter((modelId) => {
      const label = PROMOTION_LABELS[modelId];
      return Boolean(label && activeFreeOffer(text, label));
    }),
  );
}
