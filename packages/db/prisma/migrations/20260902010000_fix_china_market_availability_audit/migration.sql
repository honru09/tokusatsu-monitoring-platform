-- Apify calls the input mode "full", but successful full-detail rows expose
-- detailStatus = "enriched". Keep summary rows gated by a same-refresh
-- observation marker and fail closed for every other Apify detail outcome.
CREATE OR REPLACE FUNCTION comparison_offer_has_audited_availability(
  provider_key TEXT,
  source_data JSONB,
  last_seen_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN provider_key !~ '^apify:' THEN true
    WHEN lower(COALESCE(source_data ->> 'detailStatus', '')) = 'enriched' THEN true
    WHEN lower(COALESCE(source_data ->> 'detailStatus', '')) = 'summary'
      AND source_data ->> 'availabilityEvidence' = 'apify_current_search_result'
      AND COALESCE(source_data ->> 'availabilityObservedAt', '') ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    THEN abs(EXTRACT(EPOCH FROM (
      last_seen_at - (source_data ->> 'availabilityObservedAt')::TIMESTAMPTZ
    ))) <= 1800
    ELSE false
  END
$function$;
