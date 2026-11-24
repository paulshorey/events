-- Javits Center listing claims overlapping the next 90 New York calendar days.
-- Change from_date to replay a reporting window. Only the Boat Show pair below
-- has undergone cross-publisher identity review; keep every other claim separate.
WITH window_start AS (
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date AS from_date
), latest AS (
  SELECT DISTINCT ON (collection_id) collection_id, id, source_key, options->'ignoreRobots' AS ignore_robots
  FROM extraction_runs
  WHERE status = 'complete' AND collection_id IN ('url-027','url-028')
  ORDER BY collection_id, journal_updated_at DESC, created_at DESC, id DESC
), scopes(collection_id, publisher, venue) AS (
  VALUES ('url-027','javitscenter.com','Jacob K. Javits Convention Center'),
         ('url-028','conventioncalendar.com','Jacob Javits Center')
), reviewed(collection_id, native_id, event_url) AS (
  VALUES ('url-027','event-59155|2027-01-20','https://www.javitscenter.com/calendar#event-59155'),
         ('url-028','conventioncalendar:420414|2027-01-20',
          'https://conventioncalendar.com/us/ny/new-york-city/jacob-javits-center/discover-boating-new-york-boat-show-1-420414')
), claims AS (
  SELECT o.*, r.source_key, r.ignore_robots, p.content_hash, p.url AS task_url,
         CASE WHEN m.native_id IS NOT NULL THEN jsonb_build_array('discover-boating-new-york-boat-show', 2027)
              ELSE jsonb_build_array(r.source_key, r.collection_id, o.record_key) END AS occurrence
  FROM latest r
  JOIN scopes s ON (s.collection_id, s.publisher) = (r.collection_id, r.source_key)
  JOIN source_observations o ON (o.run_id, o.collection_id) = (r.id, r.collection_id)
  JOIN run_pages p ON (p.run_id, p.page_id) = (o.run_id, o.page_id)
  LEFT JOIN reviewed m ON m.collection_id = o.collection_id
    AND m.native_id = o.payload->>'sourceRecordId' AND m.event_url = o.event_url
    AND extract(year FROM o.start_date) = 2027
  CROSS JOIN window_start w
  WHERE o.start_date < w.from_date + 90 AND coalesce(o.end_date, o.start_date) >= w.from_date
    AND o.payload->'location'->>'venue' = s.venue
    AND o.payload->'location'->>'locality' IN ('New York','New York City')
    AND o.payload->'location'->>'region' = 'NY' AND o.payload->'location'->>'country' = 'US'
    AND p.content_hash IS NOT NULL
)
SELECT occurrence, min(title) AS title,
       CASE WHEN min(start_date) = max(start_date) THEN min(start_date) END AS start_date,
       CASE WHEN count(end_date) = count(*) AND min(end_date) = max(end_date) THEN min(end_date) END AS end_date,
       'New York' AS city, count(DISTINCT source_key) AS publishers,
       jsonb_agg(jsonb_build_object(
         'publisher', source_key, 'publisher_id', payload->>'sourceRecordId',
         'title', title, 'url', event_url, 'start_date', start_date, 'end_date', end_date,
         'start_local', start_local, 'end_local', end_local, 'time_zone', time_zone,
         'source_location', payload->'location', 'collection', collection_id,
         'run', run_id, 'ignore_robots', ignore_robots, 'record', record_key, 'page', page_id, 'task_url', task_url,
         'capture_url', coalesce(payload->'evidence'->>'url',task_url), 'sha256', content_hash
       ) ORDER BY collection_id, record_key) AS source_claims
FROM claims
GROUP BY occurrence
ORDER BY min(start_date), min(title), occurrence;
