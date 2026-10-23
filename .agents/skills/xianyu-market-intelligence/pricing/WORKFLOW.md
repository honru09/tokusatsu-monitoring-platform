# Reference pricing

Use prices only from accepted, currently observable same-product listings. CNY is the stored unit.

## Robust estimate

1. Remove non-positive values and price placeholders such as deposits or obvious `1 元` links.
2. When at least three values remain, remove statistical outliers with the runtime's median/MAD rule. Do not trim a small sample merely to make it look tidy.
3. Require at least three retained values for a user-facing single reference price. A two-value sample is insufficient evidence because its midpoint may not be a real listing price.
4. Use the retained median only as the statistical center for choosing a representative listing. Publish the representative listing's actual `priceCny` as `referencePriceCny`, and retain minimum, maximum, and sample count.
5. Choose the accepted listing closest to the statistical center as the representative source link. Price and URL must always come from that same listing; break ties by match confidence, then by stable marketplace listing ID and canonical URL so provider row order cannot change the published pair.

Mark the result `insufficient` rather than guessing when the retained sample is too small. Recompute from stored candidates instead of editing the aggregate by hand.
