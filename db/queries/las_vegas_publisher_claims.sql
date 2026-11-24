-- Latest complete listing claims for the next 90 Las Vegas calendar days.
-- Keep the same tie-break as current_complete_runs. The read-only role has
-- SELECT on the underlying tables. Edit from_date to replay a reporting window.
WITH window_start AS (
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date AS from_date
), reviewed(edition, edition_year, publisher, native_id, event_url) AS (
  VALUES
    ('plaza-downtown-christmas-expo', 2026, 'networkinvegas.com', '58217',
     'https://networkinvegas.com/event/downtown-christmas-expo/'),
    ('plaza-downtown-christmas-expo', 2026, 'plazahotelcasino.com',
     'https://www.plazahotelcasino.com/entertainment/downtown-christmas-expo/#2026',
     'https://www.plazahotelcasino.com/entertainment/downtown-christmas-expo/'),
    ('international-surface-event', 2027, 'network.vegas', '59573',
     'https://network.vegas/calendar/the-international-surface-event-tise-2027/'),
    ('international-surface-event', 2027, 'networkinvegas.com', '2397',
     'https://networkinvegas.com/event/tise-surfaces-expo/')
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
    AND nullif(o.payload->>'sourceRecordId','') IS NOT NULL
), located AS (
  SELECT c.*,
    CASE WHEN place->>'locality' = 'Las Vegas' AND place->>'region' IN ('NV','Nevada')
      AND (place->>'country' = 'United States'
        OR (collection_id = 'url-098' AND place->>'country' IS NULL AND place->>'postalCode' = '89101'))
      THEN 'venue address fields'
      -- Pink27's two Network.Vegas views carry an explicit postal address in
      -- the street field and leave the structured city, region and country empty.
      WHEN source_key = 'network.vegas' AND native_id = '56557'
        AND event_url = 'https://network.vegas/calendar/pink27/'
        AND place->>'venue' = 'Bellagio' AND place->>'streetAddress' = '3600 Las Vegas Blvd. S. Las Vegas, NV 89109'
        AND place->>'locality' IS NULL AND place->>'region' IS NULL AND place->>'country' IS NULL
      THEN 'published Bellagio street address'
    END AS city_evidence
  FROM claims c
), editions AS (
  SELECT c.*,
    CASE WHEN m.edition IS NOT NULL THEN jsonb_build_array(m.edition, m.edition_year)
      ELSE jsonb_build_array(c.source_key, c.native_id, c.event_url, title, start_date, end_date,
                             start_local, end_local, time_zone)
    END AS occurrence
  FROM located c
  LEFT JOIN reviewed m ON m.publisher = c.source_key AND m.native_id = c.native_id
    AND m.event_url = c.event_url AND m.edition_year = extract(year FROM c.start_date)
  -- Only carry a location-less claim into an expressly reviewed edition.
  WHERE c.city_evidence IS NOT NULL OR (m.edition IS NOT NULL AND
    (c.place IS NULL OR c.place = 'null'::jsonb))
)
SELECT occurrence, min(title) AS title,
       CASE WHEN count(DISTINCT start_date) = 1 THEN min(start_date) END AS start_date,
       CASE WHEN count(DISTINCT end_date) = 1 THEN min(end_date) END AS end_date,
       'Las Vegas' AS city, count(DISTINCT source_key) AS publishers,
       jsonb_agg(jsonb_build_object(
         'publisher', source_key, 'publisher_id', native_id, 'title', title, 'url', event_url,
         'start_date', start_date, 'end_date', end_date, 'start_local', start_local,
         'end_local', end_local, 'time_zone', time_zone, 'venue', place->>'venue',
         'source_location', place, 'city_evidence', city_evidence,
         'printed_hours', payload->'raw'->>'hours', 'collection', collection_id,
         'run', run_id, 'record', record_key, 'page', page_id,
         'capture_url', capture_url, 'sha256', content_hash
       ) ORDER BY collection_id, record_key) AS source_claims
FROM editions
GROUP BY occurrence
HAVING bool_or(city_evidence IS NOT NULL)
ORDER BY min(start_date), min(title), occurrence;
