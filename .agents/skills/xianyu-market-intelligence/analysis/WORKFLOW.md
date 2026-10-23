# Keyword and comparison analysis

## Chinese search queries

Generate 3-8 distinct queries from known Product facts. Preserve model numbers and edition markers. Vary precision without changing identity:

- exact Chinese title plus model number;
- series/character plus toy type and manufacturer;
- recognized Chinese alias plus product line;
- a shorter fallback that still contains one identity-bearing term.

Strip marketplace words, condition claims, shipping claims, and speculative translations. Use deterministic Product/dictionary terms when AI is unavailable. Never invent a Chinese alias solely to reach the target count.

## Price gap and profit

- Convert the Japanese listing total with the timestamped `JPY_CNY` reference rate.
- `grossGapCny = referencePriceCny - japaneseTotalCny` is a price gap, not profit.
- Calculate estimated profit only when the relevant purchase cost, international/domestic shipping, platform fees, and other configured costs are present. List missing cost inputs next to the estimate.
- Explain an operator-only audit from stored evidence: accepted and retained counts, price range, statistical center, representative URL, match confidence, algorithm version, provider provenance, and observation time.

User-facing cards and item details stay minimal: Chinese reference price and the marketplace source link. Detailed evidence belongs in an operator-only audit path, not the public item payload.
