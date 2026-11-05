-- Forward-only. Failed pages keep their capture identity separately from the
-- successful-content hash, and collection metadata follows the newest run
-- rather than delivery order.

ALTER TABLE run_pages
  ADD COLUMN error_capture_hash text REFERENCES evidence_objects(content_hash);

ALTER TABLE collections ADD COLUMN latest_run_at timestamptz;

UPDATE collections c
SET latest_revision = r.config_revision,
    source_id = r.source_key,
    url = cr.config->>'url',
    latest_run_at = r.journal_updated_at
FROM (SELECT DISTINCT ON (collection_id) collection_id, config_revision, source_key, journal_updated_at
      FROM extraction_runs ORDER BY collection_id, journal_updated_at DESC) r
JOIN collection_revisions cr
  ON cr.collection_id = r.collection_id AND cr.revision = r.config_revision
WHERE c.id = r.collection_id;
