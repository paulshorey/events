# Events source-field audit validation

Reviewed 2026-10-17T23:09:37.908Z.

- All 97 registry entries received a bounded Playwright inspection attempt; the first pass included 47 representative detail attempts. Fifteen sources received a focused follow-up, and AllEvents received a final domain check. Robots/access restrictions and HTTP 429 results were retained rather than bypassed.
- The current parsers replayed captured documents for all 97 entries. The per-source report distinguishes field presence from semantic approval and complete enumeration.
- `npm test`: 88 tests passed. New regressions cover structured and visible dates, missing end dates, overnight/DST clocks, venue addresses, postal codes, coordinates, graph references, publication-date false positives, source timestamp conflicts, detail identity, append-only checkpoint persistence and rollback.
- Real bounded worker runs exercised AllEvents, Meet Me at the Fair, Network.Vegas API, NYC Tourism, and Downtown Orlando in separate audit storage. All were intentionally bounded; none established complete enumeration.
- The first AllEvents worker run exposed its verified new all.events destination. After the scope/clock repair, a fresh three-request CLI run retained 24 base records, saved two separate detail enrichments, exported 24 projected observations, and recorded the new-domain timezone conflict as needs_review.
- The initial NYC Tourism worker held a title-alias mismatch instead of attaching uncertain fields. The final configuration permits only the browser-verified “NY Auto Show” / “New York International Auto Show” alias, with the same requested-page and date guards. ConventionGrid titles now exclude adjacent date/city metadata. Boston department pages remain discovery-only even when their JSON-LD claims they are Events.
- The operational journal was inspected read-only after validation: 140 runs, 4,334 historical observation rows, zero enabled collections and zero running runs. It was not migrated, reset, or used as test storage. No production database or scheduling changes were made.

## Current bounded sample outcomes

- contract_changed: 2 sources.
- sample_extracted: 33 sources.
- adapter_work_needed: 36 sources.
- access_blocked: 25 sources.
- rate_limited: 1 sources.

Full per-URL counts, inspected selectors, capture paths/hashes, representative values and specific follow-up issues are in `source_field_quality.json` and `.md`. The browser audit and replay commands are in `source_field_contract.md`. The local evidence roots are `.artifacts/field-audits/baseline`, `verification`, `final-domain`, `pipeline`, and `pipeline-final`; they remain ignored operational evidence.

## PR review follow-up

The enumeration coverage check now evaluates listing/API pages independently of detail pages, while detail errors, issues and pending tasks still block completion. Pending occurrence bindings for a shared detail URL are merged across listing pages; listing/API tasks run before detail acquisition. Unexpected new bindings after a detail task was claimed fail explicitly under the atomic checkpoint rather than silently disappearing. Controlled-worker regressions cover a complete listing plus enrichment, three recurring occurrences across three listing pages with one detail fetch, a mismatched detail holding completion, and rollback on late bindings.

## Release and remaining validation

New outputs use schema version 3. Original historical observations remain unchanged. Seventeen collections opt into deterministic detail acquisition; other sources retain their documented onboarding/repair needs. Access-blocked sites need a permitted feed, API or access route. Sources with no compatible dated contract need additional adapter development. No repair ticket is closed and no source is re-certified by this bounded audit. Complete coverage still requires full pagination and the existing repair probation validations.
