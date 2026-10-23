# Same-product matching

Matching is conservative: a visually similar franchise item is not automatically the same product.

## Decision sequence

1. Normalize Japanese and Chinese titles while preserving model numbers, product-line names, scale, edition, color, and included parts.
2. Reject obvious non-products before scoring: wanted ads, deposits, presales, empty boxes, manuals, stands, replacement parts, repair lots, broken items, or listings whose quantity differs materially from the reference.
3. Rank the remaining candidates using multilingual title overlap plus known Product attributes: franchise, series, manufacturer, toy type, product line, model number, release/edition, quantity, and condition.
4. Send only the strongest bounded set to image comparison when both sides expose safe public image URLs. Record whether image evidence was actually available; never describe a text-only decision as a visual match.
5. Auto-accept an AI-assisted row only when the combined score is at least 0.85, no hard attribute conflicts exist, and the candidate is neither accessory-only nor materially damaged. A deterministic-only fallback needs an exact model number and the stricter runtime threshold. Keep borderline rows out of pricing.

## Evidence

Persist the deterministic factors, image judgment when used, exclusion flags, final reason, provider provenance, and matching-method version. A missing or unsafe image lowers confidence and must never be treated as visual evidence. If a future operator-review flow is added, preserve the automated decision alongside the override instead of overwriting it.
