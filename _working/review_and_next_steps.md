# Framework review and next steps

## Implementation plan, November 26, 2026

The next milestone is a repeatable manual dev collection batch. An operator should be able to pick a publisher, explain its value, run a bounded collection, and show exactly which upcoming occurrences reached dev. Measure growth by additional publishers, geographic coverage and evidence-backed occurrences. A second URL for the same publisher can add events, but it does not add a publisher.

On November 26, dev held runs for 98 collection scopes across 67 publisher keys. The latest delivered attempt was complete for 35 scopes, partial for 22, blocked by access for 27, and in need of repair for 14. This is the baseline for the first batch. Historical completion alone does not establish current access or repeatability.

The [Boston and NYC validation](2026-11-24-validation.md) provides the batch record format. The [Las Vegas comparison](vegas-publisher-validation.md) and [Javits comparison](javits-publisher-validation.md) provide examples of retaining publisher evidence across reviewed editions.

### 1. Make each batch reproducible

| Step | Work | Evidence required to move on |
| --- | --- | --- |
| Select | Add one read-only SQL report under `db/queries/`. Show each scope’s publisher, latest attempt and reason, last complete run and age, recorded robots policy, requests and upcoming occurrences. Include registered scopes awaiting first delivery. Roll up overlapping scopes by publisher. | For a fixed reporting date, the totals reconcile to the registry and dev. A newer partial attempt appears beside the older complete result. An absent policy flag displays as unknown. |
| Define the source | State the publisher’s actual scope, native occurrence identity, pagination or end condition, venue and date evidence, optional fields, source-specific quality policy, and request and runtime budgets. Record how reuse and attribution apply for a new feed. | A saved response or bounded default-policy probe supports the contract. A second operator can explain what a complete run covers, including known exclusions. |
| Validate | Reuse an existing adapter where possible. Replay saved captures first. For a repair, add a fixture, inspect changed or lost occurrences, and run `npm test`. Freeze the revision and run the existing foreground validator in a separate campaign directory. | Two complete, quality-passing live runs on the same candidate. Both run IDs, build/configuration revisions, request counts and evidence locations are recorded. A probe or offline replay is diagnostic evidence. |
| Deliver | Run the dev importer for the campaign journal, including terminal partial and blocked outcomes. Read back receipts, counts, and evidence availability using the dev read-only role. Verify representative capture hashes and repeat delivery. | Receipts reconcile with the terminal runs. Repeat delivery skips the same state. The last complete snapshot remains available after a failed attempt. |
| Decide | Close the batch with one short record per publisher in the existing validation results format. Include outcome, run IDs, yield, requests, quality gaps, and the owner and next action for any hold. | The next operator can pick up the work from a run ID or repair ticket. Select the next batch using the new measurements. |

Use the registry as the inventory and join the dev report to it by collection ID so a new, undelivered source is visible. For comparisons, use the same as-of date and reporting horizon. Count each publisher occurrence ID once across its overlapping scopes. Compare the accepted snapshot to the previous complete snapshot for newly seen IDs; label the first snapshot as a baseline. Keep cross-publisher totals labeled as claims until edition matches have evidence. Report requests per newly seen occurrence alongside the raw numerator and denominator, and leave the ratio empty when the denominator is zero.

**When a run stops.** A 429 defers that publisher through its cooldown. A robots denial, 403 or challenge stops that acquisition route. A page budget exhausted with a known frontier remains partial; inspect the frontier before granting more budget. Unknown pagination, unexplained empty results or a quality regression go to evidence review. A delivery outage calls for retrying the outbox from the same journal. Continue with independent publishers while a source is held. The existing CLI handles repair claims, probation, fenced recovery and retries. [Collector validation workflow](source_validation_workflow.md) · [Delivery commands](../README.md)

### 2. Run one batch that tests three kinds of growth

| Publisher | First action | Decision |
| --- | --- | --- |
| Choose Chicago, `url-039` | Revalidate the existing TEC API adapter under default access rules. Reconcile pagination against the published total for the requested start-date range. Earlier-starting ongoing events can fall outside that scope. | Use its two runs to establish volume, request cost, and reproducibility for a large existing calendar. |
| City of Houston, `url-045` | Check default access to the city page and its published iCalendar feed. The earlier complete experiment used the robots opt-out. Use saved feed examples to define the missing quality policy before invoking the acceptance validator. Check native identities, time zones, recurrence and date-only boundaries. | Accept only the city’s published calendar scope. If default access is denied, record the hold and move the batch forward. |
| Helsinki Linked Events, new publisher | Qualify the city’s documented API with a bounded probe. Verify the permitted scope and reuse terms, event and occurrence IDs, pagination, languages, cancellation fields and local time handling. Verify geographic coverage from event locations. | If supported, register the source and its executable, add parser fixtures and a quality policy, then run the same two-pass validation and delivery. Otherwise record the specific missing evidence. [City of Helsinki](https://www.hel.fi/en/business-and-work/helsinki-tourism-and-event-data) |

**First batch deliverable.** One report showing the before/after count of accepted publishers and scopes, upcoming publisher occurrences, newly seen occurrences where a baseline exists, cities supported by location evidence, and requests spent. Show each source’s actual outcome, including holds. Prioritize the next source by added geographic coverage, useful occurrences per request, and a credible path to complete enumeration.

### 3. Fix the discovery regression alongside the batch

Keep collection moving while the report is repaired. In the [Javits query](../db/queries/new_york_javits_publisher_claims.sql), group eligible claims by reviewed edition before applying the date window. Retain the group if any claim overlaps. Add a test in which one publisher ends January 24 and another ends January 25, with the report starting January 25. Both claims must appear and the summary end date must remain open.

When adding ICSC and the AI Summit, put the edition key and year on each reviewed mapping. Use the four December 9–10 pairings as the acceptance case. The two intended pairs must match, the two crossed pairs must stay separate, and the Boat Show and TravMedia regression must still pass. On the fixed November 24 baseline, expect 23 listings from the original 26 claims. These are discovery checks; source acceptance proceeds independently. [Javits evidence](javits-publisher-validation.md)

### 4. Scale after the batch establishes a baseline

Use the first batch to identify whether acquisition, parsing or delivery limits freshness. Start with one supervised worker on its intended persistent host. Give the rehearsal its own journal, a controlled two-page publisher and a known checkpoint. Interrupt the worker after page one commits, allow lease recovery, and restart it through the host supervisor. Verify the same journal reopened, committed work survived, the old lease was fenced, and repeat delivery produced one receipt for the final run state.

Record recovery time, age of the last complete run per publisher, pending delivery age, request cost, and time spent in publisher cooldown. Add concurrency across independent publishers only when measured backlog warrants it. Host pacing and leases are journal-local, so overlapping campaigns against one publisher in separate journals cannot coordinate. A successful hosted rehearsal and a batch with verified delivery are the evidence to bring to the owner for a small scheduling decision. Production promotion and any Railway volume cutover require their own release decision and recovery window. [Previous recovery rehearsal](tise-and-recovery.md)

## October 17 assessment

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
5. **A same-named replacement volume could pass hosting verification.** The verifier now checks Railway's live environment-scoped attachment against the recorded volume ID and expected database service/data mount. It fails on replacement, detachment, wrong environment/service/mount, pending deletion, duplicate attachments or incomplete inventory, and reports the verified live IDs. Read-only live checks confirmed both original database volumes remain attached.

These changes pass offline/controlled tests. They do not revalidate historical live runs or close source repair tickets. The transport still follows redirects before checking the destination; checking every redirect hop before acquisition is a remaining policy-hardening task. The final URL guard prevents accepting that content as a successful collection, but it is not a pre-request redirect firewall.

## October implementation milestones

### 1. Implement the development storage boundary — done in dev, November 4, 2026

Implemented as `db/migrations/001_source_observations.sql`, `src/storage/postgres.mjs`, the per-journal outbox and `npm run db:deliver`; acceptance results are in [`database_delivery_results.md`](database_delivery_results.md). The original plan follows.


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

The November 6 storage decision places permanent capture bytes and hashes in PostgreSQL. For the first worker, use one host with a persistent local journal volume and explicit process supervision, or implement a transactional PostgreSQL queue before using multiple hosts. Never share SQLite WAL over a network filesystem. Back up the journal consistently together with its referenced captures.

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
- `npm test`: 62 passed, including database volume identity/attachment checks, malformed-URL fallback to JSON-LD `@id`, database-key isolation, local-file precedence over inherited Events credentials, real Chromium runtime readiness, controlled API retry/recovery, API/browser redirect rejection and navigation during final browser policy validation.
- `npm run db:check`: development connection passed with TLS and read-only SQL.
- Bounded LA Convention Center browser probe in a disposable journal: one page, 31 observations, explicitly `partial`/`probe_only`; no repair ticket was closed or operational journal reset. This is a transport compatibility sample, not a new complete-source validation.
- Separate production connection check: TLS/read-only SQL passed; no application tables or writes.
- Native Railway state: independent database volumes, successful PostgreSQL deployments, daily/weekly backup schedules and clean IaC plans in both environments.
- `node scripts/verify-hosting.mjs`: validates exact current branch deployments, HTTPS runtime readiness and database infrastructure; secret values are not read by this command.
- `.env.local`: ignored, untracked and owner-only; production assignment commented. Local SQLite observations/captures were retained.

Infrastructure is already provisioned. The review fixes, documentation and updated IaC definition are delivered through a feature PR; application branches still need their normal reviewed merge/promotion. Adopt the updated IaC definition before any subsequent apply so an older whole-project graph cannot omit the new databases/volumes.
