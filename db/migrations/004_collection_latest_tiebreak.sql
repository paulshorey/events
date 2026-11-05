-- Forward-only. Collection metadata follows the newest run with the same
-- ordering as current_complete_runs (update time, creation time, id), so equal
-- update milliseconds cannot leave it on a different run's revision.
ALTER TABLE collections
  ADD COLUMN latest_run_created_at timestamptz,
  ADD COLUMN latest_run_id uuid;

UPDATE collections c
SET latest_revision = r.config_revision,
    source_id = r.source_key,
    url = cr.config->>'url',
    latest_run_at = r.journal_updated_at,
    latest_run_created_at = r.created_at,
    latest_run_id = r.id
FROM (SELECT DISTINCT ON (collection_id) *
      FROM extraction_runs
      ORDER BY collection_id, journal_updated_at DESC, created_at DESC, id DESC) r
JOIN collection_revisions cr
  ON cr.collection_id = r.collection_id AND cr.revision = r.config_revision
WHERE c.id = r.collection_id;
