# Crawler queue maintenance

The maintenance command only mutates ephemeral BullMQ records in Redis. Its
optional pending-classification mode reads Item/classification eligibility but
issues no PostgreSQL mutations, so it cannot delete Items, purchases,
credentials, classifications, comparison evidence, or audit rows.

Preview terminal queue counts (the default is always a dry run):

```powershell
pnpm --filter @tokusatsu/crawlers queue:maintain
```

Delete only `completed` and `failed` records older than 24 hours, in bounded
batches. Current repeat definitions and active/waiting/delayed/prioritized jobs
are preserved:

```powershell
pnpm --filter @tokusatsu/crawlers queue:maintain -- --apply
```

To also remove stale, inapplicable, or duplicate pending image-classification
records, first stop the crawler worker and then run:

```powershell
pnpm --filter @tokusatsu/crawlers queue:maintain -- --apply --classification-pending
```

That optional mode refuses to run when a classification job is active, pauses
the classification queue around its read/verify/remove transaction, and resumes
it afterward. It retains the one current content-version job for every eligible
Item and conservatively retains unknown job shapes.

Retention and work ceilings can be changed explicitly:

```powershell
pnpm --filter @tokusatsu/crawlers queue:maintain -- --apply --grace-hours=72 --batch-size=1000 --max-passes=50
```

Re-running either mode is safe: removed terminal/stale records stay absent and
stable job IDs prevent another copy of unchanged automatic work.
