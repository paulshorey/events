# Database handoff — provisioned, event schema and importer pending

The crawler framework currently uses a local SQLite operational journal and JSONL exports. Separate Railway PostgreSQL 18 services now exist in dev and production, with independent persistent volumes and credentials. Both passed read-only SQL connections over TLS on October 17, 2026, and had zero public application tables. A database URL is still not needed to run or improve a scraper.

The git-ignored `.env.local` contains the active development `DATABASE_URL` and a commented production assignment. File permissions are owner-only. `npm run db:check` loads that file and checks connectivity without exposing the URL. Railway's `events` service receives a private-network database reference in each environment, but application code does not consume it yet. Provider service/volume IDs and operations are recorded in `.railway/project.json` and `.railway/README.md`. Daily and weekly volume backups are configured; a restore drill is still required before relying on production storage.

## Proposed storage boundary

Keep three layers separate:

1. **Evidence:** captured public HTML/JSON and failed screenshots. Each observation references its capture path and SHA-256 content hash. Move these files to object storage when hosting workers, retaining immutable keys and a backup/retention policy.
2. **Source observations:** append-only records exactly as extracted, including title/date/location/category claims, native identity, collection/run IDs, parser revision, scope, and evidence. Partial runs are useful here and remain labeled partial.
3. **Canonical events:** reviewed normalized events and occurrences, connected to source observations and city/category dictionaries. Only this layer feeds the future website.

A central PostgreSQL database is now available. Proposed initial tables, still to be implemented:

| Table | Purpose | Idempotency/identity |
| --- | --- | --- |
| `sources` | Publisher, hostname, shared access policy | Stable source ID, not category name |
| `collections` | One acquisition scope, entrypoint, market and category hints | Existing `url-NNN` IDs plus config revision |
| `extraction_runs` | Frozen code/config, date filter, outcome, coverage, totals and quality summary | Existing UUID run ID |
| `source_observations` | Extracted payload, provenance, raw facts, source identity, occurrence dates | Unique `(run_id, record_key)` |
| `evidence_objects` | Immutable capture object, content hash and storage key | Content hash plus object key; do not replace old evidence |
| `events` / `event_occurrences` | Canonical identity, recurrence and current occurrence state | Database IDs; retain a source-to-canonical mapping |
| `event_source_claims` | Claim-to-observation linkage, conflicts and field provenance | Observation/field/version identity |
| `cities`, `categories`, membership tables | Canonical geography/taxonomy and many-to-many tags | Stable dictionary IDs and explicit provenance |
| `normalization_jobs` / `review_issues` | Deterministic normalization, optional LLM enrichment, ambiguity handling | Versioned input hash and normalizer revision |

Keep queue state in SQLite while all workers run on one machine. If workers move to multiple hosts, migrate leases/claims and dispatch to a transactional shared queue, such as PostgreSQL. Do not share the SQLite WAL directory over a network filesystem. The acquisition/adapter interface need not change.

## Safe import behavior

- First add an idempotent uploader/outbox. Store a delivery receipt for each committed run/batch; retry database delivery independently of scraping. A database outage must not trigger recrawling a source or discard local observations.
- Import source observations from failed/partial runs with their exact status. Promote a source's current complete snapshot only when the run's completeness and quality gates pass. A failed refresh cannot clear the last good snapshot.
- Deduplicate repeated observations within an import using existing run/record identity. Cross-source deduplication is a separate, reversible reconciliation stage. Identical titles alone are insufficient. Use venue, locality, dates, organizer and source links; retain conflicts.
- Preserve date-only values as dates. Preserve upstream timestamp offsets and source time-zone claims; do not infer midnight UTC. Add a normalized instant only when time-zone semantics are verified. Listing-only dates may need detail-page enrichment.
- Preserve the user-supplied group as provenance. `marketCity: Boston` and address locality `Dorchester` are separate claims. City tags can be provisional until normalized against a location dictionary. Category hints from a source are not verified event categories.
- Keep non-US or unknown-country records in staging when a global directory returns them. Apply the US publication scope after geographic validation rather than discarding evidence.
- Missing from a partial crawl is never a cancellation. Missing from one complete run is only a missing observation. Use repeated comparable complete snapshots and explicit source cancellation evidence before changing publication status.
- API offset pagination is not an upstream atomic snapshot. The framework checks totals, repeated pages and final counts, but cannot prove a remote provider did not change records while counts stayed constant. Preserve the run interval and scope.

## Next implementation sequence

1. Use the active development connection in `.env.local`. Repeat the read-only identity/schema check first; never print the URL. Database provisioning and connectivity checks are complete; production migrations require their own reviewed release.
2. Create reviewed, forward-only development migrations and verify constraints.
3. Implement the outbox/import boundary and idempotent upserts. Test duplicate delivery, interrupted delivery and database outage/recovery with a disposable database.
4. Import a small known run, compare counts and evidence links, and then import the full validated source runs.
5. Add normalization and reconciliation jobs. Only after that should deployment, hosted schedules and Codex repair coordination be activated.

No event migrations, imports, canonical event publication or unattended collection were performed during database provisioning. Provisioning is a storage prerequisite, not a working ingestion pipeline.
