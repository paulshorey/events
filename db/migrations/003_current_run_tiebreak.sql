-- Forward-only. Two complete runs of one collection can share a millisecond
-- journal_updated_at; break ties deterministically by creation time, then id.
CREATE OR REPLACE VIEW current_complete_runs AS
SELECT DISTINCT ON (collection_id) *
FROM extraction_runs
WHERE status = 'complete'
ORDER BY collection_id, journal_updated_at DESC, created_at DESC, id DESC;
