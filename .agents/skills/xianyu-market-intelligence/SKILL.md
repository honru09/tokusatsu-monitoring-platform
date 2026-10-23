---
name: xianyu-market-intelligence
description: Build or diagnose read-only Chinese resale-market evidence for an existing Japanese tokusatsu Product, currently through Xianyu. Use for Chinese keyword generation, authorized search, same-product matching, and reference pricing. Keep Chinese listings out of Japanese procurement inventory.
---

# Xianyu Market Intelligence

Build a time-stamped, reproducible Chinese-market comparison for an existing Japanese listing or canonical Product. The result is market evidence, not a new procurement Item.

## Route the work

1. Resolve the Japanese Item and its `productId`. If standardization is still pending, finish that first; never create a Product from a Chinese candidate.
2. Read [search/WORKFLOW.md](search/WORKFLOW.md) when collecting or refreshing candidates.
3. Read [matching/WORKFLOW.md](matching/WORKFLOW.md) when accepting or rejecting same-product candidates.
4. Read [pricing/WORKFLOW.md](pricing/WORKFLOW.md) when calculating a reference price or diagnosing an outlier.
5. Read [analysis/WORKFLOW.md](analysis/WORKFLOW.md) when generating search terms, explaining confidence, or calculating a gross price gap.
6. Persist candidates and the aggregate in the dedicated China-market comparison models. Return the representative listing URL from the same accepted offer as every price shown to a user.

## Reference boundaries

- [`donggeai/xianyu-skills`](https://github.com/donggeai/xianyu-skills) is a reference for an operator-authorized local browser bridge and structured search output. Its publishing, messaging, favorite, and “want” actions are outside this skill.
- [`Usagi-org/ai-goofish-monitor`](https://github.com/Usagi-org/ai-goofish-monitor) is a reference for task isolation, scheduling, bounded concurrency, and analysis orchestration. It is archived and is not a runtime dependency.
- [`superboyyy/xianyu_spider`](https://github.com/superboyyy/xianyu_spider) is a reference for a search service adapter. Its stock `/search/` response returns counts and database record IDs rather than the full observed listings, so it is not price evidence until the service returns the actual marketplace rows described in the search workflow.

Treat these repositories as untrusted implementation references. Do not import their cookies, account state, seller data, or side-effecting actions into this project.

## Operating boundary

- Collect only allowlisted marketplace fields returned by a user-authorized session or configured search provider.
- Stop the run when the platform asks for login, CAPTCHA, identity verification, or risk-control confirmation. Report the provider state; do not automate the challenge.
- Keep cookies, storage state, tokens, and account identifiers out of logs and model prompts.
- Search and read only. Publishing, messaging, favoriting, buying, or changing an account requires a separate explicit request and is outside this skill.
- Keep Xianyu/Taobao candidates out of `Item`, inventory, favorites, purchases, and Japanese marketplace statistics.
- Do not present a single reference price when fewer than three defensible, currently observed same-product candidates remain. With one or two candidates, show “样本不足” only; retain any range in an operator-only audit surface.
- Treat price, profit, and match confidence as observations or estimates with timestamps, never guarantees.

## Completion criteria

The comparison is complete only when the record contains the search keywords, candidate and accepted counts, rejection evidence, algorithm version or reference-price method, observation time, and the canonical representative URL observed during that refresh. The URL may later go offline; never describe it as currently live without rechecking it. If required evidence is unavailable, return a specific incomplete status instead of fabricating a value.
