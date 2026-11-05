-- Forward-only. Source observations exactly as extracted, with run provenance,
-- evidence metadata and delivery receipts. Canonical events, cities and
-- categories are a later, separate layer; nothing here is publication-ready.

CREATE TABLE sources (
  id text PRIMARY KEY,                      -- publisher/rate key, e.g. www.boston.gov
  first_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE collections (
  id text PRIMARY KEY CHECK (id ~ '^url-[0-9]{3}$'),
  source_id text NOT NULL REFERENCES sources(id),
  url text NOT NULL,
  latest_revision text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every configuration a run was frozen with. Never rewritten.
CREATE TABLE collection_revisions (
  collection_id text NOT NULL REFERENCES collections(id),
  revision text NOT NULL,
  config jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, revision)
);

CREATE TABLE extraction_runs (
  id uuid PRIMARY KEY,
  collection_id text NOT NULL REFERENCES collections(id),
  config_revision text NOT NULL,
  source_key text NOT NULL,
  status text NOT NULL CHECK (status IN
    ('complete','partial','repair_needed','blocked_access','cancelled','failed')),
  options jsonb NOT NULL,
  build_id text,
  result jsonb,
  error jsonb,
  expected_total integer,
  requests integer NOT NULL,
  active_ms bigint NOT NULL,
  created_at timestamptz NOT NULL,
  journal_updated_at timestamptz NOT NULL,  -- monotonic guard for redelivery
  origin jsonb NOT NULL,                    -- journal label/host that produced it
  first_delivered_at timestamptz NOT NULL DEFAULT now(),
  last_delivered_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (collection_id, config_revision)
    REFERENCES collection_revisions(collection_id, revision)
);
CREATE INDEX extraction_runs_collection ON extraction_runs(collection_id, created_at DESC);

CREATE TABLE extraction_attempts (
  id text PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES extraction_runs(id),
  number integer,
  started_at timestamptz,
  finished_at timestamptz,
  outcome text,
  error jsonb
);

-- Immutable capture identity. Bytes are optional (gzip) until object storage
-- exists; local_path records where the collector kept the original file.
CREATE TABLE evidence_objects (
  content_hash text PRIMARY KEY CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  byte_size bigint,
  local_path text,
  content_gzip bytea,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE run_pages (
  run_id uuid NOT NULL REFERENCES extraction_runs(id),
  page_id integer NOT NULL,
  url text NOT NULL,
  kind text NOT NULL,
  depth integer NOT NULL,
  state text NOT NULL,
  tries integer NOT NULL,
  meta jsonb NOT NULL,
  content_hash text REFERENCES evidence_objects(content_hash),
  fingerprint text,
  result jsonb,
  error jsonb,
  PRIMARY KEY (run_id, page_id)
);

-- Append-only listing/API observations. Typed columns are copies of payload
-- claims for querying; the payload remains the authoritative extracted record.
CREATE TABLE source_observations (
  run_id uuid NOT NULL REFERENCES extraction_runs(id),
  record_key text NOT NULL,
  page_id integer NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  collection_id text NOT NULL REFERENCES collections(id),
  title text,
  event_url text,
  start_date date,
  end_date date,
  start_local text,
  end_local text,
  time_zone text,
  market_city text,
  inserted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, record_key),
  FOREIGN KEY (run_id, page_id) REFERENCES run_pages(run_id, page_id)
);
CREATE INDEX source_observations_dates ON source_observations(start_date, end_date);
CREATE INDEX source_observations_collection ON source_observations(collection_id);

CREATE TABLE observation_enrichments (
  run_id uuid NOT NULL,
  record_key text NOT NULL,
  page_id integer NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, record_key, page_id),
  FOREIGN KEY (run_id, record_key) REFERENCES source_observations(run_id, record_key),
  FOREIGN KEY (run_id, page_id) REFERENCES run_pages(run_id, page_id)
);

CREATE TABLE observation_expansions (
  run_id uuid NOT NULL,
  parent_key text NOT NULL,
  record_key text NOT NULL,
  page_id integer NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, parent_key, record_key, page_id),
  FOREIGN KEY (run_id, parent_key) REFERENCES source_observations(run_id, record_key),
  FOREIGN KEY (run_id, page_id) REFERENCES run_pages(run_id, page_id)
);

-- One receipt per distinct delivered run state. Redelivering the same state
-- returns the existing receipt.
CREATE TABLE import_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES extraction_runs(id),
  digest text NOT NULL,
  run_status text NOT NULL,
  counts jsonb NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, digest)
);

-- Same projection as Journal.records(): expansions replace their parent,
-- otherwise the latest detail enrichment wins, otherwise the listing record.
CREATE VIEW run_records AS
SELECT o.run_id, o.collection_id, x.record_key, o.record_key AS listing_key,
       x.payload, 'expansion'::text AS projection
FROM source_observations o
JOIN (SELECT DISTINCT ON (run_id, parent_key, record_key) *
      FROM observation_expansions
      ORDER BY run_id, parent_key, record_key, page_id DESC) x
  ON x.run_id = o.run_id AND x.parent_key = o.record_key
UNION ALL
SELECT o.run_id, o.collection_id, o.record_key, o.record_key,
       coalesce(e.payload, o.payload),
       CASE WHEN e.payload IS NULL THEN 'listing' ELSE 'enriched' END
FROM source_observations o
LEFT JOIN LATERAL (SELECT payload FROM observation_enrichments e
                   WHERE e.run_id = o.run_id AND e.record_key = o.record_key
                   ORDER BY page_id DESC LIMIT 1) e ON true
WHERE NOT EXISTS (SELECT 1 FROM observation_expansions x
                  WHERE x.run_id = o.run_id AND x.parent_key = o.record_key);

-- The latest complete (enumeration + quality gates passed) run per collection.
-- A later failed or partial run never replaces it.
CREATE VIEW current_complete_runs AS
SELECT DISTINCT ON (collection_id) *
FROM extraction_runs
WHERE status = 'complete'
ORDER BY collection_id, journal_updated_at DESC;

CREATE VIEW current_source_records AS
SELECT r.* FROM run_records r JOIN current_complete_runs c ON c.id = r.run_id;
