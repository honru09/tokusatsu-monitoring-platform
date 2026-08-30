export type ShippingEvidence = {
  fee?: number;
  status: "free" | "fixed" | "calculated" | "unknown";
  evidence?: string;
};

function yen(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0)
    return Math.round(value);
  const match = String(value ?? "")
    .replace(/[０-９]/g, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
    )
    .replace(/,/g, "")
    .match(/(?:¥|￥|JPY)?\s*(\d{1,9})(?:\s*円)?/i);
  return match ? Number(match[1]) : undefined;
}

function objects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  return value && typeof value === "object"
    ? [value as Record<string, unknown>]
    : [];
}

export function structuredShipping(value: unknown): ShippingEvidence {
  const root = objects(value);
  const details = root.flatMap((entry) => [
    ...objects(entry.shippingDetails),
    ...objects(objects(entry.offers)[0]?.shippingDetails),
  ]);
  const fees = details.flatMap((detail) => {
    const rate = objects(detail.shippingRate)[0] ?? detail;
    const currency = String(
      rate.currency ?? rate.priceCurrency ?? "JPY",
    ).toUpperCase();
    const amount = yen(
      rate.value ?? rate.price ?? rate.amount ?? detail.shippingFee,
    );
    return amount != null && (currency === "JPY" || currency === "")
      ? [amount]
      : [];
  });
  const unique = [...new Set(fees)];
  if (unique.length === 1)
    return {
      fee: unique[0],
      status: unique[0] === 0 ? "free" : "fixed",
      evidence: "JSON-LD shippingDetails",
    };
  if (unique.length > 1)
    return { status: "calculated", evidence: "JSON-LD 提供多个地区运费" };
  return { status: "unknown" };
}

export function textualShipping(text: string): ShippingEvidence {
  const normalized = text
    .replace(/[０-９]/g, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
    )
    .replace(/\s+/g, " ")
    .trim();
  const conditionalFree = normalized.match(
    /(?:\d[\d,]*円以上|一定額以上|[一定]?金額以上)[^。\n]{0,30}送料無料/i,
  )?.[0];
  if (conditionalFree)
    return { status: "calculated", evidence: conditionalFree };
  const free = normalized.match(
    /(?:送料無料|送料込(?:み)?|出品者負担|配送料の負担\s*送料込み)/i,
  )?.[0];
  if (free) return { fee: 0, status: "free", evidence: free };
  // A minus sign means the surrounding page text is describing a discount or
  // calculation, not a payable postage amount (for example "送料が－120円").
  // Excluding all common minus glyphs also prevents negative hydration values
  // from being normalized into a positive fee.
  const fixed = normalized.match(
    /(?:送料|配送料|配送(?:料|費))[^¥￥\d\-−－]{0,40}(?:[¥￥]\s*[\d,]+|[\d,]+\s*円)/i,
  )?.[0];
  if (fixed) {
    const fee = yen(fixed);
    if (fee != null)
      return { fee, status: fee === 0 ? "free" : "fixed", evidence: fixed };
  }
  const calculated = normalized.match(
    /(?:送料|配送料|配送(?:料|費))[^。\n]{0,80}(?:落札者負担|購入者負担|着払い|地域|配送先|都道府県|方法により|別途)/i,
  )?.[0];
  if (calculated) return { status: "calculated", evidence: calculated };
  return { status: "unknown" };
}

export function shippingEvidence(
  structured: unknown,
  bodyText: string,
): ShippingEvidence {
  const fromStructured = structuredShipping(structured);
  if (fromStructured.status !== "unknown") return fromStructured;
  return textualShipping(bodyText);
}
