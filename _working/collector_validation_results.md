# Collector validation results — October 25, 2026

The diagnostics/quality milestone is implemented, with **105 passing local tests**. Two publishers passed two complete live runs of the final extraction build. Three remain held for the concrete reasons below. These results are source observations, not cross-source unique events or publication approval.

Final extraction build: `33de67b6d25ae39a355091320f94694a360fc1f37635931dc2d9413b0a7d9947`. Exact run IDs, configuration revisions, quality metrics and repair states are in [`collector_validation_results.json`](collector_validation_results.json). Candidate snapshots, full manifests, journals, responses and screenshots remain in ignored `.artifacts/source-validation/` storage. Earlier investigative builds are retained separately and do not count as final-build certification.

| Source | Live result | Fields and remaining limits |
| --- | --- | --- |
| Boston.gov, `url-054` | **Two complete final-build runs:** 293 upcoming observations, 10 listing pages each | 293 start times, 289 end times, 272 text locations, 270 source localities. Missing locations/times remain flagged. No coordinates supplied by the listing parser. |
| Choose Chicago, `url-039` | **Two complete final-build runs:** 6,193 records, 124 API pages each; source totals reconcile | Text locations for all 6,193; 5,911 source localities. 5,727 exact start/end clocks; 466 explicit all-day claims retain date precision. Thirty-nine source all-day/description conflicts remain review flags. The recorded `start_date` API query is the scope. |
| Downtown Orlando, `url-080` | **One complete final-build run:** 213 occurrences after 20 listing pages and detail acquisition; **second run denied HTTP 403 on listing page 17** | The good run has 213 starts, text locations and source coordinates; 194 exact ends, with 19 unknown. The failed run's 160 un-enriched observations do not replace the prior complete output. Source remains blocked; repair probation stays open. |
| NYC Tourism, `url-024` | Four numbered listing pages work after the rendering-race repair; **not fully validated** | Final paced attempt retains 37 dated listings, 20 enriched text locations and 15 coordinate pairs before a repeated upstream HTTP 500 at `/events/the-new-yorker-festival/`. No exact clocks established. Earlier HTTP 429 evidence is retained. The overlapping editorial view `url-025` also remains held after an earlier 429. |
| Discover LA, `url-035` | Calendar-card parser improved; **full acquisition held by robots policy on the advertised pagination URL** | Investigative run retained 97 raw candidates (86 pass its upcoming filter), all with native venue text. Calendar day blocks exclude sponsored carousels/mobile duplicates. End boundaries require details. URL-date/card-date differences are review flags; they may reflect recurrence or stale URLs and are not proof that either date is correct. No final-build complete-source claim. |

## Reproduced repair and diagnostic proof

Orlando's date-only listings can refer to several performances on the same day. The old strict join left 16 listings unresolved rather than choosing an arbitrary performance. An explicitly configured rule now preserves each original listing and appends separately identified, source-timed sessions under a fenced transactional checkpoint.

Replaying the same saved evidence changes **197 listing observations into 213 occurrences**: 16 parent observations are replaced in the projected view by 32 separately timed sessions. Original payloads are unchanged. Text-location and coordinate coverage improves from 181/197 to 213/213; exact end times remain 194/213. Regression tests cover opt-in requirements, known-clock guards, distinct identities and rollback.

The failed Orlando run was bundled with **651 copied evidence/diagnostic files**, and replayed successfully without its original journal. A real complete Chicago run's saved API page replayed offline to the same 50 events with a verified capture hash. Browser regressions reproduce NYC's early active-page/href updates and verify waiting for changed event titles, plus HTTP 429 `Retry-After` and prevention of further requests during cooldown.

The original operational journal was inspected read-only; diagnostics do not migrate it. Tests cover legacy schema support and validator rejection of the operational storage path from another working directory and through a symlink. No schedules, database imports, Railway changes or unattended jobs were activated.

## Next source work

1. **Orlando:** investigate the captured provider denial and establish a permitted feed or an acceptable acquisition cadence/access route. Preserve the good 213-occurrence snapshot. Two complete runs are still required before closing the repair; one pass plus a denied pass does not qualify.
2. **NYC:** retain the cooldown/error evidence. Its one consistently failing detail page currently stops the source run. A useful next runtime improvement is deferring an individually failing detail page while finishing independent pending details, with the run remaining incomplete until the error is resolved. Do not bypass the failing source or pretend missing fields were collected.
3. **LA:** inspect a permitted public feed/API or another published calendar interface. The next URL being linked on the page does not override robots policy. Resolve card-date/URL-date semantics and detail enrichment before completeness or field-accuracy claims.
4. **Boston and Chicago:** their declared interfaces passed the gates; review flagged records and remaining missing fields. These closely spaced runs establish repeatability now, not weeks of operational reliability. Keep schedules disabled until supervised hosting, persistence and collection activation are separately addressed.

For an engineer or AI agent, the reusable workflow is documented in [`source_validation_workflow.md`](source_validation_workflow.md): inspect → replay → change code/fixtures → compare identical evidence → run an immutable candidate twice → close probation only if its gates pass.
