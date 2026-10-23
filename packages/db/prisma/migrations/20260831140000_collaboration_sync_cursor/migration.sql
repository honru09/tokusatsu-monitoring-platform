-- Index the append-only collaboration log in the same order as the polling
-- cursor so each two-second sync reads only the next bounded page.
CREATE INDEX "ManualReview_createdAt_id_idx"
ON "ManualReview"("createdAt", "id");
