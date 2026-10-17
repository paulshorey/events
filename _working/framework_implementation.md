# Implemented events mining framework

Implementation and live validation completed October 16–17, 2026. Collection tests use `asOf: 2026-10-16`. Read this with `README.md`; the earlier `initial_data_mining_framework.md` describes the original research/prototype stage.

## What is built

Every supplied URL now has a collection configuration and an executable in `scrapers/`: **82 primary URLs plus 15 distinct citation-only leads, 97 entries total**. The scripts use a common deterministic framework. Each entry has its original group, publisher/rate key, market-city hint, category hints, acquisition strategy, selectors, proposed interval, scope and validation state.

These are initial scraper implementations, not 97 validated complete crawlers. Standard JSON-LD/microdata, inspected card contracts, and bounded link discovery provide starting strategies. A source with no recognized dated event contract produces a repair outcome. It is not silently considered successful.

Implemented components:

| Component | Implementation |
| --- | --- |
| Per-URL CLI | `scrapers/url-NNN.mjs`; the same entry is available through `framework run url-NNN` |
| Registry | `sources/registry.json`; separates publisher, acquisition scope, category and city-market provenance |
| Browser acquisition | Headless Playwright Chromium, isolated context, source time zone, bounded readiness waits, access checks and captures |
| API acquisition | Playwright request client; checked public TEC pagination on Network.Vegas |
| Extraction | Shared structured-data parsers and inspected source contracts in `src/adapters/` |
| Durable dispatch | Local SQLite WAL journal, atomic claims, unique active collection, per-host leases and pacing |
| Recovery | Expired lease recovery, fenced writes, persisted page frontier and request budgets, explicit resume/cancel |
| Scheduling core | Opt-in per-collection intervals and due-slot coalescence through `schedule` or `tick`; no supervisor installed |
| Quality and repair | Explicit failure classes, evidence packets, deduplicated repair tickets, exclusive repair claims and candidate probation |
| Local storage | Append-only run observations, raw captures, derived JSONL/result exports, last good/complete pointers |
| Tests | 45 passing regression/integration tests, plus the live browser fleet and complete pagination runs |

No external development database, hosted worker, Codex scheduled task, background daemon or website has been configured. **All 97 schedules remain disabled.** Manual runs are independent of schedule enablement.

## Measured results

All 97 registered entries were attempted through the Playwright browser framework. Blocked entries stop before or during navigation; they are access results, not parser-validation results. Follow-up runs repaired several contracts and validated complete enumeration for three scopes.

Latest per-URL state at handoff:

| State | Collections | Meaning |
| --- | ---: | --- |
| Complete | 3 | Tested interface/query exhausted and its quality gates passed |
| Partial | 26 | Probe, budget stop, unresolved pagination or unverified scope; 25 of these retained positive event samples |
| Repair needed | 42 | No compatible event contract or a selector/contract problem |
| Blocked access | 25 | Access denial/challenge; needs feed/access investigation |
| Retry wait | 1 | Javits robots request returned 429; cooldown retained |
| **Total** | **97** | Every supplied entry has an outcome |

**28 collections have positive event observations.** Their latest runs contain 1,238 observations in total. This sum includes overlapping collections, repeated publishers and some international listings. It is not a count of unique US events or approved website content. The complete-source scope and source-specific field accuracy still matter.

`framework_source_results.md` and `.json` contain every URL, its strategy, latest run ID, count, state, repair tickets and reason. `framework_validation_summary.json` records these aggregate counts. `framework_event_samples.json` provides up to two reviewable event observations per positive collection; regenerate it with `node scripts/export-framework-samples.mjs`. The journal contains the full attempt history; reports summarize latest attempts.

Three scopes each passed two fresh complete runs on the same final candidate revision:

| Source | Method | Each run | Termination/reconciliation |
| --- | --- | --- | --- |
| LA Convention Center, `url-038` | Playwright + inspected `.eventItem` cards on `/events/all` | 31 events, 1 page | All cards from the declared all-events interface; no remaining page frontier |
| Boston.gov, `url-054` | Playwright + visible occurrence groups and `rel=next` | 325 occurrences, 11 pages | Next links exhausted; recurring source node/date/time keys preserve occurrences |
| Network.Vegas, `url-019` | Public TEC API through Playwright request client, 50/page | 298 events, 6 pages | Reported total remained 298 and matched unique extracted records at the final page |

The framework closed these three repair probation tickets using its own two-run gate. See `full_enumeration_results.json` for the latest repeated run IDs and code build ID, and `repair_probation_results.json` for the ticket closure evidence. These closely spaced runs demonstrate repeatability at this point in time; they do not establish reliability over weeks of source changes.

The Network.Vegas scope is specifically its recorded `start_date=2026-10-16` API query. Earlier-starting ongoing events may be outside it. Browser completion describes the inspected listing interface, without promising all events elsewhere on a publisher's domain or hidden filters. API total reconciliation cannot provide an upstream atomic snapshot.

Additional live browser samples include:

| URL entry | Parser | Latest retained events | Remaining issue |
| --- | --- | ---: | --- |
| AllEvents, `url-002` | Event JSON-LD | 24 | Homepage sample; national/city enumeration unverified |
| FestivalIndex, `url-007` | Embedded event-card payloads | 23 | Filters, pagination and geography need validation |
| Meet Me at the Fair, `url-009` | Bounded directory/detail discovery + JSON-LD | 10 | Four requests consumed; 660 discovered tasks remain, with scope cleanup needed |
| Tradeshow Calendar, `url-014` | Inspected table columns and date ranges | 100 | Pagination/filter scope and US restriction unverified |
| NYC Tourism, `url-024` and `url-025` | Inspected cards with date ranges | 12 each | Overlapping views; client-side filters/pagination unverified |
| Eventbrite Las Vegas / NYC, `url-023` / `url-034` | Event JSON-LD | 30 / 39 | City samples; no complete discovery API claim |
| DoThisNYC, `url-033` | Event JSON-LD | 10 | Editorial/annual scope and completeness review |
| Discover LA, `url-035` | Cards/structured data | 27 | Rejected cards and pagination need improvement |
| Choose Chicago, `url-039` | TEC HTML/JSON-LD | 24 | Full paging/API tenant behavior unverified |
| Chicago Park District, `url-042` | Inspected timestamp cards | 1 | Other cards lack an explicit year-bearing timestamp; need details |
| Washington.org, `url-049` | Inspected Drupal date cards | 10 | Filter/pagination contract unverified |
| Events DC, `url-051` | Event cards | 5 | Root page is not a complete calendar scope |
| Miami annual events, `url-057` | Cards | 23 | Some records rejected; annual guide scope |
| SF Travel portal, `url-065` | Inspected convention rows | 26 | Filter/pagination and fragment-based provisional identity review |
| Orlando / Downtown Orlando, `url-079` / `url-080` | OpenCities date cards | 10 each | Paging and detail duration need validation |
| San Diego Convention Center, `url-082` | Inspected event rows + full numeric dates | 60 | Validate full listing scope and termination before promotion |
| NYC Parks aggregate feed, `url-085` | Event microdata | 39 | Aggregate paging and public endpoint stability unverified |

These samples are candidates. For example, a city calendar can include an application deadline rather than a public event. The trade-show table includes non-US cities. Neither should be promoted based only on a valid date/title.

## Obvious execution flow

1. **Register:** load the source/collection configuration. Retain operational enablement and historical results.
2. **Select:** manually enqueue a scope, or select due enabled collections. Skip unresolved repair/access/validation states. Coalesce missed intervals and existing active work.
3. **Claim:** obtain an exclusive collection run and publisher lease with a new fencing token.
4. **Acquire one task:** reserve host pacing, verify robots policy, render HTML or call the configured API, and save the response before parsing it.
5. **Parse and checkpoint:** validate dates and identity; atomically save observations, discovered next tasks and the page outcome. Page success survives a process interruption.
6. **Continue:** follow verified pagination or the bounded discovery frontier until exhaustion, an error, cancellation or budget boundary.
7. **Evaluate:** mark complete only for a validated enumeration contract with terminal evidence, no pending/failed pages, no quality issues and matching declared totals. A probe always remains partial.
8. **Persist the outcome:** update attempts, last-good/complete references, repair state and audit actions; write rebuildable exports from committed SQLite records.
9. **Recover or improve:** transient failures wait for cooldown. Interrupted runs recover their frontier. Contract defects enter repair; repaired candidates need regression tests and two complete validation runs before their ticket closes.

Nothing in this loop calls an LLM. The future agent reads repair evidence and produces deterministic code/configuration changes outside the collection loop.

## Durable behavior and limits

The SQLite transaction boundary is the page checkpoint. A crash after a page commit keeps its observations and newly discovered tasks. A crash before commit leaves that page repeatable. A lost worker can no longer commit with its old token after recovery or takeover. This is at-least-once acquisition with idempotent observation keys, not exactly-once network requests.

Tests cover two-process hostname locking, a deliberately killed worker retaining one completed page and one recoverable page, stale-owner rejection, cancelled ownership, transaction rollback, source scheduling, retry cooldowns, request-budget persistence, exact final-page budget completion, API total reconciliation, repeated-page detection, last-good preservation, count collapse quarantine, repair probation, date/recurrence semantics and recoverable export failure. A real Playwright HTTP integration test serves a controlled API, returns 429 on the second page, and verifies that a new client resumes after Retry-After without recollecting the successful page.

Budgets are checked between tasks. The current bounded task may finish after the overall runtime threshold. Record limits can be exceeded by one atomic page batch; records are not silently dropped mid-page. Expired-worker elapsed time is charged conservatively, including downtime, so a recovered run may require an explicit runtime-budget increase. This favors bounded work over hidden resets.

Code/configuration snapshots are frozen per run. Source captures and historical observations remain available when a parser is fixed; a fresh run uses the new revision. Do not edit parsers/shared runtime while workers are using that checkout. A production deployment should use an immutable code bundle/container per build. The local build guard prevents silently resuming old checkpoints under changed code, but is not a deployment isolation system.

SQLite WAL is a single-host design. Hosted/distributed workers need a shared transactional queue. Raw captures and SQLite need consistent backups; exports alone are not the operational history. Add retention and object storage before unattended, large-volume operation. No power-loss durability claim for capture files or long-duration service availability is established by the process recovery tests.

## How the remaining URLs get improved

Use the per-URL report and repair packets as the work backlog, not a new spreadsheet detached from the code. Every URL retains its original identity even when it shares an adapter or is an overlapping discovery view.

- **42 contract/no-result entries:** inspect saved HTML and the bounded browser network probe. Distinguish homepages/editorial guides from actual calendars. For dynamic listings, inspect the public feed/API and establish the real filter/pagination contract before changing selectors.
- **25 access-blocked entries:** investigate publisher feeds, documented API access or appropriate permission. Do not put challenge solving or proxy rotation into a parser repair. An access change may later warrant a fresh diagnostic run.
- **Javits retry:** honor the recorded 429 cooldown; inspect robots/feed availability if it persists. A robots-request failure does not prove a selector defect.
- **26 partial entries:** prioritize existing positive samples. Add complete paging, year/recurrence/detail semantics and empty-state evidence. Meet Me at the Fair demonstrates a large persisted frontier, but its broad discovered links still need scope refinement. San Diego/SF can likely progress quickly after verifying listing controls. That is an engineering hypothesis, not a validated completeness claim.
- **Shared platform groups:** extend and validate Simpleview, TEC, Drupal, OpenCities, Trumba, Next.js and ConventionCalendar contracts per tenant. A common platform hint is insufficient to enable all tenants.
- **Related URLs:** maintain separate user-supplied provenance, while avoiding unnecessary duplicate scheduled scopes. LA's smaller root view explicitly aliases `/events/all`; NYC Tourism and other annual/calendar views overlap. Review aliases before enabling collection.

For each repair, claim its ticket, inspect evidence, save a bounded fixture, update the adapter/config, run regression tests, freeze a probation candidate, and validate two complete live runs. Reparse historical captures offline as a quick regression check; do not overwrite them. If the code cannot yet establish complete scope, leave it partial and retain the ticket.

## Before external database and AI scheduling

The current milestone is usable: more scrapers can be developed, bounded runs can be dispatched concurrently, failures survive restarts, and evidence/repair work is stored. The commands and repair workflow are in `README.md`.

The remaining infrastructure steps are deliberate boundaries:

1. Supply the development database configuration through ignored credentials/environment storage. Follow `database_handoff.md` for append-only source observations, idempotent delivery, canonical events and city/category tags.
2. Add an upload outbox with delivery receipts and database-outage tests. Remote delivery retries must not trigger scraping again.
3. Choose a worker host, install a process supervisor and backups, and validate long-running behavior. Use a deterministic due-work tick; keep per-source schedules in the registry/journal.
4. Add Codex coordination for onboarding and repair claims once its operating scope is reviewed. Agents change scripts; the traditional CLI remains responsible for acquisition.
5. Activate validated collections gradually. Keep failed/access-blocked/unknown-coverage scopes held until their corresponding issue is resolved.
