# Framework review and next steps

Reviewed October 17, 2026. Scope: the deterministic collector, local operational journal, source validation evidence, hosting configuration and database prerequisites. This review did not repeat the 97-source live fleet or enable unattended collection.

## Assessment

The reusable collection framework is a sound foundation: one registry and shared Playwright/API runtime, persistent page checkpoints, fenced worker leases, per-host dispatch, explicit outcome classes, evidence retention and a repair probation workflow. The implementation tests exercise failures and recovery rather than merely counting successful pages.

It is not yet a hosted event ingestion system. A runnable wrapper exists for every supplied URL, but the recorded source assessment has only three fully enumerated interfaces. The next milestone should prove one development ingestion path before adding workers, schedules or a website.

## Database provisioning completed

Railway project: [Events](https://railway.com/project/a0315029-9b64-41a0-9c83-e4367366947d).

| Environment | Database | Persistent volume | Verification |
| --- | --- | --- | --- |
| dev | `Postgres` | `postgres-volume` | PostgreSQL 18, TLS connection, read-only SQL, zero application tables |
| production | `Postgres-production` | `postgres-production-volume` | PostgreSQL 18, TLS connection, read-only SQL, zero application tables |

The instances have different service IDs, volumes and generated passwords. Their native database deployments succeeded. Each `events` service has a project-specific `DB_EVENTS_URL` reference to its own database’s `DATABASE_PUBLIC_URL`. Local and Railway clients use public TCP endpoints with TLS; private networking is deferred until explicitly requested. Events clients never fall back to generic `DATABASE_URL`. The mode-0600, git-ignored `.env.local` has development active as `DB_EVENTS_URL` and production commented. No connection values are recorded in this document or Git.

Both environments have daily and weekly volume backup schedules. Infrastructure plans are clean after adoption into `.railway/railway.ts`. `hosting:verify` now checks database deployments, volume/TCP configuration and backup schedules as well as application deployment identity and runtime health. `db:check` separately executes read-only SQL using the active local URL. Backup creation/restore has not been exercised, and the application still does not query PostgreSQL. See `.railway/README.md` for ownership and commands.

PostgreSQL is appropriate for shared observations, run metadata, import receipts, normalized event/occurrence identities and city/category relationships. Keep raw captures in immutable object storage and retain SQLite as the current single-host dispatch journal. PostgreSQL does not need to replace every local component at once. Railway's [PostgreSQL template](https://docs.railway.com/databases/postgresql) supplies the persistent service; [backups](https://docs.railway.com/guides/postgres-backups-restores) and a verified importer remain our responsibility.

## Review fixes included

1. **Missing event links created false URLs.** `new URL(undefined, listingUrl)` previously produced a valid-looking `/undefined` event link. The shared URL helper now rejects missing, blank and non-string values. It validates `url` and `@id` independently, retaining a usable canonical identifier when an optional URL is malformed. Events with neither usable link are rejected rather than receiving an invented link.
2. **Null optional JSON-LD fields crashed parsing.** An `identifier: null` or `addressCountry: null` could throw. Parsing now retains otherwise valid events and preserves unknown values. A labeled synthetic JSON-LD fixture covers both null fields and missing links.
3. **Redirected content could be attributed to the wrong collection.** The transport previously checked only the starting URL. It now checks the effective API URL and browser document URL before returning content for parsing; rejected responses remain failure evidence. Browser HTML and its URL are read atomically, and the exact checked snapshot URL is returned, even if navigation occurs during an asynchronous policy check. Real Playwright tests verify scope rejection for both transports and force navigation during the final policy check.
4. **Inherited credentials could override the local database selection.** Node's `--env-file` preserves existing environment variables. The npm database check now parses `.env.local` explicitly and uses its active `DB_EVENTS_URL`, requiring valid local credentials instead of inheriting another Events target. A real npm invocation in a disposable checkout verifies both precedence and failure when the local file is missing. Direct script invocation remains the explicit environment-based operational check.

These changes pass offline/controlled tests. They do not revalidate historical live runs or close source repair tickets. The transport still follows redirects before checking the destination; checking every redirect hop before acquisition is a remaining policy-hardening task. The final URL guard prevents accepting that content as a successful collection, but it is not a pre-request redirect firewall.

## Remaining work, in order

### 1. Implement the development storage boundary

Create forward-only development migrations for source/collection identity, extraction runs, evidence metadata, append-only source observations and import receipts. Keep canonical events/occurrences and city/category dictionaries separate from extracted claims. The proposed table responsibilities and time/location rules are in `database_handoff.md`.

Add an uploader/outbox at the committed-run boundary:

```text
Collector commits a page to SQLite and retains captures
    -> terminal run becomes eligible for delivery
    -> uploader writes run metadata and observations to PostgreSQL
    -> database commits an import receipt
    -> local delivery state records that receipt
```

A crash before the local receipt must be safe to retry using the same run/batch identity. A database outage must not cause a recrawl, lose observations, clear the last good snapshot, or erase pending delivery. Preserve partial/failed run status and rejected-record accounting. Do not import only the upcoming JSONL export if that would drop retained observations and their original scope.

Acceptance: import one known complete saved run into dev; compare counts and evidence links; repeat delivery with no duplicates; interrupt a delivery and recover; simulate a database outage. Use disposable PostgreSQL test databases for destructive failure tests. Do not use production for experimentation.

### 2. Make hosted evidence and queue storage durable

The current Railway application containers have ephemeral writable storage. PostgreSQL volumes hold database files only. They do not preserve the crawler's local journal or HTML/JSON/screenshots.

Select immutable object storage for captures, with content hashes, run/task provenance, retention and tested retrieval. For the first worker, use one host with a persistent local journal volume and explicit process supervision, or implement a transactional PostgreSQL queue before using multiple hosts. Never share SQLite WAL over a network filesystem. Back up the journal consistently together with its referenced captures.

Acceptance: kill/restart a hosted worker and prove checkpoint recovery, stale-owner fencing and evidence retrieval. Run a restore drill against an isolated database/volume before relying on production backups. Keep the passive health endpoint distinct from ingestion readiness.

### 3. Continue source-specific onboarding and validation

The saved October 17 source assessment reports 3 complete, 26 partial, 42 repair-needed, 25 blocked and 1 waiting for retry across the 97 URLs. Those are historical latest-per-collection outcomes, not this review's new live measurements. The 1,238 recorded observations overlap sources and are not unique canonical US events.

Prioritize sources with positive observations and stable enumeration interfaces. Resolve pagination, filters, geography, event-detail fields and termination together. Access-blocked sources need approved feeds/APIs/access investigation, rather than repeated selector rewrites. Preserve the failed capture, add a bounded fixture, freeze the candidate revision and require the existing two-complete-run probation gate. Keep counts for repair tickets separate from counts for websites; one collection can have several issues in its history.

Add pre-request redirect-hop policy enforcement before unattended crawling. Also add evidence-backed semantic samples for dates, venue locality, year, recurrence and source IDs: passing selector/count checks cannot establish field accuracy. Global runtime changes require fresh bounded live validation for affected adapters.

### 4. Build normalization and an initial queryable event layer

Once observation delivery is reliable, create canonical event/occurrence records with reversible links to source claims. Normalize cities/countries and category memberships with explicit provenance, retain date-only values and unknown time zones, preserve ongoing events, and distinguish cancellations from absence in partial runs. Market groups remain provenance, not proof of venue locality. Test event overlap across the three complete sources and retain conflicting claims.

Acceptance: a development query returns events by verified city/category/date and can trace every displayed field back to a source observation and capture. This milestone can precede any website implementation.

### 5. Enable controlled scheduling and agent repair coordination

After durable storage and ingestion work, install a deterministic scheduler/worker supervisor with bounded concurrency, graceful shutdown, runtime limits and status monitoring. Keep schedules per collection, enforce publisher-level pacing, and begin with a few validated sources. Add alerts for repeated transport failures, count collapse, overdue successful refreshes, backlog growth and delivery failures.

Use Codex tasks for claimed repair work and reviewed code/configuration changes. They should not be the primary high-frequency scraping dispatcher. Keep agent repair retries bounded and distinguish contract changes, rate limits and access restrictions. Continue requiring fixtures and two complete probation runs before re-enabling a repaired source.

All 97 schedules remain disabled. Database provisioning does not activate workers or authorize publishing observations.

## Validation for this review

- `npm run railway:check`: passed.
- `npm test`: 60 passed, including malformed-URL fallback to JSON-LD `@id`, database-key isolation, local-file precedence over inherited Events credentials, real Chromium runtime readiness, controlled API retry/recovery, API/browser redirect rejection and navigation during final browser policy validation.
- `npm run db:check`: development connection passed with TLS and read-only SQL.
- Bounded LA Convention Center browser probe in a disposable journal: one page, 31 observations, explicitly `partial`/`probe_only`; no repair ticket was closed or operational journal reset. This is a transport compatibility sample, not a new complete-source validation.
- Separate production connection check: TLS/read-only SQL passed; no application tables or writes.
- Native Railway state: independent database volumes, successful PostgreSQL deployments, daily/weekly backup schedules and clean IaC plans in both environments.
- `node scripts/verify-hosting.mjs`: validates exact current branch deployments, HTTPS runtime readiness and database infrastructure; secret values are not read by this command.
- `.env.local`: ignored, untracked and owner-only; production assignment commented. Local SQLite observations/captures were retained.

Infrastructure is already provisioned. The review fixes, documentation and updated IaC definition are delivered through a feature PR; application branches still need their normal reviewed merge/promotion. Adopt the updated IaC definition before any subsequent apply so an older whole-project graph cannot omit the new databases/volumes.
