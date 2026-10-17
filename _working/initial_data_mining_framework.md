# Initial data mining framework validated against the supplied websites

> Implementation update: the durable CLI framework, per-URL scripts, page enumeration/checkpoints, repair workflow, and fleet test evidence now live in [framework_implementation.md](framework_implementation.md). Sections below describe the earlier prototype stage; use README.md and that implementation report for current commands and limitations. The external database and Codex automation remain deferred.

Updated October 16, 2026, America/Chicago. The capture files use UTC, so some timestamps begin October 17. This replaces the earlier conceptual plan with a tested prototype and an implementation sequence.

## 1. What now exists

The project has three deterministic CLI miners, a source inventory, saved inspection evidence, regression tests, and a read-only coordinator preview. No LLM runs inside the miners. No central database, recurring task, dispatching scheduler, or production worker has been created.

- `sources/seed-urls.json`: 82 main-list URLs in 19 groups, spanning 60 normalized hostnames, plus 15 distinct citation-only leads.
- `_working/event_sources.txt`: the requested simple text format, with a category/city heading followed by its URLs.
- `_working/source_assessment.md` and `.json`: a next action and proposed interval for all 97 URLs.
- `examples/`: tested extraction and shared runtime code.
- `.artifacts/runs/`: immutable per-attempt captures, result packets, and JSONL event records.
- `_working/sample_events.json`: a combined, structured example dataset.
- `npm run status`: reports latest outcomes and collect/wait/repair/access decisions. It never dispatches work.

The prototypes are native Node.js ECMAScript modules to make the CLI experiment directly runnable. The source/adapter boundary carries forward into the production implementation; TypeScript can add compile-time contracts there.

## 2. Actual sample results

Environment tested: Node 26.9.0, Playwright 1.64.1, headless Chromium on this Mac. Collection date fixed at `2026-10-16`. These are bounded compatibility samples, not complete-source imports.

| Source | Acquisition tested | Result | Coverage limit |
| --- | --- | --- | --- |
| Los Angeles Convention Center | Playwright opens `/events/all`; deterministic HTML parser reads event cards | 8 structured records accepted from 31 observed cards | One rendered page; record sample capped at 8; no detail-page enrichment |
| Boston.gov | Playwright opens the calendar and follows its next-page link; parser uses visible date groups and times | 35 structured records accepted from 60 observed cards on two pages | The initial pager advertised last page index 10; remaining pages and recurrence changes are unverified |
| Network.Vegas | Playwright `APIRequestContext` calls its public WordPress The Events Calendar endpoint | 10 records accepted across two API pages | Upstream reported 298 results / 60 pages at five per page; sample is limited to two pages and excludes some earlier-starting ongoing events |

Every successful prototype reports `sample_passed` and `enumeration.complete: false`. Those names deliberately prevent a successful sample from becoming proof that an entire source was collected. `_working/prototype_results.json` records run IDs, counts, and paths to the raw evidence.

Reproduce the samples:

```sh
npm ci
npx playwright install chromium
npm test
npm run mine -- --source la-convention-center --limit 8 --max-pages 1 --as-of 2026-10-16
npm run mine -- --source boston-gov --limit 35 --max-pages 2 --as-of 2026-10-16
npm run mine -- --source network-vegas --limit 10 --max-pages 2 --as-of 2026-10-16
npm run status
```

Omit `--as-of` for a fresh sample using the source's local current date. Full-source collection is not implemented by increasing a flag and assuming completion.

## 3. What the experiment changed in the design

**HTTP access and browser access must be recorded separately.** A bounded HTTP pass returned unflagged HTTP 200 responses for 73 of the 82 primary URLs. That does not mean 73 working extractors. Ordinary Playwright loaded Javits successfully after the HTTP probe returned 429. Conversely, Seattle's calendar and Orange County Convention Center served HTML to HTTP requests but returned 403 in Playwright. Headless browsing is one acquisition method, not a universal fix. Investigate public feeds or appropriate access for blocked sources; do not keep rewriting selectors or add challenge bypass.

**One source can expose a much better collection route than another URL from the same list.** LA's `/events/all` exposed 31 cards; its smaller root listing exposed six. The two Network.Vegas URLs are overlapping views of one publisher and should share acquisition and upstream category tags. A homepage, venue guide, or press page should not automatically become a separately scheduled miner.

**Valid structured data can have the wrong semantics for the occurrence being displayed.** A captured Boston recurring event had a visible October 17, 8–9am listing, while its shared detail page's JSON-LD contained October 16 at 23:00:10 without an offset. The prototype takes occurrence dates/times from the visible list groups. It does not distribute one detail-page timestamp to every recurrence. A Network.Vegas API event was marked all-day while its description gave an evening time. The script preserves that claim and adds a quality warning; it does not invent a correction.

**A failed parser must leave a repairable record.** Boston's first attempt failed because some cards link directly to an external event website instead of `/node/<id>`. The failure was saved with its HTML, screenshot, and trace. Two fixture tests failed on the original parser; the parser was repaired to accept both inspected link forms, then all tests and the live two-page sample passed. This demonstrates the intended repair method. It was an initial adapter defect, not evidence that Boston changed its website during the experiment.

## 4. How to organize many websites and scripts

Use three separate registry objects:

1. **Adapter:** deterministic code for a platform or site, with a version and input contract.
2. **Source:** publisher/website, shared access rules, quotas, and acquisition notes.
3. **Collection:** independently scheduled scope within a source, such as a venue, category feed, or calendar section.

Do not create a Codex task or a cron entry for every URL. Maintain one registry and select due collections. A source belonging to several categories or cities is collected once for that scope. Collection IDs, rather than category folders, determine work identity.

The main list mixes subject categories with city markets. Preserve the original grouping as provenance, but store category hints and city-market hints separately. A Boston market label does not prove the venue's locality is the City of Boston: the samples include Dorchester and Mattapan. Online events can lack a physical city. The sample data keeps `marketCity`, source address locality, upstream categories, and source-level category hints distinct.

Keep each adapter small. The shared runtime owns browser/API clients, captures, timeouts, record validation, and structured errors. The adapter supplies entry points, selectors or response paths, record identity, and pagination. Playwright documents isolated [browser contexts](https://playwright.dev/docs/api/class-browsercontext), [API request contexts](https://playwright.dev/docs/api/class-apirequestcontext), and [tracing](https://playwright.dev/docs/api/class-tracing); those primitives are verified here with the pinned package.

## 5. What to do with every remaining URL

The exact disposition of each URL is in `_working/source_assessment.md`; the JSON version supports future agent assignment. Proposed intervals in that report are starting policies and are all disabled.

Onboard in these batches:

1. **Finish the three proven sources.** Verify the rest of pagination, changed/deleted records, record identities, ongoing events, genuine empty states, and detail-page facts. Extend fixture coverage before activation.
2. **Shared WordPress event calendars.** Validate the API adapter independently on NetworkInVegas and Choose Chicago. The HTML fingerprint suggests the same plugin family; it does not establish that their APIs and custom fields match.
3. **Tourism calendars with Simpleview hints.** The initial HTML pass found hints on 15 primary URLs, including related views of the same sources. Inspect one representative site's real network/feed interface, build one adapter, and validate each other tenant. Views with annual events or editorial guides may still need separate handling.
4. **ConventionCalendar directory and venue pages.** Develop one platform adapter with venue collections for Javits and Orange County. Keep those source claims distinct from direct venue calendars and reconcile duplicates downstream.
5. **Drupal, OpenCities, Trumba, and other government calendars.** Reuse runtime helpers and verified common structures, while allowing site-specific modules. Inspect published RSS/iCalendar feeds or embed interfaces first. Department pages and permit calendars require content-scope review.
6. **Aggregators and custom sites.** Eventbrite, AllEvents, Events.com, FestivalNet, FestivalIndex, the fair directories, TSNN, 10times, Tradefest, ConventionGrid, the legacy PHP calendar, and custom city listings need individual acquisition/access investigation. A public website does not prove unrestricted national API enumeration. Official Eventbrite API documentation returned 429 to this research session, so public discovery API availability remains unresolved here.
7. **Annual guides, fixed-year articles, press releases, homepages, and hotel pages.** Use these to discover actual calendars and dated events. Verify the year and follow the underlying source. The supplied Las Vegas January 2026 filter is historical; do not schedule it unchanged as an upcoming-event collection.

Each onboarding assignment must produce an adapter/configuration, a scope definition, stable record identity, pagination/termination evidence, a labeled fixture, a bounded live result, and a proposed interval. A successful transport probe alone never enables it.

## 6. Codex scheduled task design

The suggested five-minute Codex coordinator is feasible as a pilot. Official documentation supports minute-based recurring tasks inside a chat. Local tasks require the computer to remain on, the app running, and the project available; a non-Git project runs in its project directory. Account policy and network permissions must also permit the commands. [Official scheduled-task documentation](https://learn.chatgpt.com/docs/automations).

Use one local coordinator returning to this chat. Its stored prompt is drafted in `_working/codex_automation_prompt.txt`. No Codex automation was created during this experiment.

A five-minute AI wakeup is 288 potential runs per day, even if no source needs collection. Start with that only if frequent interactive repair is useful. The production recommendation is a deterministic scheduler checking due work approximately every minute, with Codex waking less often to handle repair/onboarding. Per-source intervals remain independent: initially 6h for Network.Vegas, 12h for Boston, 24h for LA, and roughly weekly for secondary annual guides, adjusted after observation.

One coordinator pass follows this order:

1. Reconcile existing active run/repair claims and ambiguous launches.
2. Read the source's latest attempt, next eligible time, and health state.
3. If a confirmed parser/contract defect is unresolved, claim a repair task instead of launching the same failing miner.
4. If the problem is throttling or transport, honor cooldown and retry limits. If it is access/credentials, leave an explicit blocked state.
5. Otherwise dispatch one due enabled collection within a bounded work budget.
6. Persist the selected action, run ID, and result. Report only material changes or required human action.

The current `npm run status` implements a tested read-only decision preview. It does not implement claiming, dispatch, cooldown persistence, repair execution, or durable scheduling. Turning on `enabled` in the sample JSON does not create those mechanisms. Implement and test them before activating the drafted Codex task.

Long collections should run in supervised deterministic workers with run receipts and checkpoints. Codex should not remain alive just to wait for a healthy scraper. Model work is reserved for investigating a source or developing a code change.

## 7. Detecting breakage and deciding what happens next

| Observed outcome | Persisted state | Next eligible action |
| --- | --- | --- |
| Valid bounded sample | `sample_passed` | Compatibility evidence only; still needs source-completeness work |
| Complete validated production run | `healthy` | Wait until that collection's next due time |
| Timeout, HTTP 5xx, temporary network fault | `retry_wait` | Retry after recorded backoff, within the shared attempt budget |
| HTTP 429 | `rate_limited` | Honor provider delay and shared quota; no parser rewrite |
| Login/credentials failure or access challenge | `blocked_access` | Resolve access/feed choice or record required human action |
| Missing required selector/path, changed type, repeated pages | `repair_needed` | Inspect captured input, reproduce, change adapter, test |
| Empty output without a verified empty-state contract | `suspect` | One bounded verification, then diagnosis rather than infinite re-runs |
| Correct parser but contradictory source facts | `needs_data_review` on affected records | Retain evidence; avoid treating a source claim as a parser defect |

Use record yield, field coverage, date horizon, repeated IDs, page/cursor progress, and source-specific assertions. A markup hash change is only a hint. For example, missing `.eventItem` cards or incompatible TEC `events/total/total_pages` fields are concrete failures, while a new optional JSON field is harmless.

Keep collection health separate from freshness and enumeration completeness. Partial, failed, or budget-limited runs cannot advance `last_complete_at` or remove missing events. A failed refresh must preserve earlier accepted observations. The prototype already retains the last passing sample separately from later failures.

A repair assignment contains the failing capture, last-good fixture, adapter/configuration revision, failed assertions, historical counts, and reproduction command. Test shared-adapter consumers, not just the originally failing host. An agent must not weaken assertions to declare recovery. After a bounded passing probe, run the full configured scope; require two complete healthy runs in probation before closing the repair.

## 8. Central database proposal

After the development connection is provided, use one PostgreSQL database for all categories and cities. The current experiment makes no database connections and applies no schema.

| Tables / objects | Purpose and key constraints |
| --- | --- |
| `sources`, `collections` | Registry IDs, adapter/configuration revision, source groups, enabled state, interval, next due time, shared rate key, scope, budgets |
| `crawl_runs`, `crawl_attempts`, `crawl_pages` | Logical runs, retry history, request frontier, captures, completeness evidence, metrics, structured failures |
| `source_event_observations` | Append-only raw/extracted claims with source record/occurrence identity, capture reference, content hash, parser version, warnings, and retrieval time |
| `source_events` | Current accepted observation per source record/occurrence; unique source and upstream identity; failures do not erase this pointer |
| `events`, `event_source_links` | Canonical event identities linked to contributing source events; merge/redirect history supports later cross-source reconciliation |
| `cities`, `event_cities` | Stable geographic identities and supported event-city assignments; discovery-market labels remain separate |
| `categories`, `event_categories` | Controlled categories with source mapping, assignment basis, and review status; multiple categories per event |
| `repair_jobs`, `source_health` | Deduplicated repair assignments, claim/lease, failure class, cooldown, last attempt/healthy/complete times, recovery evidence |

Store dates with their actual precision: date-only values as `DATE`, known local timestamps with an IANA zone, and UTC instants only when conversion is supported. Missing times and prices remain null. Preserve source claims and conflicts; source-level category hints do not become verified event classifications silently.

Keep native source IDs where they exist. Boston currently uses node ID plus occurrence date/time because a node repeats across sessions; schedule changes may require identity reconciliation. Do not use a mutable title or complete-payload hash as the event's permanent identity.

Large HTML/screenshots/traces belong in an artifact store, referenced by immutable keys and hashes. Use persistent local storage for the development pilot, then object storage if workers run on multiple machines. Source retention and redaction rules apply. Connection strings are loaded from ignored environment configuration, not source manifests or reports.

Publication into the canonical `events` view must be a separate, validated operation. The initial database import can store observations and source events first, then add category/city resolution and conservative duplicate reconciliation without re-scraping the sites.

## 9. Execution and recovery after database setup

Use PostgreSQL-backed jobs such as `pg-boss`; its documented transaction integration can create the run and queue job together. [Job creation and retry documentation](https://github.com/timgit/pg-boss/blob/master/docs/api/jobs.md).

The production scheduler transaction selects due enabled collections and creates a unique collection/schedule-slot run. A worker acquires a source lease, snapshots its adapter/configuration, and processes a persistent request frontier. HTTP/API and browser pools have separate capacities. Shared domain/provider-account rate limits apply across pools and manual runs.

Persist page tasks and follow-up pagination before acknowledging work. Record per-attempt errors and aggregate budgets across retries. Checkpoint, cancel, and reject writes from a worker whose lease has been replaced. Do not hold a database transaction during network work. After downtime, coalesce missed schedule intervals into one fresh collection instead of replaying an obsolete backlog.

Expected outcomes are at-least-once execution with idempotent storage. A network request may repeat after a crash. Do not promise exactly-once HTTP/model calls or source completeness from queue delivery.

## 10. Next implementation sequence

1. Review this plan and the per-URL assessment. Supply the intended development database configuration through ignored secret storage.
2. Create migrations and storage for sources, collections, observations, attempts, and repair state. Import the seed registry with every unvalidated source disabled.
3. Finish complete-source adapters for the three samples, including ongoing-event scope, stable occurrence identity, genuine empty results, and snapshot retirement rules. Inspect detail-page facts where needed.
4. Implement atomic claims, deterministic due selection/dispatch, cooldowns, checkpoints, worker supervision, and structured status. Failure-inject crash recovery, overlapping coordinator runs, lease loss, throttling, and broken pagination.
5. Manually test the drafted Codex coordinator against that status/dispatch interface, then activate its schedule. Review initial runs before expanding.
6. Onboard the remaining URLs in the batches above. Enable each independently after its own extraction and completeness checks pass.

The present experiment establishes that this design can collect structured event samples through both Playwright and public API access, and that a parser defect can be reproduced and repaired. It does not establish autonomous scheduling, complete national coverage, or a finished central ingestion pipeline.
