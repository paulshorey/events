-- Latest complete listing claims for the next 90 Las Vegas calendar days.
-- Keep the same tie-break as current_complete_runs. The read-only role has
-- SELECT on the underlying tables. Edit from_date to replay a reporting window.
WITH window_start AS (
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date AS from_date
), latest AS (
  SELECT DISTINCT ON (collection_id) collection_id, id, source_key
  FROM extraction_runs
  WHERE status = 'complete' AND collection_id IN ('url-019','url-020','url-021','url-098')
  ORDER BY collection_id, journal_updated_at DESC, created_at DESC, id DESC
), claims AS (
  SELECT o.*, r.source_key, o.payload->>'sourceRecordId' AS native_id,
         p.content_hash, p.url AS capture_url, o.payload->'location' AS place
  FROM latest r
  JOIN source_observations o ON o.run_id = r.id
  JOIN run_pages p ON p.run_id = o.run_id AND p.page_id = o.page_id
  CROSS JOIN window_start w
  WHERE o.start_date < w.from_date + 90
    AND coalesce(o.end_date, o.start_date) >= w.from_date
    AND o.payload->'location'->>'locality' = 'Las Vegas'
    AND o.payload->'location'->>'region' IN ('NV','Nevada')
    AND (o.payload->'location'->>'country' = 'United States'
      OR (o.collection_id = 'url-098' AND o.payload->'location'->>'country' IS NULL
        AND o.payload->'location'->>'postalCode' = '89101'))
    AND nullif(o.payload->>'sourceRecordId','') IS NOT NULL
), editions AS (
  SELECT c.*,
    -- Reviewed venue and directory identities for this edition only. All other
    -- publishers and repeat performances keep their separate occurrence keys.
    CASE WHEN start_date >= DATE '2026-01-01' AND start_date < DATE '2027-01-01'
      AND ((collection_id = 'url-021' AND native_id = '58217'
        AND event_url = 'https://networkinvegas.com/event/downtown-christmas-expo/')
        OR (collection_id = 'url-098'
        AND native_id = 'https://www.plazahotelcasino.com/entertainment/downtown-christmas-expo/#2026'))
      THEN jsonb_build_array('plaza-downtown-christmas-expo', 2026)
      ELSE jsonb_build_array(source_key, native_id, event_url, title, start_date, end_date,
                             start_local, end_local, time_zone)
    END AS occurrence
  FROM claims c
)
SELECT occurrence, min(title) AS title,
       CASE WHEN count(DISTINCT start_date) = 1 THEN min(start_date) END AS start_date,
       CASE WHEN count(DISTINCT end_date) = 1 THEN min(end_date) END AS end_date,
       'Las Vegas' AS city, count(DISTINCT source_key) AS publishers,
       jsonb_agg(jsonb_build_object(
         'publisher', source_key, 'publisher_id', native_id, 'title', title, 'url', event_url,
         'start_date', start_date, 'end_date', end_date, 'start_local', start_local,
         'end_local', end_local, 'time_zone', time_zone, 'venue', place->>'venue',
         'printed_hours', payload->'raw'->>'hours', 'collection', collection_id,
         'run', run_id, 'record', record_key, 'page', page_id,
         'capture_url', capture_url, 'sha256', content_hash
       ) ORDER BY collection_id, record_key) AS source_claims
FROM editions
GROUP BY occurrence
ORDER BY min(start_date), min(title), occurrence;
