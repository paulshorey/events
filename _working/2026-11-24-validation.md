# November 24 collector validation

Two bounded live passes on extraction build `845d4b4ff294d91672a9e921bca92913cd702a8eac5fb19a71037fc8ac99d25e` passed the configured quality checks with the default robots policy.

| Collection | Upcoming observations per pass | Requests per pass | Dev run IDs |
| --- | ---: | ---: | --- |
| Boston.gov, url-054 | 258 | 9 | 35a68088-b2ea-4b96-8de7-f5799923389e, ccde076e-317e-493e-a75c-2ee459060f9a |
| NYC Tourism, url-024 | 47 | 1 | cf796608-fce9-4417-bbec-0f7f26a80940, 32cf9da4-b7c4-444e-af43-13a2e9c39501 |
| NYC Tourism, url-025 | 47 | 1 | 01973633-5603-47ed-9ac2-5d70b01b0b5a, 1c698458-0a57-4367-ae94-7ba8b0823be4 |

The latest two NYC views had the same set of 47 publisher IDs, URLs, start dates and local start times. Use one for routine collection and preserve the other as a registered discovery view.

Countyfairgrounds returned 1,029 observations across 50 state requests. Three upstream rows had end dates earlier than their start dates (Kansas, Minnesota and Oklahoma). The run stayed partial. Replaying Maine page 669 from the November 5 run d0d674c8-bf1a-4010-aadc-8e1370696009 reproduced an empty array and raised `unverified_empty_state` with the new parser.

The seven terminal runs were delivered to dev with evidence. A repeat delivery skipped all seven. The local validation journal, frozen candidates, logs and replay output are under `.artifacts/collection/2026-11-24-validation/`.

The read-only [Las Vegas discovery query](../db/queries/las_vegas_upcoming.sql) uses the latest complete listing claims from two Network.Vegas scopes. It restricts results to the publisher's explicit city, region and country, groups agreeing occurrence claims by publisher identity and date/time, and retains each source row and its page hash. In the 90-day window beginning November 24, 20 claims produced 17 rows. Three rows had both scopes as evidence. All three distinct referenced captures were present in dev PostgreSQL.
