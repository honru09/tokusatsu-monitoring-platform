# Search workflow

Use the platform's configured read-only provider. Prefer `XIANYU_SEARCH_API_URL` for a service deployment. A local authenticated browser bridge is suitable only for an operator-triggered run, not an unattended cloud schedule.

## Input and output

- Input: an existing Product, one representative Japanese Item, 3-8 Chinese queries, and a total candidate budget of 20-50.
- Output per candidate: stable platform item ID, canonical item URL, title, CNY price, primary image URL when exposed, non-identifying condition/category metadata when exposed, observation time, and provider/query provenance. Do not retain seller names, profile URLs, account IDs, exact addresses, GPS coordinates, or other personal data. If a region is operationally useful, keep only a coarse city/area value and never send location text to the matching model.

## Collection invariants

1. Spread the total budget across distinct queries; deduplicate by `(platform, sourceItemId)` and then by canonical URL. A database row ID is never a marketplace item ID.
2. Use a conservative request interval and one provider session. Pagination and retries stay within the configured budget.
3. Normalize tracking parameters out of URLs but preserve the marketplace item ID.
4. Detect login expiry, authentication failures, CAPTCHA, verification, and risk-control responses before parsing results. Mark the provider blocked and end the run; do not retry a challenge automatically.
5. A zero-result response is evidence only after the page/provider confirms a successful search. A blocked or malformed response is an error, not an empty market.
6. Never log raw response headers, cookies, tokens, seller identities, or unfiltered provider payloads.
7. Count a listing in the pricing sample when it has an explicit active/online/on-sale status. The configured Apify adapter has one narrower provider-specific rule: a canonical row from a just-completed successful run may be current evidence when it is a summary row, has no detail error, has no explicit terminal state, and persists `apify_current_search_result` plus its observation time. Never apply that inference to a bare parser call, cached row, stale run, or unknown row from a generic search API. A summary count, prior database row, or malformed envelope is not active evidence.
8. Require non-empty `providerKey` and `queryKeyword` provenance for every persisted candidate. The query must be one of the validated phrases used by the refresh.

## Search-service response contract

The configured endpoint accepts `POST` with a validated Chinese `keyword` and a bounded requested item count. It must return actual listing rows either as the root array or in a supported `items`, `results`, `offers`, `records`, `list`, or `data_list` array. Each usable row needs:

- a canonical Goofish item URL and, when separately supplied, an item ID that agrees with the URL;
- title and positive CNY asking price;
- explicit active/online/on-sale availability evidence (generic search API), or the audited just-completed Apify summary evidence described above;
- provider/query provenance added by the adapter.

A response containing only `total`, `count`, `total_results`, or newly inserted local database IDs is incomplete and must fail closed. Provider HTTP bodies are bounded, and unsupported envelopes are errors rather than zero-result searches.

The runtime contract is implemented by the crawler worker. Keep provider-specific selectors, actor input schemas, and response parsing there so this skill does not become a stale copy of application code.
