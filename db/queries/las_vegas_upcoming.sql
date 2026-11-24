-- Compare listing claims from the two Network.Vegas scopes over a 90-day window.
-- Edit from_date to reproduce an earlier report. The upper date is exclusive.
WITH window_start AS (
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date AS from_date
), latest AS (
  -- Same selection as current_complete_runs, accessible to the read-only role.
  SELECT DISTINCT ON (collection_id) id, collection_id FROM extraction_runs
  WHERE status = 'complete' AND collection_id IN ('url-019','url-020')
  ORDER BY collection_id, journal_updated_at DESC, created_at DESC, id DESC
), claims AS (
  SELECT o.*, o.payload->>'sourceRecordId' AS publisher_id, p.content_hash,
         p.url AS capture_url
  FROM latest r
  JOIN source_observations o ON o.run_id = r.id
  JOIN run_pages p ON p.run_id = o.run_id AND p.page_id = o.page_id
  CROSS JOIN window_start w
  WHERE r.collection_id IN ('url-019', 'url-020')
    AND o.start_date < w.from_date + 90
    AND coalesce(o.end_date, o.start_date) >= w.from_date
    AND o.payload->'location'->>'locality' = 'Las Vegas'
    AND o.payload->'location'->>'region' IN ('NV', 'Nevada')
    AND o.payload->'location'->>'country' = 'United States'
    AND nullif(o.payload->>'sourceRecordId', '') IS NOT NULL
)
SELECT publisher_id, event_url, title, start_date, end_date, start_local, end_local,
       time_zone, payload->'location'->>'locality' AS city,
       jsonb_agg(jsonb_build_object(
         'collection', collection_id, 'run', run_id, 'record', record_key,
         'page', page_id, 'capture_url', capture_url, 'sha256', content_hash
       ) ORDER BY collection_id, record_key) AS source_claims
FROM claims
GROUP BY publisher_id, event_url, title, start_date, end_date, start_local,
         end_local, time_zone, payload->'location'->>'locality'
ORDER BY start_date, start_local NULLS LAST, publisher_id, event_url, title;
