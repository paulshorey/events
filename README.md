# Events mining framework

A deterministic Node.js CLI framework for collecting event observations from the supplied websites. Each of the **97 supplied URLs** has a runnable Playwright entry point and a registry record. They share browser operations, parsers, validation, persistence, and repair handling. Many sources still need source-specific development; having an entry point does not mean a complete crawler has been validated.

No model calls occur during extraction. AI agents or engineers improve the code using captured evidence and regression tests. The local SQLite journal remains operational storage. Separate Railway PostgreSQL databases now exist for dev and production; event tables and the importer have not been implemented. Railway hosts passive dev and production services, with all collection schedules disabled. See [.railway/README.md](.railway/README.md) for infrastructure operations and [_working/review_and_next_steps.md](_working/review_and_next_steps.md) for the review and next milestones.

## Hosting

GitHub repository: [paulshorey/events](https://github.com/paulshorey/events). Railway project: [Events](https://railway.com/project/a0315029-9b64-41a0-9c83-e4367366947d). Pushes to `main` deploy dev; pushes to `prod` deploy production after CI passes. The deployment host exposes `/api/health`, checks Chromium/SQLite/registry readiness, and runs no collection schedule. Each environment has a project-specific `DB_EVENTS_URL` reference to its own PostgreSQL service’s `DATABASE_PUBLIC_URL`. The application does not yet use that connection or have durable cloud job storage.

Run `npm start` locally to inspect the passive host on port 4500. Set `PORT` to override it. `.railway/project.json` owns target IDs and branch mapping; `.railway/railway.ts` owns applied configuration. Changes to IaC require a separate reviewed plan/apply.

## Local database access

The ignored `.env.local` contains the development PostgreSQL URL as active `DB_EVENTS_URL` and the production URL as a commented assignment. Local clients and Railway services always use the public TCP endpoints with TLS. Events clients read only `DB_EVENTS_URL`, so an unrelated global `DATABASE_URL` cannot select another project’s database. Keep production commented during local development. `.env.example` is the credential-free template for another checkout. Ordinary framework commands need no remote database connection.

```sh
# Requires psql on PATH, or PSQL_PATH pointing to its executable.
npm run db:check
```

This loads `.env.local` explicitly and executes read-only SQL, reporting the PostgreSQL major version, TLS state and public application-table count. It does not print the connection URL, run migrations, or upload events. See [_working/database_handoff.md](_working/database_handoff.md) for the ingestion boundary and remaining schema work.

## Start here

Tested on Node 26.9.0 with Playwright 1.64.1 and headless Chromium. Use Node 24 or later, with `node:sqlite` available; this task does not change your managed Node installation.

```sh
npm ci
npx playwright install chromium
npm test
npm run framework -- init
npm run framework -- list --group 'New York City'

# One source, explicit limits. Its individual entry point uses the same framework.
node scrapers/url-038.mjs --as-of 2026-10-16 --max-pages 2
npm run framework -- run url-054 --as-of 2026-10-16 --max-pages 30
npm run framework -- run url-019 --transport api --as-of 2026-10-16 --max-pages 30

# A bounded compatibility check. It always records incomplete coverage.
node scrapers/url-007.mjs --probe --max-pages 1
npm run framework -- status
npm run framework -- report
```

For `run` and `work`, exit codes are 0 for complete execution (or an explicitly requested, positive probe), 2 for partial enumeration, 75 for a scheduled transport retry, and 1 for repair/access/ownership errors. The JSON result is authoritative. A `queue`, `init`, or `report` exit code says that operation succeeded, not that scrapers passed. A successful `run` that coalesces with existing active work retains that run's original options; inspect the printed run ID and frozen options with `show`.

## Dispatch and recovery

```sh
# Select a group, the 82 primary URLs, or all 97 entries.
npm run framework -- queue --group 'Orlando' --probe --max-pages 1
npm run framework -- work --max-jobs 10 --concurrency 3
npm run framework -- show RUN_ID
npm run framework -- recover
npm run framework -- resume RUN_ID --max-pages 200 --max-runtime-ms 600000
npm run framework -- work RUN_ID
npm run framework -- cancel RUN_ID
npm run framework -- export RUN_ID
```

`max-jobs` is per worker. The maximum CLI concurrency is four. The durable frontier stores pending pages, discovery links, successful pages, and records in SQLite. A page commit atomically saves its records and follow-up tasks. Worker and hostname leases prevent concurrent collection of the same source and fence an expired worker out of future commits. Expired leases are recovered when a worker starts or `recover` runs. Successful pages survive interruptions; an in-flight request can be repeated after a crash. Requests are counted before acquisition, so retries and recovery consume the original budget. Resuming requires explicit budget extensions and unchanged code/configuration; changed parsers require a fresh run. Budgets are checked between tasks; a bounded in-flight task can exceed the runtime threshold, and the atomic final page can exceed the record threshold. No records are silently dropped mid-page.

Partial runs retain their frontier. Repeating `run` after a terminal partial result starts a new run; use `resume` to keep its checkpoints. Normal scheduling skips unresolved repairs, access blocks, partial results requiring validation, and probation. Manual runs remain available for diagnosis.

The shared journal uses SQLite WAL on **one host**. Put it on a local disk, not a network filesystem shared across machines. Run `schedule` periodically under a future process supervisor and `work` under separately supervised worker processes. `tick` combines due selection and a bounded worker pass for local testing. No persistent supervisor was installed here.

```sh
# Deliberate opt-in after validating a source. Not needed for manual collection.
npm run framework -- enable url-038
npm run framework -- tick --max-jobs 3
npm run framework -- disable url-038
```

Intervals live in `sources/registry.json`; enabling and due times live in SQLite. Registry reloads preserve the operational enablement state. Missed schedule slots are coalesced into one current run. Nothing needs a separate cron entry per URL.

## Improve a scraper

1. Read `_working/framework_source_results.md`, then inspect a repair packet with `repairs list` and its run with `show`.
2. Claim the repair: `npm run framework -- repairs claim REPAIR_ID --owner your-name`. Keep the returned claim token for the probation step.
3. Inspect the captured HTML/JSON and failed screenshot. Use `replay RUN_ID PAGE_ID` to reparse the HTML with the current registry and parser without visiting the website. Replay prints diagnostics; it does not overwrite historical observations.
4. Edit the source configuration or add a narrowly scoped parser in `src/adapters/`. Save a small, representative fixture under `tests/fixtures/`, including the failure case. Fix selectors, dates, record identity, pagination, and termination together.
5. Run `npm test`, then `repairs probation REPAIR_ID --token CLAIM_TOKEN`. This freezes the candidate code/configuration revision for validation. Reclaim a probation ticket if its candidate needs another code change.
6. Run fresh live enumerations. `repairs resolve` closes probation only after **two complete runs** of that exact candidate revision and a complete latest attempt. Probes and partial runs do not count. Scheduling remains held while repair tickets are open; enabling a schedule is separate.

Sources that serve homepages, annual guides, embeds, or interactive search widgets often need a different acquisition route before their parser can be complete. HTTP 200 or a changed page hash is insufficient evidence. The framework records missing contracts, malformed/rejected records, pagination loops, changing API totals, exhausted budgets, and major count drops relative to the last complete run. It preserves the previous good/complete pointers on failure. Access denials and robots restrictions need access/feed investigation, rather than repeated selector rewrites.

## Layout and evidence

- `sources/seed-urls.json`: original 82 URLs plus 15 distinct citation-only leads, preserving provenance.
- `sources/registry.json`: per-URL strategy, grouping, market, category hints, scope, cadence, and selectors. Edit it directly for normal source maintenance. `scripts/build-registry.mjs` bootstraps it from the earlier assessment; rerunning the builder **overwrites registry edits**, so update its overrides first when intentionally rebuilding.
- `scrapers/url-NNN.mjs`: one runnable entry per URL. Add custom logic in `src/adapters/`, rather than duplicating browser/session/queue code in these wrappers.
- `src/storage/journal.mjs`: transactional jobs, checkpoints, leases, scheduling state, attempts, repair claims, and audit actions.
- `src/worker.mjs`: bounded execution, API pagination, quality evaluation, frozen parser builds, and exports.
- `src/runtime/transport.mjs`: Playwright browser/API transports, per-host pacing, robots checks, captures, and access classification.
- `src/records.mjs`: shared event observation shape and conservative dates/identity handling.
- `_working/framework_implementation.md`: current architecture, measured results, remaining source work, and database handoff design.
- `_working/framework_source_results.md` and `.json`: latest per-URL results, generated by `report`.
- `_working/framework_event_samples.json`: bounded examples of current observations; regenerate with `node scripts/export-framework-samples.mjs`.
- `_working/initial_data_mining_framework.md`: earlier research and database/automation proposal, with a pointer to current implementation.

Raw evidence is ignored under `.artifacts/framework/runs/RUN_ID/ATTEMPT_ID/`. SQLite is the authoritative journal at `.artifacts/framework/journal.sqlite`. Rebuildable JSONL/result exports live under `.artifacts/framework/exports/RUN_ID/ATTEMPT_NUMBER/`. Failed captures are retained. Do not delete `.artifacts/` as a routine cleanup; it contains the local operational database and evidence. To back it up, stop your own workers and use SQLite's backup API or copy a consistent SQLite snapshot plus referenced capture files; copying only a live `.sqlite` file can omit WAL transactions.

Records are observations with source identity, title, dates, exact upstream timestamps where present, location claims, market city, category hints, and capture evidence. They are not publication-ready canonical events. Source locality and city-market labels stay separate. Cross-source deduplication, recurrence modeling, geocoding, category normalization, cancellation propagation, and reviewed publication belong in the database pipeline. A completed run means the **declared interface/query** was enumerated with its tested parser. It does not promise all events on a domain, all categories/cities, or an upstream atomic snapshot.

The original three prototypes remain runnable through `npm run mine` and their tests remain in the suite. Their `.artifacts/runs/` and `.artifacts/latest/` outputs are legacy sample evidence, separate from the new framework journal. `npm run status` is that older preview; use `npm run framework -- status` for durable framework state.
