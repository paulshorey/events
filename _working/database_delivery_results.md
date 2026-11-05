# Database delivery and collection results — November 4, 2026

Milestone 1 of [`review_and_next_steps.md`](review_and_next_steps.md): terminal journal runs are now delivered to the **dev** Railway PostgreSQL database (`Postgres`, project Events). The existing project, environments and database were reused; no Railway configuration changed. `.env.local`'s active `DB_EVENTS_URL` was confirmed to be the dev database by comparing a hash of its host/database with the dev and production `DATABASE_PUBLIC_URL` variables, without printing either value. Production has no application tables.

## What was delivered

| Journal | Terminal runs | Observations | Notes |
| --- | --- | --- | --- |
| `.artifacts/framework` (operational, legacy schema v1) | 139 | 4,334 | Read-only; not migrated |
| `.artifacts/source-validation/acceptance` | 13 | 26,607 | October 25 acceptance runs incl. Orlando enrichments/expansions |
| `.artifacts/source-validation/probes` | 5 | 286 | Diagnostic probes, status preserved |
| `.artifacts/source-validation/2026-11-04-pg` | 2 | 12,210 | Chicago two-run validation on the current build |
| `.artifacts/collection/2026-11-04` | 20 | 1,168 | Full bounded runs of open sources (below); `url-023` still in `retry_wait` |

After review fixes (migration `002`; delivery format 3: failed-page and retried-page captures, validated evidence metadata and backfill, refreshed run options and page metadata, newest-run collection metadata, transactional verification) every run was redelivered. The database then held 187 runs, 45,069 append-only observations, 1,781 distinct evidence objects, all with gzip bytes (30 pages carry a failed-attempt capture), 551 receipts (one per run state per delivery format), and occupied 216 MB. Database counts of pages and observations equalled the SQLite totals for every delivered journal (for example 2,201 pages and 30,941 observations after the first two journals). A second delivery pass skipped every run and created no receipts.

`current_source_records` (latest complete run per collection) contains 7,198 records from nine collections; 7,021 are upcoming as of November 4. 6,838 distinct event URLs: Las Vegas `url-019`/`url-020` and LA `url-037`/`url-038` are overlapping views of the same publishers. These are source observations, not deduplicated canonical events.

| Collection | Records | Run build | Basis |
| --- | --- | --- | --- |
| `url-039` Choose Chicago | 6,105 | `e945204` (current) | **Two complete runs** today; validator accepted |
| `url-054` Boston.gov | 293 | `33de67b` (Oct 25) | Today's run: HTTP 503 site outage (`retry_wait`) |
| `url-019` network.vegas | 298 | `c424b94` (Oct 17) | Not rerun |
| `url-080` Downtown Orlando | 213 | `33de67b` (Oct 25) | Access-blocked since; held |
| `url-020` network.vegas conventions | 147 | `e945204` | Complete after an explicit budget extension; subset of `url-019` |
| `url-082` San Diego Convention Center | 58 | `02990b1` | New single-page contract; **two complete runs** today |
| `url-038`/`url-037` LA Convention Center | 31/29 | Oct 17 / current | Same listing |
| `url-021` networkinvegas | 24 | `e945204` | One complete run |

## Acceptance checks

- One known complete run (Chicago `5b224ae2`, 124 pages, 6,193 observations) was imported first and verified before bulk delivery.
- Disposable-cluster tests (`tests/postgres-delivery.test.mjs`): migration checksum guard; full counts, projection and evidence-hash equality; outbox skip; crash-before-local-receipt replay as a duplicate; interrupted transaction rolled back with zero rows; database outage with an unchanged journal and later retry; resumed run appended under a new receipt; changed payload rejected; legacy journal without enrichment tables; non-terminal runs refused; connection policy ignores `DATABASE_URL`.
- No destructive test touched the Railway database.

## Collection campaign

Full bounded runs (`--max-pages 80`, explicit runtime) of 19 sources with earlier positive probes, in a separate journal and three host-disjoint lanes:

- **Complete:** `url-021`, `url-037`, `url-020` (after resume).
- **Coverage unverified (parser works, no list-completeness contract):** `url-002`, `url-004`, `url-007`, `url-014`, `url-033`, `url-034`, `url-049`, `url-051`, `url-057`, `url-065`, `url-085`. `url-085` (NYC Parks aggregate) really contains five events; its parser is not losing records.
- **Budget-bounded discovery frontiers:** `url-009` (75 records), `url-013` ConventionGrid (resumed to 400 requests, 372 records, still partial; detail discovery yields about one record per request).
- **Held, not retried:** `url-079` robots disallow; `url-023` Eventbrite HTTP 429 cooldown; Boston.gov returned its own "Temporarily Unavailable" 503 page to the crawler and to curl.

### Collector improvement made

San Diego (`url-082`) was partial only because its single page had no completeness contract. Its `Load more` control only unhides `.calendar .item` rows already in the server HTML. Static reading of page scripts cannot prove that (review found successive gaps: request APIs, script loading, delegated bindings), so the contract is behavioural: the browser transport's `revealProbe` clicks the control until it disappears and records publisher-host requests and item counts. While probing, every non-static request is aborted before transmission, so a changed handler cannot bypass robots, pacing or budgets. The adapter marks the page `verified-list`/terminal only when the control was visible with hidden rows and was clicked, the probe saw zero publisher requests, unchanged item counts, every item visible and the control gone, every item is one public parsed row (zero rejected) or an unlinked `Private` placeholder, and no server pagination exists. Captures without a probe (older runs, HTTP transport) stay unverified. Ten private bookings are reported as `excluded.privatePlaceholders`. Live runs on the final build recorded 6 clicks, 68/68 items revealed, 0 publisher requests (16 third-party analytics/widget requests blocked) and 58 events each.

## Recommended next collector work

1. Rerun Boston twice when boston.gov recovers, then `npm run db:deliver`.
2. Apply the same evidence method to the other single-document sources: `url-014` (exactly 100 rows, so likely truncated — find its paging), `url-065` SF portal, `url-049` DC. Each needs a captured proof of its list boundary, a fixture with failing variants and two complete runs.
3. Prefer the TEC REST API for `url-020` and `url-021` (as `url-019`/`url-039` do) to avoid detail-page budgets.
4. Add capture object storage and move evidence bytes out of PostgreSQL before volume grows (milestone 2), then a hosted worker that runs `db:deliver` after each run.
