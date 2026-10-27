# Collector diagnostics and acceptance

This extends the existing deterministic CLI. AI agents work outside the acquisition loop: inspect evidence, change code/configuration, add fixtures, compare results, then validate a frozen candidate. Schedules remain disabled. No PostgreSQL import or hosted worker is introduced.

## Inspect a source and reproduce its failure

```sh
npm run framework -- inspect url-054
npm run framework -- show RUN_ID
npm run framework -- replay RUN_ID PAGE_ID
npm run framework -- replay RUN_ID
npm run framework -- compare RUN_ID
```

`inspect` combines stored and current source configuration, last attempted/good/complete pointers, repairs, page outcomes, field counts, and representative records. `replay` and `compare` acquire nothing from the network and do not overwrite observations. HTML and TEC API captures use the same parsers as live extraction. Capture hashes are verified before parsing. Read-only diagnostic commands do not register configurations or migrate the journal, including legacy journals without detail-enrichment tables.

The default is the current parser and current registry configuration. `--config-mode frozen` selects the run's original configuration **with the current parser**; it does not restore historical executable code. Candidate build and configuration hashes identify the replay. `compare` compares original stored observations with the current parser replay on identical captures, reporting added/removed occurrence identities and changed dates, times, locations, categories, and quality warnings. It applies saved detail-to-listing bindings without changing originals. All uncommitted pages, including terminal failed pages, and missing/damaged captures are explicit replay errors, not silently treated as empty successes. A replay never establishes live enumeration completeness.

For source repairs, compare against a failed run as well as a complete baseline. Review lost records and changed identities, not just increased record counts. A corrected identity can legitimately appear as a removal plus an addition.

## Capture a diagnostic packet

```sh
npm run framework -- run url-024 --max-pages 5 --diagnostics --root .artifacts/my-investigation
npm run framework -- bundle RUN_ID --root .artifacts/my-investigation --out .artifacts/my-packet
npm run framework -- replay-bundle .artifacts/my-packet
```

The opt-in `--diagnostics` saves bounded page errors, failed document/XHR/fetch requests, selector counts and viewport screenshots alongside rendered HTML. Native API responses retain status, effective URL and capture hash in page acquisition metadata. Screenshots show the crawler's resource policy: images/media/fonts are blocked as in ordinary collection. Failure screenshots are still acquired without the diagnostic flag. Logs omit request headers and bodies; diagnostic URLs redact credential-like parameters.

A packet contains `report.json`, original observations, current-parser replay, differences and copied captures/diagnostic files. It refuses to overwrite an existing packet. `replay-bundle` works from copied evidence without the original journal. Full response bodies are untrusted publisher evidence and remain in ignored artifact storage; packets should be inspected before sharing. Missing evidence or parser errors cause a nonzero diagnostic exit. Added/removed/changed events alone are comparison results, not automatic approval or rejection of a repair.

## Source quality policies

Each of the first five publishers has a `quality` policy in `sources/registry.json`. Its versioned `scope` identifies the declared interface/query. Policy validation rejects unknown field names and invalid thresholds before collection.

- `minRecords`: guards against an empty success.
- `minCoverage`: minimum fractions for specific fields, assessed after detail enrichment.
- `maxRejectedRate`: malformed/rejected listing/API candidates relative to observed listing/API candidates. Detail enrichment does not add the same occurrences to this denominator; replay uses the same page-kind accounting.
- `maxReviewRate`: source-conflicting or otherwise review-required observations.
- `maxCoverageDrop`: detects loss relative to a sufficiently large previous complete baseline with the same policy scope and transport.

`startBoundary`/`endBoundary` mean an exact timestamp **or an explicit upstream all-day claim with a date**. They do not count date-only events as all-day and do not change timestamp-presence metrics. NYC can publish dates without hours; its policy does not manufacture times to satisfy a universal threshold. Coordinates are optional. Text-location coverage does not prove every street/city component is present or geographically correct. Boston's initial policy permits source-listed records without a location; their missing-field diagnostics remain visible. These thresholds are initial source contracts, not semantic/publication approval, and should be revised using reviewed source evidence.

Run results separate `enumeration` from `quality`. A fully enumerated calendar can fail its field-quality policy. An exhausted acquisition with a quality failure becomes `repair_needed` and preserves previous good/complete references. Bounded runs remain partial, even when their current fields pass. Source changes still need fixtures and live validation.

## Validate an immutable candidate twice

```sh
npm test
node scripts/validate-collectors.mjs --root .artifacts/source-validation/my-candidate
# Select a smaller batch or increase explicit budgets when necessary:
node scripts/validate-collectors.mjs --ids url-054,url-039 --root .artifacts/source-validation/my-candidate --max-pages 300 --max-runtime-ms 600000
```

The foreground validator copies code, examples and registry into an immutable candidate directory, then uses its parsers and build fingerprint for both runs. Its default batch is Boston.gov, Choose Chicago, Discover LA, NYC Tourism's calendar, and Downtown Orlando. NYC's editorial view (`url-025`) can be selected separately. It uses a separate journal, never enables schedules and rejects the standard operational journal root. All scopes and request/runtime budgets are explicit in `validation.json`.

Each candidate links `node_modules` to the checkout's installed dependencies, following [Node ESM resolution guidance](https://nodejs.org/api/esm.html#no-node_path). This supports an external absolute root or the default root from another working directory. Keep the checkout and its dependency installation available and unchanged during validation; the source snapshot is not a self-contained dependency bundle.

Each selected source runs twice only if its first run completes. A failed, partial, rate-limited or access-blocked candidate is not immediately run again unchanged. Open repair tickets in that validation journal are exclusively claimed and enter probation before a new candidate is exercised; another active repair claim is respected. The journal's existing exact-revision two-complete-run gate closes repairs. Partial/probe results do not count. Ctrl-C/SIGTERM requests a bounded stop and preserves committed evidence.

A transient retry outcome defers the remaining entries for that publisher in the same campaign. Browser and API HTTP 429 responses preserve `Retry-After` where supplied and place a cooldown in the shared publisher rate journal. A still-active long cooldown returns a retry outcome before another network request instead of blocking inside a long sleep. NYC pagination observes main-frame document/XHR/fetch responses initiated by each click on configured publisher hosts. HTTP denials are classified before accepting rendering or waiting out a selector timeout; their response bodies and `Retry-After` are retained, and 429 installs the shared publisher cooldown. NYC browser recovery reserves publisher pacing and a fenced request-budget slot for every intermediate click after reloading its lost browser state. If the remaining `--max-pages` budget cannot reach the pending target, the run stops partial with that page still pending; increase the budget explicitly before resuming. Recovery also checks the cumulative active-runtime budget before each intermediate click and its pacing wait; exhaustion leaves the target pending with `runtime_budget`. Ordinary task-boundary behavior is unchanged: an in-flight API/browser page or navigation retains its existing timeout and may finish after the runtime threshold. This includes an admitted NYC pagination task's first click when it reuses the current browser page. NYC uses five-second pacing; its October 25 500/429 evidence remains a hold, not an invitation to keep retrying through different entries or journals.

Downtown Orlando opts into `expandSameDaySessions`. It applies only when a date-only single-day listing matches several detail occurrences on that exact date, each with a distinct explicit start timestamp. Known-clock listings and other ambiguities retain the stricter one-to-one join. Children are saved in append-only `record_expansions`, alongside the unchanged original listing and captured detail. A failed checkpoint rolls the entire expansion back. Replay uses the same binding function as the live worker.

The validator groups entries by publisher and permits at most three concurrent publisher groups. Do not launch overlapping validation campaigns against the same publisher in different journals: per-host fencing and pacing are local to one journal. Captures, WAL state, code snapshots, validation manifests and exports are operational evidence; preserve them. Validate from the same candidate directory or start a fresh candidate after changes; never resume an old frontier using changed code.

## Source acquisition contracts

| Publisher | Strategy | Important boundary |
| --- | --- | --- |
| Boston.gov | Inspected occurrence cards and `rel=next` | Visible dates/clocks, native node/occurrence identity; no guessed locations |
| Choose Chicago | Public TEC REST API through Playwright request client; browser interface remains selectable | Enumerates the recorded `start_date` query and reconciles totals; earlier-starting ongoing events may be outside the query |
| NYC Tourism | Playwright next controls and inspected detail pages | Waits for active page **and changed event titles**, not merely changed links; numbered pages checkpoint separately; native unknown dates require detail discovery |
| Downtown Orlando | Observed `dlv_OC CL Downtown Events Listing Full Width=(pageindex=N)` URLs plus detail pages | Requested page, displayed `Page N of M` and page options must agree; recurrence joins retain explicit occurrence matching |
| Discover LA | Calendar day-block cards; inspected native event/venue attributes | Sponsored carousels/mobile duplicates excluded; native date disagreements flagged; advertised next URL is subject to robots policy and remains held if denied |

Access denial requires a permitted acquisition route, not a selector rewrite. Unknown pagination remains unverified. Candidate manifests and the measured-results document record the exact evidence; having a wrapper or a good sample does not validate a complete collector.

Implementation uses installed Playwright APIs. Relevant official references: [request/response events](https://playwright.dev/docs/network), [locator evaluation](https://playwright.dev/docs/api/class-locator#locator-evaluate-all), and [page waitForFunction](https://playwright.dev/docs/api/class-page#page-wait-for-function). Research results and full source inspections are retained in ignored `.artifacts/source-validation/` storage.
